import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runEvolutionFlowDispatchBatch } from '@/lib/flows/evolution-dispatch-worker';

export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };
const UNAUTHORIZED = { error: 'Unauthorized.', code: 'unauthorized' };
const NOT_CONFIGURED = {
  error: 'Evolution Flow cron is not configured.',
  code: 'flow_cron_not_configured',
};
const UNAVAILABLE = {
  error: 'Evolution Flow processing is unavailable.',
  code: 'flow_cron_unavailable',
};

type FlowBatchSummary = {
  claimed: number;
  done: number;
  skipped: number;
  waiting: number;
  unsupported: number;
  terminalNonSuccess: number;
  transitionLimit: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizeBatch(result: unknown): FlowBatchSummary {
  if (
    !isRecord(result) ||
    typeof result.claimed !== 'number' ||
    !Number.isInteger(result.claimed) ||
    result.claimed < 0 ||
    result.claimed > 1 ||
    !Array.isArray(result.outcomes) ||
    result.outcomes.length !== result.claimed
  ) {
    throw new Error('Invalid Flow batch result');
  }

  const summary: FlowBatchSummary = {
    claimed: result.claimed,
    done: 0,
    skipped: 0,
    waiting: 0,
    unsupported: 0,
    terminalNonSuccess: 0,
    transitionLimit: 0,
    errors: 0,
  };
  for (const outcome of result.outcomes) {
    if (!isRecord(outcome) || typeof outcome.status !== 'string') {
      summary.errors += 1;
      continue;
    }
    switch (outcome.status) {
      case 'done':
        summary.done += 1;
        break;
      case 'skipped':
        summary.skipped += 1;
        break;
      case 'waiting':
        summary.waiting += 1;
        break;
      case 'unsupported_node':
        summary.unsupported += 1;
        break;
      case 'terminal_non_success':
        summary.terminalNonSuccess += 1;
        break;
      case 'transition_limit':
        summary.transitionLimit += 1;
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
    const batch = await runEvolutionFlowDispatchBatch({ limit: 1 });
    const summary = summarizeBatch(batch);
    return NextResponse.json({ flow: summary }, { headers: NO_STORE });
  } catch {
    return NextResponse.json(UNAVAILABLE, { status: 503, headers: NO_STORE });
  }
}
