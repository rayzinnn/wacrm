'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleHelp, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SessionState } from '@/lib/whatsapp/evolution/types';
import { SettingsPanelHead } from './settings-panel-head';

type CapabilitySnapshot = {
  text: boolean;
  media: string[];
};

type ConnectionConfig = {
  configured: boolean;
  state: SessionState;
  checkedAt: string | null;
  baseUrl?: string;
  instanceId?: string;
  capabilities?: CapabilitySnapshot;
};

type SessionSnapshot = {
  state: SessionState;
  qr: { dataUrl: string; expiresAt: string } | null;
  checkedAt: string;
};

type QrView = {
  accountId: string;
  dataUrl: string;
  expiresAt: string;
};

type BusyAction = 'save' | 'connect' | 'status' | null;
type ErrorCopyKey =
  | 'loadError'
  | 'saveError'
  | 'statusError'
  | 'connectError'
  | 'tokenError'
  | 'originError'
  | 'permissionError'
  | 'missingConnection'
  | 'ambiguousConnect';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(await response.json());
  } catch {
    return null;
  }
}

function sessionState(value: unknown): SessionState {
  if (value === 'connected' || value === 'connecting' || value === 'disconnected') return value;
  return 'unknown';
}

function errorCopyKey(
  code: unknown,
  ambiguous: boolean,
  fallback: ErrorCopyKey,
): ErrorCopyKey {
  if (ambiguous) return 'ambiguousConnect';
  if (code === 'evolution_unauthorized' || code === 'invalid_credentials') return 'tokenError';
  if (typeof code === 'string' && (code.includes('origin') || code === 'invalid_origin')) {
    return 'originError';
  }
  if (code === 'actor_forbidden' || code === 'permission_denied') return 'permissionError';
  if (code === 'connection_not_configured') return 'missingConnection';
  return fallback;
}

function observedTime(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

export function WhatsAppConfig() {
  const t = useTranslations('Settings.whatsapp');
  const { accountId, loading: authLoading, profileLoading, canEditSettings } = useAuth();

  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorField, setSaveErrorField] = useState<'origin' | 'token' | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [requiresStatusCheck, setRequiresStatusCheck] = useState(false);
  const [hasLiveObservation, setHasLiveObservation] = useState(false);
  const [qr, setQr] = useState<QrView | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const accountIdRef = useRef<string | null>(accountId);
  accountIdRef.current = accountId;
  const qrRef = useRef<QrView | null>(qr);
  qrRef.current = qr;
  const actionControllerRef = useRef<AbortController | null>(null);
  const actionAccountIdRef = useRef<string | null>(null);

  const updateQr = useCallback((next: QrView | null) => {
    qrRef.current = next;
    setQr(next);
  }, []);

  useEffect(() => {
    updateQr(null);
    setToken('');
    setBaseUrl('');
    setInstanceName('');
    setConnection(null);
    setHasLiveObservation(false);
    setRequiresStatusCheck(false);
    setStatusError(null);
    setConnectError(null);
    setSaveError(null);
    setSaveNotice(null);
    setBusyAction(null);

    return () => {
      if (actionAccountIdRef.current === accountId) {
        actionControllerRef.current?.abort();
        actionControllerRef.current = null;
        actionAccountIdRef.current = null;
      }
      qrRef.current = null;
    };
  }, [accountId, updateQr]);

  useEffect(() => {
    if (authLoading || profileLoading) return;

    if (!accountId) {
      setConnection(null);
      setLoadError(t('loadError'));
      setLoading(false);
      return;
    }

    const capturedAccountId = accountId;
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setLoadError(null);
    setConnection(null);
    setHasLiveObservation(false);

    async function loadConnection() {
      try {
        const response = await fetch('/api/whatsapp/config', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        const body = await readJson(response);

        if (!active || accountIdRef.current !== capturedAccountId) return;
        if (!response.ok || !body || typeof body.configured !== 'boolean') {
          throw new Error('config_unavailable');
        }

        setConnection({
          configured: body.configured,
          state: sessionState(body.state),
          checkedAt: observedTime(body.checkedAt),
          baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
          instanceId: typeof body.instanceId === 'string' ? body.instanceId : undefined,
          capabilities:
            body.capabilities && typeof body.capabilities === 'object'
              ? {
                  text: (body.capabilities as Record<string, unknown>).text === true,
                  media: Array.isArray((body.capabilities as Record<string, unknown>).media)
                    ? ((body.capabilities as Record<string, unknown>).media as string[])
                    : [],
                }
              : undefined,
        });
      } catch {
        if (active && accountIdRef.current === capturedAccountId && !controller.signal.aborted) {
          setLoadError(t('loadError'));
        }
      } finally {
        if (active && accountIdRef.current === capturedAccountId && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadConnection();

    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, authLoading, profileLoading, reloadKey, t]);

  const requestStatus = useCallback(
    async (capturedAccountId: string, signal: AbortSignal) => {
      try {
        const response = await fetch('/api/whatsapp/evolution/status', {
          method: 'GET',
          cache: 'no-store',
          signal,
          headers: { accept: 'application/json' },
        });
        const body = await readJson(response);

        if (signal.aborted || accountIdRef.current !== capturedAccountId) return;
        if (!response.ok || !body) {
          const key = errorCopyKey(body?.code, body?.ambiguous === true, 'statusError');
          setConnection((current) => (current ? { ...current, state: 'unknown' } : current));
          setHasLiveObservation(false);
          setStatusError(t(key));
          return;
        }

        const state = sessionState(body.state);
        setConnection((current) =>
          current
            ? { ...current, state, checkedAt: observedTime(body.checkedAt) ?? current.checkedAt }
            : current,
        );
        setHasLiveObservation(true);
        setStatusError(null);
        setConnectError(null);
        setRequiresStatusCheck(false);

        if (state === 'connected') updateQr(null);
        // A status snapshot has no QR. Keep a still-valid QR while the
        // connection remains in progress.
      } catch {
        if (!signal.aborted && accountIdRef.current === capturedAccountId) {
          setConnection((current) => (current ? { ...current, state: 'unknown' } : current));
          setHasLiveObservation(false);
          setStatusError(t('statusError'));
        }
      }
    },
    [t, updateQr],
  );

  const configured = connection?.configured === true;
  const isConnected = connection?.state === 'connected';

  useEffect(() => {
    if (
      !accountId ||
      !canEditSettings ||
      !configured ||
      (isConnected && hasLiveObservation) ||
      busyAction !== null
    ) {
      return;
    }

    const capturedAccountId = accountId;
    let active = true;
    let inFlight = false;
    let currentController: AbortController | null = null;

    const checkStatus = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      currentController = new AbortController();
      await requestStatus(capturedAccountId, currentController.signal);
      inFlight = false;
      currentController = null;
    };

    void checkStatus();
    const timer = setInterval(() => void checkStatus(), 5_000);

    return () => {
      active = false;
      clearInterval(timer);
      currentController?.abort();
    };
  }, [
    accountId,
    canEditSettings,
    configured,
    isConnected,
    hasLiveObservation,
    busyAction,
    requestStatus,
  ]);

  useEffect(() => {
    if (!qr) return;
    if (qr.accountId !== accountId) {
      updateQr(null);
      return;
    }

    const remaining = Date.parse(qr.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      updateQr(null);
      return;
    }

    const timer = setTimeout(() => updateQr(null), remaining);
    return () => clearTimeout(timer);
  }, [accountId, qr, updateQr]);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId || busyAction !== null || actionControllerRef.current) return;

    const isRotation = configured;
    const nextBaseUrl = isRotation ? connection?.baseUrl ?? '' : baseUrl.trim();
    const nextInstanceName = isRotation ? connection?.instanceId ?? '' : instanceName.trim();
    if (!token.trim()) {
      setSaveError(t('tokenRequired'));
      setSaveErrorField('token');
      return;
    }
    if (!nextBaseUrl || !nextInstanceName) {
      setSaveError(t('saveError'));
      setSaveErrorField(null);
      return;
    }

    const capturedAccountId = accountId;
    const controller = new AbortController();
    actionControllerRef.current = controller;
    actionAccountIdRef.current = capturedAccountId;
    setBusyAction('save');
    setSaveError(null);
    setSaveErrorField(null);
    setSaveNotice(null);

    try {
      const response = await fetch('/api/whatsapp/config', {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          baseUrl: nextBaseUrl,
          instanceId: nextInstanceName,
          token,
        }),
      });
      const body = await readJson(response);

      if (accountIdRef.current !== capturedAccountId || controller.signal.aborted) return;
      if (!response.ok) {
        const key = errorCopyKey(body?.code, body?.ambiguous === true, 'saveError');
        setSaveError(t(key));
        setSaveErrorField(key === 'tokenError' ? 'token' : key === 'originError' ? 'origin' : null);
        return;
      }

      setToken('');
      setShowToken(false);
      setConnection((current) => ({
        configured: true,
        state: current?.state ?? 'unknown',
        checkedAt: current?.checkedAt ?? null,
        baseUrl: nextBaseUrl,
        instanceId: nextInstanceName,
        capabilities: current?.capabilities ?? { text: false, media: [] },
      }));
      setHasLiveObservation(false);
      setSaveNotice(t('saveSuccess'));
      setReloadKey((current) => current + 1);
    } catch {
      if (accountIdRef.current === capturedAccountId && !controller.signal.aborted) {
        setSaveError(t('saveError'));
        setSaveErrorField(null);
      }
    } finally {
      if (actionControllerRef.current === controller) {
        actionControllerRef.current = null;
        actionAccountIdRef.current = null;
      }
      if (accountIdRef.current === capturedAccountId) setBusyAction(null);
    }
  }

  async function handleConnect() {
    if (
      !accountId ||
      !configured ||
      busyAction !== null ||
      actionControllerRef.current ||
      requiresStatusCheck
    ) {
      return;
    }

    const capturedAccountId = accountId;
    const controller = new AbortController();
    actionControllerRef.current = controller;
    actionAccountIdRef.current = capturedAccountId;
    setBusyAction('connect');
    setConnectError(null);
    setStatusError(null);
    setRequiresStatusCheck(false);

    try {
      const response = await fetch('/api/whatsapp/evolution/connect', {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      const body = await readJson(response);

      if (accountIdRef.current !== capturedAccountId || controller.signal.aborted) return;
      if (!response.ok || !body) {
        const ambiguous = body?.ambiguous === true;
        const key = errorCopyKey(body?.code, ambiguous, 'connectError');
        setConnection((current) => (current ? { ...current, state: 'unknown' } : current));
        setHasLiveObservation(false);
        updateQr(null);
        setConnectError(t(key));
        setRequiresStatusCheck(ambiguous);
        return;
      }

      const snapshot: SessionSnapshot = {
        state: sessionState(body.state),
        checkedAt: observedTime(body.checkedAt) ?? new Date().toISOString(),
        qr: null,
      };
      const qrBody = asRecord(body.qr);
      if (
        qrBody &&
        typeof qrBody.dataUrl === 'string' &&
        qrBody.dataUrl.startsWith('data:image/png;base64,') &&
        typeof qrBody.expiresAt === 'string' &&
        Number.isFinite(Date.parse(qrBody.expiresAt)) &&
        Date.parse(qrBody.expiresAt) > Date.now()
      ) {
        snapshot.qr = { dataUrl: qrBody.dataUrl, expiresAt: qrBody.expiresAt };
      }

      setConnection((current) =>
        current ? { ...current, state: snapshot.state, checkedAt: snapshot.checkedAt } : current,
      );
      setHasLiveObservation(snapshot.state === 'connected');
      setConnectError(null);
      setStatusError(null);
      setRequiresStatusCheck(false);

      if (snapshot.state === 'connected') {
        updateQr(null);
      } else if (snapshot.qr) {
        updateQr({
          accountId: capturedAccountId,
          dataUrl: snapshot.qr.dataUrl,
          expiresAt: snapshot.qr.expiresAt,
        });
      } else {
        updateQr(null);
      }
    } catch {
      if (accountIdRef.current === capturedAccountId && !controller.signal.aborted) {
        setConnection((current) => (current ? { ...current, state: 'unknown' } : current));
        setHasLiveObservation(false);
        updateQr(null);
        setConnectError(t('ambiguousConnect'));
        setRequiresStatusCheck(true);
      }
    } finally {
      if (actionControllerRef.current === controller) {
        actionControllerRef.current = null;
        actionAccountIdRef.current = null;
      }
      if (accountIdRef.current === capturedAccountId) setBusyAction(null);
    }
  }

  async function handleCheckStatus() {
    if (!accountId || busyAction !== null || actionControllerRef.current) return;

    const capturedAccountId = accountId;
    const controller = new AbortController();
    actionControllerRef.current = controller;
    actionAccountIdRef.current = capturedAccountId;
    setBusyAction('status');
    setStatusError(null);

    try {
      await requestStatus(capturedAccountId, controller.signal);
    } finally {
      if (actionControllerRef.current === controller) {
        actionControllerRef.current = null;
        actionAccountIdRef.current = null;
      }
      if (accountIdRef.current === capturedAccountId) setBusyAction(null);
    }
  }

  const visibleQr =
    qr && qr.accountId === accountId && Date.parse(qr.expiresAt) > Date.now() ? qr : null;
  const displayState = !configured
    ? 'notConfigured'
    : visibleQr && connection?.state !== 'connected'
      ? 'connecting'
      : canEditSettings && !hasLiveObservation
        ? 'unknown'
        : connection?.state ?? 'unknown';
  const stateText =
    displayState === 'notConfigured'
      ? t('stateNotConfigured')
      : displayState === 'connected'
        ? t('stateConnected')
        : displayState === 'connecting'
          ? t('stateConnecting')
          : displayState === 'disconnected'
            ? t('stateDisconnected')
            : t('stateUnknown');
  const stateDetail =
    displayState === 'notConfigured'
      ? t('missingConnection')
      : displayState === 'connected'
        ? t('statusConnectedDetail')
        : displayState === 'connecting'
          ? t('statusConnectingDetail')
          : displayState === 'disconnected'
            ? t('statusDisconnectedDetail')
            : t('statusUnknownDetail');
  const canShowConnectionForm = canEditSettings && connection !== null && !loadError;

  if (authLoading || profileLoading || loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('evolutionTitle')} description={t('evolutionDescription')} />
        <div className="flex items-center gap-3 py-12 text-sm text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          {t('loadingEvolutionConfig')}
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('evolutionTitle')} description={t('evolutionDescription')} />

      {loadError ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="size-4" aria-hidden="true" />
          <AlertTitle>{t('loadError')}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button type="button" variant="outline" onClick={() => setReloadKey((value) => value + 1)}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {t('refreshConnection')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
          <Card className="min-w-0 rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-foreground">{t('sessionState')}</CardTitle>
                <CardDescription>{stateDetail}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground" role="status" aria-live="polite" aria-atomic="true">
                  {displayState === 'connected' ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  ) : displayState === 'unknown' || displayState === 'notConfigured' ? (
                    <CircleHelp className="size-4 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
                  )}
                  <span>{stateText}</span>
                </div>

                <p className="text-xs text-muted-foreground">
                  {t('lastObserved')}: {connection?.checkedAt
                    ? new Date(connection.checkedAt).toLocaleString()
                    : t('notObserved')}
                </p>

                {statusError && (
                  <p className="text-sm text-destructive" role="status" aria-live="polite">
                    {statusError}
                  </p>
                )}
                {connectError && (
                  <Alert variant="destructive" role="alert">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    <AlertDescription>{connectError}</AlertDescription>
                  </Alert>
                )}
                {saveError && !saveErrorField && (
                  <Alert variant="destructive" role="alert">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    <AlertDescription>{saveError}</AlertDescription>
                  </Alert>
                )}
                {saveNotice && (
                  <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status" aria-live="polite">
                    {saveNotice}
                  </p>
                )}

                {visibleQr && canEditSettings && (
                  <div className="space-y-3 rounded-md border border-border p-4">
                    <Image
                      src={visibleQr.dataUrl}
                      alt={t('qrAlt')}
                      width={320}
                      height={320}
                      unoptimized
                      className="mx-auto h-auto max-h-80 w-full max-w-80 rounded-md bg-white object-contain p-3"
                    />
                    <p className="text-sm text-muted-foreground">{t('qrExpiryLocal')}</p>
                  </div>
                )}

                {connection?.configured && canEditSettings && (
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      onClick={handleConnect}
                      disabled={busyAction !== null || requiresStatusCheck}
                      aria-busy={busyAction === 'connect'}
                    >
                      {busyAction === 'connect' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                      {t('connectSession')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCheckStatus}
                      disabled={busyAction !== null}
                      aria-busy={busyAction === 'status'}
                    >
                      {busyAction === 'status' ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="size-4" aria-hidden="true" />
                      )}
                      {t('checkStatus')}
                    </Button>
                  </div>
                )}

                {requiresStatusCheck && <p className="text-sm text-muted-foreground">{t('ambiguousConnect')}</p>}
                {!canEditSettings && <p className="text-sm text-muted-foreground">{t('readOnlyNote')}</p>}
              </CardContent>
            </Card>

            {canShowConnectionForm && canEditSettings && (
              <Card className="min-w-0 rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle className="text-foreground">{t('configTitle')}</CardTitle>
                  <CardDescription>{t('configDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSave} className="space-y-4">
                    {connection?.configured ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="evolution-origin">{t('serverOrigin')}</Label>
                          <Input
                            id="evolution-origin"
                            name="baseUrl"
                            value={connection.baseUrl ?? ''}
                            readOnly
                            autoComplete="url"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="evolution-instance">{t('instanceName')}</Label>
                          <Input
                            id="evolution-instance"
                            name="instanceId"
                            value={connection.instanceId ?? ''}
                            readOnly
                            autoComplete="off"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="evolution-origin">{t('serverOrigin')}</Label>
                          <Input
                            id="evolution-origin"
                            name="baseUrl"
                            type="url"
                            inputMode="url"
                            placeholder={t('serverOriginPlaceholder')}
                            value={baseUrl}
                            onChange={(event) => setBaseUrl(event.target.value)}
                            autoComplete="url"
                            spellCheck={false}
                            required
                            aria-invalid={saveErrorField === 'origin'}
                            aria-describedby={saveErrorField === 'origin' ? 'evolution-origin-error' : undefined}
                          />
                          {saveErrorField === 'origin' && (
                            <p id="evolution-origin-error" className="text-sm text-destructive">
                              {saveError}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="evolution-instance">{t('instanceName')}</Label>
                          <Input
                            id="evolution-instance"
                            name="instanceId"
                            placeholder={t('instanceNamePlaceholder')}
                            value={instanceName}
                            onChange={(event) => setInstanceName(event.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            required
                          />
                        </div>
                      </>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="evolution-token">{t('writeToken')}</Label>
                      <Input
                        id="evolution-token"
                        name="token"
                        type={showToken ? 'text' : 'password'}
                        placeholder={t('writeTokenPlaceholder')}
                        value={token}
                        onChange={(event) => {
                          setToken(event.target.value);
                          setSaveError(null);
                          setSaveErrorField(null);
                          setSaveNotice(null);
                        }}
                        autoComplete="new-password"
                        autoCapitalize="none"
                        spellCheck={false}
                        required
                        aria-invalid={saveErrorField === 'token'}
                        aria-describedby={saveErrorField === 'token' ? 'evolution-token-error' : undefined}
                      />
                      {saveErrorField === 'token' && (
                        <p id="evolution-token-error" className="text-sm text-destructive">
                          {saveError}
                        </p>
                      )}
                      <button
                        type="button"
                        className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        onClick={() => setShowToken((visible) => !visible)}
                        aria-pressed={showToken}
                      >
                        {showToken ? t('hideToken') : t('showToken')}
                      </button>
                    </div>

                    {saveError && !saveErrorField && (
                      <p className="text-sm text-destructive" role="alert">{saveError}</p>
                    )}

                    <Button type="submit" disabled={busyAction !== null} aria-busy={busyAction === 'save'}>
                      {busyAction === 'save' && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                      {connection?.configured ? t('rotateToken') : t('saveConnection')}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>

          <aside className="space-y-6">
            <Card className="min-w-0 rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-foreground text-base">{t('operatorGuidanceTitle')}</CardTitle>
                <CardDescription>{t('operatorGuidance')}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t('messagesUnavailable')}</p>
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </section>
  );
}
