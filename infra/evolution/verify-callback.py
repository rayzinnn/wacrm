#!/usr/bin/env python3
"""Observe one local Evolution connection.update webhook retry safely."""

from __future__ import annotations

import hashlib
import hmac
import http.server
import json
import os
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
API = "http://127.0.0.1:8080"
CONTAINER = "wacrm-evolution-api"
MAIN_INSTANCE = "wacrm-local"
REDACTED_KEYS = {
    "apikey", "token", "secret", "authorization", "hash", "code", "base64",
    "qr", "qrcode", "pairingcode", "wuid", "jid", "ownerjid", "profilepicurl",
    "phonenumber", "phone", "sender",
}
LOCAL_URL_KEYS = {"destination", "server_url", "serverurl"}


class ProbeFailure(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def private_env() -> dict[str, str]:
    path = ROOT / ".env"
    if path.stat().st_mode & 0o077:
        raise ProbeFailure("private bootstrap env permissions are not 0600")
    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[name.strip()] = value
    key = values.get("AUTHENTICATION_API_KEY", "")
    if not key:
        raise ProbeFailure("private bootstrap admin key is missing")
    return {"AUTHENTICATION_API_KEY": key}


def api_request(method: str, path: str, key: str, body: dict | None = None) -> tuple[int, bytes]:
    headers = {"apikey": key, "accept": "application/json"}
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body, separators=(",", ":")).encode()
    request = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except Exception:
        raise ProbeFailure("local Evolution API request failed") from None


def json_body(data: bytes, stage: str):
    try:
        return json.loads(data)
    except Exception:
        raise ProbeFailure(f"Evolution returned invalid JSON during {stage}") from None


def instance_rows(key: str) -> list[dict]:
    status, data = api_request("GET", "/instance/fetchInstances", key)
    if status != 200:
        raise ProbeFailure(f"instance inventory returned HTTP {status}")
    payload = json_body(data, "instance inventory")
    rows = payload if isinstance(payload, list) else payload.get("instances", payload.get("instance", []))
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ProbeFailure("instance inventory shape was not recognized")
    return rows


def instance_name(row: dict) -> str | None:
    nested = row.get("instance")
    return row.get("instanceName") or row.get("name") or (nested.get("instanceName") if isinstance(nested, dict) else None)


def safe_instance_projection(rows: list[dict]) -> dict[str, str | None]:
    return {
        str(instance_name(row)): row.get("status") or row.get("connectionStatus")
        for row in rows
        if instance_name(row)
    }


def container_snapshot() -> dict[str, str]:
    names_result = subprocess.run(
        ["docker", "ps", "--filter", "name=wacrm", "--format", "{{.Names}}"],
        capture_output=True,
        text=True,
    )
    if names_result.returncode:
        raise ProbeFailure("could not inspect local service names")
    result: dict[str, str] = {}
    for name in names_result.stdout.splitlines():
        inspected = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}", name],
            capture_output=True,
            text=True,
        )
        if inspected.returncode:
            raise ProbeFailure("could not inspect local service state")
        result[name] = inspected.stdout.strip()
    return result


def verify_container_reachability(url: str) -> None:
    code = "fetch(process.argv[1]).then(r=>{console.log(r.status);process.exit(r.status===204?0:1)}).catch(()=>process.exit(2))"
    result = subprocess.run(
        ["docker", "exec", CONTAINER, "node", "-e", code, url],
        capture_output=True,
        text=True,
        timeout=12,
    )
    if result.returncode or result.stdout.strip() != "204":
        raise ProbeFailure("Evolution container could not reach the loopback callback receiver")


def secure_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(descriptor, content)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.chmod(path, 0o600)


def error_status(url: str, body: bytes, headers: dict[str, str]) -> int:
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        error.read()
        return error.code
    except Exception:
        raise ProbeFailure("local receiver self-check failed") from None


class ProbeReceiver(http.server.BaseHTTPRequestHandler):
    server_version = "WACRM-T03C1"

    def log_error(self, *_args) -> None:
        pass

    def initialize(self, *, callback_path: str, connection_id: str, webhook_secret: str,
                   probe_name: str, raw_path: Path) -> None:
        self.callback_path = callback_path
        self.connection_id = connection_id
        self.webhook_secret = webhook_secret
        self.probe_name = probe_name
        self.raw_path = raw_path
        self.lock = threading.Lock()
        self.first_event = threading.Event()
        self.identical_retry = threading.Event()
        self.first_payload: bytes | None = None
        self.first_sha256: str | None = None
        self.first_received_at: str | None = None
        self.first_provider_time: str | None = None
        self.first_monotonic: float | None = None
        self.retry_received_at: str | None = None
        self.retry_monotonic: float | None = None
        self.retry_byte_identical = False
        self.attempts: list[dict] = []
        self.rejected_wrong_secret = 0
        self.rejected_wrong_connection = 0
        self.rejected_wrong_instance = 0
        self.distinct_payloads = 0

    def log_message(self, *_args) -> None:
        pass

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_response(204)
        else:
            self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self) -> None:
        if self.path != self.callback_path:
            self._reply(404)
            return
        if not hmac.compare_digest(self.headers.get("x-wacrm-connection", ""), self.connection_id):
            type(self).rejected_wrong_connection += 1
            self._reply(401)
            return
        if not hmac.compare_digest(self.headers.get("x-wacrm-webhook-secret", ""), self.webhook_secret):
            type(self).rejected_wrong_secret += 1
            self._reply(401)
            return
        try:
            length = int(self.headers.get("content-length", "-1"))
        except ValueError:
            self._reply(400)
            return
        if length < 0 or length > 65536:
            self._reply(413)
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except Exception:
            self._reply(400)
            return
        if not isinstance(payload, dict) or payload.get("instance") != type(self).probe_name:
            type(self).rejected_wrong_instance += 1
            self._reply(409)
            return
        if payload.get("event") != "connection.update":
            self._reply(422)
            return

        digest = hashlib.sha256(raw).hexdigest()
        received_at = utc_now()
        monotonic = time.monotonic()
        state = type(self)
        with state.lock:
            if state.first_payload is None:
                state.first_payload = raw
                state.first_sha256 = digest
                state.first_received_at = received_at
                state.first_provider_time = payload.get("date_time") if isinstance(payload.get("date_time"), str) else None
                state.first_monotonic = monotonic
                state.attempts.append({
                    "received_at": received_at,
                    "provider_date_time": self.first_provider_time,
                    "sha256": digest,
                    "bytes": len(raw),
                    "status": 503,
                    "header_names_valid": True,
                })
                secure_write(state.raw_path, raw)
                state.first_event.set()
                response_status = 503
            elif raw == state.first_payload:
                if state.retry_monotonic is None:
                    state.retry_received_at = received_at
                    state.retry_monotonic = monotonic
                    state.retry_byte_identical = True
                    state.identical_retry.set()
                state.attempts.append({
                    "received_at": received_at,
                    "provider_date_time": payload.get("date_time") if isinstance(payload.get("date_time"), str) else None,
                    "sha256": digest,
                    "bytes": len(raw),
                    "status": 200,
                    "header_names_valid": True,
                })
                response_status = 200
            else:
                state.distinct_payloads += 1
                response_status = 200
        self._reply(response_status)

    def _reply(self, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.end_headers()

    @classmethod
    def safe_result(state) -> dict:
        with state.lock:
            interval_ms = None
            if state.first_monotonic is not None and state.retry_monotonic is not None:
                interval_ms = round((state.retry_monotonic - state.first_monotonic) * 1000)
            return {
                "attempts": list(state.attempts),
                "interval_ms": interval_ms,
                "rejected_wrong_secret": state.rejected_wrong_secret,
                "rejected_wrong_connection": state.rejected_wrong_connection,
                "rejected_wrong_instance": state.rejected_wrong_instance,
                "distinct_payloads_after_first": state.distinct_payloads,
                "byte_identical_retry": state.retry_byte_identical,
            }


def sanitize(value, key: str = ""):
    normalized = key.lower().replace("_", "").replace("-", "")
    if normalized in {item.replace("_", "").replace("-", "") for item in REDACTED_KEYS}:
        return "[REDACTED]"
    if normalized in {item.replace("_", "").replace("-", "") for item in LOCAL_URL_KEYS}:
        return "[LOCAL_URL]"
    if isinstance(value, dict):
        return {str(name): sanitize(child, str(name)) for name, child in value.items()}
    if isinstance(value, list):
        return [sanitize(child, key) for child in value]
    return value


def callback_headers(connection_id: str, secret: str) -> dict[str, str]:
    return {
        "x-wacrm-connection": connection_id,
        "x-wacrm-webhook-secret": secret,
        "content-type": "application/json",
    }


def webhook_configured(key: str, path: str, expected: dict) -> bool:
    status, data = api_request("GET", path, key)
    if status != 200:
        return False
    config = json_body(data, "webhook configuration check")
    headers = config.get("headers") or {}
    return (
        config.get("enabled") is True
        and config.get("url") == expected["url"]
        and config.get("events") == ["CONNECTION_UPDATE"]
        and config.get("webhookByEvents", config.get("byEvents")) is False
        and config.get("webhookBase64", config.get("base64")) is False
        and headers.get("x-wacrm-connection") == expected["connection"]
        and headers.get("x-wacrm-webhook-secret") == expected["secret"]
    )


def main() -> int:
    admin_key = private_env()["AUTHENTICATION_API_KEY"]
    probe_name = f"wacrm-probe-{datetime.now(timezone.utc):%Y%m%d%H%M%S}-{secrets.token_hex(4)}"
    instance_token = secrets.token_urlsafe(32)
    connection_id = str(uuid.uuid4())
    webhook_secret = secrets.token_hex(32)
    callback_path = f"/__wacrm_t03c1/{secrets.token_hex(12)}"
    private_dir = ROOT / "private" / f"T03.c1-{probe_name}"
    raw_capture = private_dir / "callback-first-attempt.json"

    baseline_instances = instance_rows(admin_key)
    baseline = safe_instance_projection(baseline_instances)
    if MAIN_INSTANCE not in baseline:
        raise ProbeFailure("primary Evolution instance is absent before the probe")
    if probe_name in baseline:
        raise ProbeFailure("generated probe name already exists")
    services_before = container_snapshot()

    listener = http.server.ThreadingHTTPServer(("127.0.0.1", 0), ProbeReceiver)
    listener.daemon_threads = True
    receiver = listener.RequestHandlerClass
    receiver.initialize(
        receiver,
        callback_path=callback_path,
        connection_id=connection_id,
        webhook_secret=webhook_secret,
        probe_name=probe_name,
        raw_path=raw_capture,
    )
    thread = threading.Thread(target=listener.serve_forever, daemon=True)
    thread.start()
    port = listener.server_address[1]
    callback_url = f"http://host.lima.internal:{port}{callback_path}"
    local_callback_url = f"http://127.0.0.1:{port}{callback_path}"
    health_url = f"http://host.lima.internal:{port}/health"
    safe_out: dict = {
        "probe_name": probe_name,
        "callback_host": "host.lima.internal",
        "receiver_bind": "127.0.0.1",
        "receiver_reachable_from_evolution": False,
        "wrong_secret_status": None,
        "wrong_connection_status": None,
        "wrong_instance_status": None,
        "create_status": None,
        "webhook_set_status": None,
        "webhook_config_matches": False,
        "connect_status": None,
        "connect_response_bytes_discarded": None,
        "probe_state_before": None,
        "probe_state_after": None,
        "callback": None,
        "cleanup_disable_status": None,
        "cleanup_delete_status": None,
        "probe_removed": False,
        "main_instance_status_before": baseline[MAIN_INSTANCE],
        "main_instance_status_after": None,
        "services_unchanged": False,
        "raw_callback_path": str(raw_capture.relative_to(ROOT)),
    }
    creation_attempted = False
    probe_created = False
    failure: str | None = None
    callback_expected = {"url": callback_url, "connection": connection_id, "secret": webhook_secret}
    webhook_set_path = f"/webhook/set/{urllib.parse.quote(probe_name, safe='')}"
    webhook_find_path = f"/webhook/find/{urllib.parse.quote(probe_name, safe='')}"
    delete_path = f"/instance/delete/{urllib.parse.quote(probe_name, safe='')}"
    disable_body = {
        "webhook": {
            "enabled": False,
            "url": callback_url,
            "headers": {"x-wacrm-connection": connection_id, "x-wacrm-webhook-secret": webhook_secret},
            "byEvents": False,
            "base64": False,
            "events": [],
        }
    }

    try:
        verify_container_reachability(health_url)
        safe_out["receiver_reachable_from_evolution"] = True
        synthetic = json.dumps({
            "event": "connection.update",
            "instance": probe_name,
            "data": {"state": "connecting"},
            "date_time": utc_now(),
        }, separators=(",", ":")).encode()
        base_headers = callback_headers(connection_id, webhook_secret)
        wrong_secret_headers = {**base_headers, "x-wacrm-webhook-secret": secrets.token_hex(32)}
        safe_out["wrong_secret_status"] = error_status(local_callback_url, synthetic, wrong_secret_headers)
        wrong_connection_headers = {**base_headers, "x-wacrm-connection": str(uuid.uuid4())}
        safe_out["wrong_connection_status"] = error_status(local_callback_url, synthetic, wrong_connection_headers)
        wrong_instance = json.dumps({
            "event": "connection.update",
            "instance": probe_name + "-wrong",
            "data": {"state": "connecting"},
            "date_time": utc_now(),
        }, separators=(",", ":")).encode()
        safe_out["wrong_instance_status"] = error_status(local_callback_url, wrong_instance, base_headers)
        if (safe_out["wrong_secret_status"], safe_out["wrong_connection_status"], safe_out["wrong_instance_status"]) != (401, 401, 409):
            raise ProbeFailure("receiver auth/correlation self-check did not return expected statuses")

        creation_attempted = True
        create_body = {
            "instanceName": probe_name,
            "integration": "WHATSAPP-BAILEYS",
            "qrcode": False,
            "token": instance_token,
        }
        create_status, create_data = api_request("POST", "/instance/create", admin_key, create_body)
        safe_out["create_status"] = create_status
        if create_status == 201:
            probe_created = True
        if create_status != 201:
            raise ProbeFailure(f"probe creation returned HTTP {create_status}")
        created = json_body(create_data, "probe creation")
        if created.get("instance", {}).get("instanceName") != probe_name:
            raise ProbeFailure("created response did not confirm the generated probe name")
        del create_data, created, create_body

        configured_body = {
            "webhook": {
                "enabled": True,
                "url": callback_url,
                "headers": {"x-wacrm-connection": connection_id, "x-wacrm-webhook-secret": webhook_secret},
                "byEvents": False,
                "base64": False,
                "events": ["CONNECTION_UPDATE"],
            }
        }
        set_status, set_data = api_request("POST", webhook_set_path, admin_key, configured_body)
        safe_out["webhook_set_status"] = set_status
        del set_data, configured_body
        if set_status != 201:
            raise ProbeFailure(f"probe webhook configuration returned HTTP {set_status}")
        safe_out["webhook_config_matches"] = webhook_configured(admin_key, webhook_find_path, callback_expected)
        if not safe_out["webhook_config_matches"]:
            raise ProbeFailure("probe webhook configuration did not match the requested fields")

        before_status, before_data = api_request(
            "GET", f"/instance/connectionState/{urllib.parse.quote(probe_name, safe='')}", instance_token,
        )
        if before_status != 200:
            raise ProbeFailure(f"probe state before connect returned HTTP {before_status}")
        safe_out["probe_state_before"] = json_body(before_data, "probe state before connect").get("instance", {}).get("state")
        del before_data

        connect_status, connect_body = api_request(
            "GET", f"/instance/connect/{urllib.parse.quote(probe_name, safe='')}", instance_token,
        )
        safe_out["connect_status"] = connect_status
        safe_out["connect_response_bytes_discarded"] = len(connect_body)
        del connect_body
        if connect_status != 200:
            raise ProbeFailure(f"probe connect returned HTTP {connect_status}")
        if not receiver.first_event.wait(20):
            raise ProbeFailure("no authenticated connection.update callback reached the receiver")
        if not receiver.identical_retry.wait(25):
            raise ProbeFailure("Evolution did not repeat the byte-identical callback within the observation window")

        after_status, after_data = api_request(
            "GET", f"/instance/connectionState/{urllib.parse.quote(probe_name, safe='')}", instance_token,
        )
        if after_status != 200:
            raise ProbeFailure(f"probe state after connect returned HTTP {after_status}")
        safe_out["probe_state_after"] = json_body(after_data, "probe state after connect").get("instance", {}).get("state")
        del after_data
        if safe_out["probe_state_after"] == "open":
            raise ProbeFailure("probe unexpectedly reached open state; stop and inspect before continuing")

        raw_json = json.loads(receiver.first_payload or b"{}")
        retry_proved = receiver.safe_result()["byte_identical_retry"]
        safe_out["callback"] = {
            "event": raw_json.get("event"),
            "provider_date_time": receiver.first_provider_time,
            "envelope_fields": sorted(raw_json.keys()),
            "data_field_types": {key: type(value).__name__ for key, value in (raw_json.get("data") or {}).items()} if isinstance(raw_json.get("data"), dict) else {},
            "header_names_configured_and_validated": ["x-wacrm-connection", "x-wacrm-webhook-secret"],
            "attempts": receiver.attempts[:2],
            "byte_identical_retry": retry_proved,
            "retry_interval_ms": receiver.safe_result()["interval_ms"],
            "distinct_payloads_after_first": receiver.distinct_payloads,
            "wrong_secret_rejected": receiver.rejected_wrong_secret == 1,
            "wrong_connection_rejected": receiver.rejected_wrong_connection == 1,
            "wrong_instance_rejected": receiver.rejected_wrong_instance == 1,
            "sanitized_payload": sanitize(raw_json),
        }
        if not retry_proved or receiver.attempts[0]["status"] != 503 or receiver.attempts[1]["status"] != 200:
            raise ProbeFailure("callback retry did not match the required 503 then identical 200 sequence")
    except ProbeFailure as error:
        failure = str(error)
    except Exception:
        failure = "probe workflow failed unexpectedly"
    finally:
        if creation_attempted and not probe_created:
            try:
                after_attempt = safe_instance_projection(instance_rows(admin_key))
                probe_created = probe_name not in baseline and probe_name in after_attempt
            except Exception:
                pass
        if probe_created:
            try:
                try:
                    disable_status, _ = api_request("POST", webhook_set_path, admin_key, disable_body)
                    safe_out["cleanup_disable_status"] = disable_status
                except Exception:
                    safe_out["cleanup_disable_status"] = "request_failed"
                try:
                    delete_status, _ = api_request("DELETE", delete_path, admin_key)
                    safe_out["cleanup_delete_status"] = delete_status
                except Exception:
                    safe_out["cleanup_delete_status"] = "request_failed"
                if safe_out["cleanup_delete_status"] != 200:
                    try:
                        delete_status, _ = api_request("DELETE", delete_path, admin_key)
                        safe_out["cleanup_delete_status"] = delete_status
                    except Exception:
                        safe_out["cleanup_delete_status"] = "request_failed"
            finally:
                try:
                    final_instances = safe_instance_projection(instance_rows(admin_key))
                    safe_out["probe_removed"] = probe_name not in final_instances
                    safe_out["main_instance_status_after"] = final_instances.get(MAIN_INSTANCE)
                except Exception:
                    safe_out["probe_removed"] = False
        listener.shutdown()
        listener.server_close()
        thread.join(timeout=3)

    try:
        final_instances = safe_instance_projection(instance_rows(admin_key))
        if probe_created:
            safe_out["probe_removed"] = probe_name not in final_instances
        safe_out["main_instance_status_after"] = final_instances.get(MAIN_INSTANCE)
        safe_out["services_unchanged"] = services_before == container_snapshot()
    except Exception:
        safe_out["services_unchanged"] = False

    print(json.dumps(safe_out, indent=2, sort_keys=True))
    if failure:
        print("workflow_status: failed")
        print("diagnostic:", failure)
        return 1
    if (probe_created and not safe_out["probe_removed"]) or not safe_out["services_unchanged"]:
        print("workflow_status: cleanup verification failed")
        return 1
    if safe_out["main_instance_status_before"] != safe_out["main_instance_status_after"]:
        print("workflow_status: primary state changed during observation")
        return 1
    print("workflow_status: completed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ProbeFailure as error:
        print("workflow_status: preflight failed")
        print("diagnostic:", str(error))
        raise SystemExit(1)
