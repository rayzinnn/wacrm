import 'server-only';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { executeEvolutionAutomationDispatch } from '@/lib/automations/evolution-automation-orchestrator';
import type { ReservedEvolutionAutomationDispatch } from '@/lib/automations/evolution-dispatch-preparer';
import type { EvolutionAutomationOrchestrationResult } from '@/lib/automations/evolution-automation-orchestrator';

interface ClaimedAutomationRoot {
  id: string;
  engine: string;
  account_id: string;
  state: string;
  lease_token: string;
}

export type EvolutionAutomationDispatchBatchItem =
  | EvolutionAutomationOrchestrationResult
  | { state: 'error'; dispatch_id: string | null; error_code: string };

export interface EvolutionAutomationDispatchBatchResult {
  claimed: number;
  outcomes: EvolutionAutomationDispatchBatchItem[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ERROR_CODE = /^[a-z0-9][a-z0-9_]{0,47}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string') {
    return SAFE_ERROR_CODE.test(error.code) ? error.code : 'worker_error';
  }
  return 'worker_error';
}

function isClaimedAutomationRoot(
  value: unknown
): value is ClaimedAutomationRoot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    UUID_PATTERN.test(value.id) &&
    value.engine === 'automation' &&
    typeof value.account_id === 'string' &&
    UUID_PATTERN.test(value.account_id) &&
    value.state === 'processing' &&
    typeof value.lease_token === 'string' &&
    UUID_PATTERN.test(value.lease_token)
  );
}

/** Claims and processes one batch of automation roots without activating a scheduler. */
export async function runEvolutionAutomationDispatchBatch(options?: {
  limit?: number;
  leaseSeconds?: number;
}): Promise<EvolutionAutomationDispatchBatchResult> {
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
    'claim_evolution_automation_dispatches',
    { p_limit: limit, p_lease_seconds: leaseSeconds }
  );
  if (error) throw new Error('Could not claim Evolution automation roots');
  if (data !== null && !Array.isArray(data)) {
    throw new Error('Automation root claim returned an invalid batch');
  }
  const roots: unknown[] = data ?? [];
  const outcomes: EvolutionAutomationDispatchBatchItem[] = [];

  if (roots.length > limit) {
    return {
      claimed: roots.length,
      outcomes: roots.map((value) => ({
        state: 'error' as const,
        dispatch_id:
          isRecord(value) && typeof value.id === 'string' ? value.id : null,
        error_code: 'claim_limit_exceeded',
      })),
    };
  }

  for (const value of roots) {
    const dispatchId =
      isRecord(value) && typeof value.id === 'string' ? value.id : null;
    if (!isClaimedAutomationRoot(value)) {
      outcomes.push({
        state: 'error',
        dispatch_id: dispatchId,
        error_code:
          isRecord(value) && value.engine !== 'automation'
            ? 'unexpected_engine'
            : 'claim_row_invalid',
      });
      continue;
    }

    const reserved: ReservedEvolutionAutomationDispatch = {
      dispatch_id: value.id,
      lease_token: value.lease_token,
      account_id: value.account_id,
    };
    try {
      outcomes.push(await executeEvolutionAutomationDispatch(reserved));
    } catch (error) {
      // A root failure is recorded as a sanitized item, not a batch rejection.
      outcomes.push({
        state: 'error',
        dispatch_id: value.id,
        error_code: errorCode(error),
      });
    }
  }

  return { claimed: roots.length, outcomes };
}
