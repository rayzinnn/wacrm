import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runEvolutionAutomationDispatchBatch } from '@/lib/automations/evolution-automation-dispatch-worker';
import { consumeDueEvolutionAutomationWait } from '@/lib/automations/evolution-automation-pending-consumer';

export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };
const UNAUTHORIZED = { error: 'Unauthorized.', code: 'unauthorized' };
const NOT_CONFIGURED = {
  error: 'Evolution automation cron is not configured.',
  code: 'automation_cron_not_configured',
};
const UNAVAILABLE = {
  error: 'Evolution automation processing is unavailable.',
  code: 'automation_cron_unavailable',
};

type BatchSummary = {
  claimed: number;
  done: number;
  skipped: number;
  failed: number;
  unknown: number;
  waiting: number;
  processing: number;
  errors: number;
};

function hasValidBearer(request: Request): boolean {
  const expectedSecret = process.env.EVOLUTION_EVENTS_CRON_SECRET;
  if (!expectedSecret) return false;

  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) return false;

  const expected = Buffer.from(expectedSecret, 'utf8');
  const supplied = Buffer.from(match[1], 'utf8');
  return (
    expected.length > 0 &&
    expected.length === supplied.length &&
    timingSafeEqual(expected, supplied)
  );
}

function configuredSecret(): boolean {
  return Boolean(process.env.EVOLUTION_EVENTS_CRON_SECRET);
}

function summarizeBatch(result: unknown): BatchSummary {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('claimed' in result) ||
    typeof result.claimed !== 'number' ||
    !Number.isInteger(result.claimed) ||
    result.claimed < 0 ||
    !('outcomes' in result) ||
    !Array.isArray(result.outcomes)
  ) {
    throw new Error('Invalid automation batch result');
  }

  const summary: BatchSummary = {
    claimed: result.claimed,
    done: 0,
    skipped: 0,
    failed: 0,
    unknown: 0,
    waiting: 0,
    processing: 0,
    errors: 0,
  };
  for (const outcome of result.outcomes) {
    if (
      typeof outcome !== 'object' ||
      outcome === null ||
      !('state' in outcome)
    ) {
      summary.errors += 1;
      continue;
    }
    switch (outcome.state) {
      case 'done':
        summary.done += 1;
        break;
      case 'skipped':
        summary.skipped += 1;
        break;
      case 'failed':
        summary.failed += 1;
        break;
      case 'unknown':
        summary.unknown += 1;
        break;
      case 'waiting':
        summary.waiting += 1;
        break;
      case 'processing':
        summary.processing += 1;
        break;
      case 'error':
      default:
        summary.errors += 1;
        break;
    }
  }
  return summary;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!configuredSecret()) {
    return NextResponse.json(NOT_CONFIGURED, {
      status: 503,
      headers: NO_STORE,
    });
  }
  if (!hasValidBearer(request)) {
    return NextResponse.json(UNAUTHORIZED, { status: 401, headers: NO_STORE });
  }

  try {
    const batch = await runEvolutionAutomationDispatchBatch({ limit: 1 });
    const summary = summarizeBatch(batch);
    const wait = await consumeDueEvolutionAutomationWait();
    const waitState =
      wait.state === 'idle' ||
      wait.state === 'waiting' ||
      wait.state === 'processing' ||
      wait.state === 'done' ||
      wait.state === 'failed' ||
      wait.state === 'unknown'
        ? wait.state
        : 'unknown';

    return NextResponse.json(
      { automation: summary, temporal_wait: waitState },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json(UNAVAILABLE, { status: 503, headers: NO_STORE });
  }
}
