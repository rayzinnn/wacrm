import 'server-only';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { processEvolutionFlowRoot } from '@/lib/flows/evolution-executor';
import type { EvolutionFlowExecutionResult } from '@/lib/flows/evolution-executor';

interface ClaimedFlowRoot {
  id: string;
  engine: 'flow';
  state: 'processing';
  lease_token: string;
}

export type EvolutionFlowDispatchBatchItem =
  | EvolutionFlowExecutionResult
  | { status: 'error'; dispatchId: string | null; errorCode: string };

export interface EvolutionFlowDispatchBatchResult {
  claimed: number;
  outcomes: EvolutionFlowDispatchBatchItem[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ERROR_CODE = /^[a-z0-9][a-z0-9_]{0,47}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeDispatchId(value: unknown): string | null {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id)
    ? value.id
    : null;
}

function errorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string') {
    return SAFE_ERROR_CODE.test(error.code) ? error.code : 'worker_error';
  }
  return 'worker_error';
}

function isClaimedFlowRoot(value: unknown): value is ClaimedFlowRoot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    value.engine === 'flow' &&
    value.state === 'processing' &&
    typeof value.lease_token === 'string' &&
    UUID_PATTERN.test(value.lease_token)
  );
}

/** Claims and processes at most one Flow root; no scheduler or route activates it. */
export async function runEvolutionFlowDispatchBatch(options?: {
  limit?: number;
  leaseSeconds?: number;
}): Promise<EvolutionFlowDispatchBatchResult> {
  const limit = options?.limit ?? 1;
  const leaseSeconds = options?.leaseSeconds ?? 60;
  if (limit !== 1) {
    throw new RangeError(
      'limit must be 1 until root lease renewal is available'
    );
  }
  if (
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 1 ||
    leaseSeconds > 60
  ) {
    throw new RangeError('leaseSeconds must be an integer from 1 through 60');
  }

  const { data, error } = await supabaseAdmin().rpc(
    'claim_evolution_flow_dispatches',
    { p_limit: limit, p_lease_seconds: leaseSeconds }
  );
  if (error) throw new Error('Could not claim Evolution Flow roots');
  if (data !== null && !Array.isArray(data)) {
    throw new Error('Flow root claim returned an invalid batch');
  }

  const roots: unknown[] = data ?? [];
  if (roots.length > limit) {
    return {
      claimed: roots.length,
      outcomes: roots.map((value) => ({
        status: 'error' as const,
        dispatchId: safeDispatchId(value),
        errorCode: 'claim_limit_exceeded',
      })),
    };
  }

  const outcomes: EvolutionFlowDispatchBatchItem[] = [];
  for (const value of roots) {
    if (!isClaimedFlowRoot(value)) {
      outcomes.push({
        status: 'error',
        dispatchId: safeDispatchId(value),
        errorCode:
          isRecord(value) && value.engine !== 'flow'
            ? 'unexpected_engine'
            : 'claim_row_invalid',
      });
      continue;
    }

    try {
      outcomes.push(
        await processEvolutionFlowRoot({
          dispatchId: value.id,
          leaseToken: value.lease_token,
        })
      );
    } catch (error) {
      outcomes.push({
        status: 'error',
        dispatchId: value.id,
        errorCode: errorCode(error),
      });
    }
  }

  return { claimed: roots.length, outcomes };
}
