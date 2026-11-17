import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CRON_URL = 'http://127.0.0.1:3000/api/whatsapp/evolution/events/cron'
const FLOW_CRON_URL = 'http://127.0.0.1:3000/api/whatsapp/evolution/flow/cron'
const AUTOMATION_CRON_URL = 'http://127.0.0.1:3000/api/whatsapp/evolution/automation/cron'
const REQUEST_TIMEOUT_MS = 45_000
const CYCLE_INTERVAL_MS = 10_000
const ENV_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')

function loadCronSecret() {
  process.loadEnvFile(ENV_FILE)
  return process.env.EVOLUTION_EVENTS_CRON_SECRET ?? ''
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

async function runCycle(secret, url, engine) {
  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${secret}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    console.log(JSON.stringify({ engine, status: 'request_failed' }))
    return false
  }

  if (!response.ok) {
    console.log(JSON.stringify({ engine, status: response.status }))
    return false
  }

  try {
    const body = await response.json()
    const counts = engine === 'events' ? body : engine === 'flow' ? body?.flow : body?.automation
    const keys = engine === 'events'
      ? ['claimed', 'done', 'retry', 'failed', 'stale']
      : engine === 'flow'
        ? ['claimed', 'done', 'skipped', 'waiting', 'unsupported', 'terminalNonSuccess', 'transitionLimit', 'errors']
        : ['claimed', 'done', 'skipped', 'failed', 'unknown', 'waiting', 'processing', 'errors']
    if (counts && keys.every((key) => isCount(counts[key]))) {
      console.log(JSON.stringify({ engine, status: response.status,
        ...Object.fromEntries(keys.map((key) => [key, counts[key]])) }))
      return true
    }
  } catch {
    // The HTTP status is sufficient for the local operator; never print a body or error.
  }

  console.log(JSON.stringify({ engine, status: response.status }))
  return false
}

async function runAll(secret) {
  const eventsOk = await runCycle(secret, CRON_URL, 'events')
  const flowOk = await runCycle(secret, FLOW_CRON_URL, 'flow')
  const automationOk = await runCycle(secret, AUTOMATION_CRON_URL, 'automation')
  return eventsOk && flowOk && automationOk
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--once')) {
    console.log(JSON.stringify({ status: 'invalid_args' }))
    process.exitCode = 2
    return
  }

  let secret
  try {
    secret = loadCronSecret()
  } catch {
    console.log(JSON.stringify({ status: 'env_unavailable' }))
    process.exitCode = 1
    return
  }
  if (!secret) {
    console.log(JSON.stringify({ status: 'not_configured' }))
    process.exitCode = 1
    return
  }

  if (args.includes('--once')) {
    if (!(await runAll(secret))) process.exitCode = 1
    return
  }

  for (;;) {
    const cycleStartedAt = Date.now()
    await runAll(secret)
    const delay = Math.max(0, CYCLE_INTERVAL_MS - (Date.now() - cycleStartedAt))
    await new Promise((resolveCycle) => setTimeout(resolveCycle, delay))
  }
}

await main()
