import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CRON_URL = 'http://127.0.0.1:3000/api/whatsapp/evolution/events/cron'
const REQUEST_TIMEOUT_MS = 45_000
const CYCLE_INTERVAL_MS = 60_000
const ENV_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local')

function loadCronSecret() {
  process.loadEnvFile(ENV_FILE)
  return process.env.EVOLUTION_EVENTS_CRON_SECRET ?? ''
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

async function runCycle(secret) {
  let response
  try {
    response = await fetch(CRON_URL, {
      method: 'GET',
      headers: { authorization: `Bearer ${secret}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    console.log(JSON.stringify({ status: 'request_failed' }))
    return false
  }

  if (!response.ok) {
    console.log(JSON.stringify({ status: response.status }))
    return false
  }

  try {
    const body = await response.json()
    if (
      body &&
      isCount(body.claimed) &&
      isCount(body.done) &&
      isCount(body.retry) &&
      isCount(body.failed) &&
      isCount(body.stale)
    ) {
      console.log(JSON.stringify({
        status: response.status,
        claimed: body.claimed,
        done: body.done,
        retry: body.retry,
        failed: body.failed,
        stale: body.stale,
      }))
      return true
    }
  } catch {
    // The HTTP status is sufficient for the local operator; never print a body or error.
  }

  console.log(JSON.stringify({ status: response.status }))
  return false
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
    if (!(await runCycle(secret))) process.exitCode = 1
    return
  }

  for (;;) {
    const cycleStartedAt = Date.now()
    await runCycle(secret)
    const delay = Math.max(0, CYCLE_INTERVAL_MS - (Date.now() - cycleStartedAt))
    await new Promise((resolveCycle) => setTimeout(resolveCycle, delay))
  }
}

await main()
