import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  createEvolutionFlowExecutor,
  type EvolutionFlowStore,
} from './evolution-executor';

const ROOT = {
  id: 'dispatch-1',
  engine: 'flow',
  state: 'processing',
  lease_token: 'root-lease',
  flow_id: 'flow-1',
  flow_run_id: 'run-1',
  event_id: 'event-1',
  account_id: 'account-1',
  contact_id: 'contact-1',
};

function harness(
  nodes: Array<{ node_key: string; node_type: string; config: unknown }>,
  vars: unknown = {}
) {
  const state = {
    run: {
      id: 'run-1',
      flow_id: 'flow-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      current_node_key: (nodes[0]?.node_key ?? null) as string | null,
      transition_seq: 0,
      status: 'active',
      vars,
    },
    nodes: nodes.map((node) => ({ ...node, flow_id: 'flow-1' })),
  };
  const store: EvolutionFlowStore = {
    loadRoot: vi.fn(async () => ROOT),
    startRoot: vi.fn(async () => 'run-1'),
    loadRun: vi.fn(async () => ({ ...state.run })),
    loadNodes: vi.fn(async () => state.nodes),
    evaluateCondition: vi.fn(async (_root, run, config) => {
      const raw = (run.vars as Record<string, unknown>)[
        String(config.subject_key)
      ];
      return raw === config.value;
    }),
    claimStep: vi.fn(async () => ({
      step_id: `step-${state.run.transition_seq}`,
      state: 'processing',
      lease_token: `step-lease-${state.run.transition_seq}`,
      request_id: `evolution-step:step-${state.run.transition_seq}`,
      should_execute: true,
    })),
    completeTransition: vi.fn(async (input) => {
      expect(input.dispatchId).toBe(ROOT.id);
      expect(input.dispatchLeaseToken).toBe(ROOT.lease_token);
      expect(input.flowRunId).toBe('run-1');
      expect(input.eventId).toBe('event-1');
      expect(input.expectedTransitionSeq).toBe(state.run.transition_seq);
      state.run.transition_seq += 1;
      state.run.current_node_key = input.nextNodeKey;
      state.run.status = input.nextStatus;
      return {
        applied: true,
        transition_seq: state.run.transition_seq,
        status: state.run.status,
      };
    }),
    completeSetTagTransition: vi.fn(async (input) => {
      expect(input.dispatchId).toBe(ROOT.id);
      expect(input.mode).toMatch(/^(add|remove)$/);
      state.run.transition_seq += 1;
      state.run.current_node_key = input.nextNodeKey;
      return {
        applied: true,
        transition_seq: state.run.transition_seq,
        status: 'active',
      };
    }),
    completeRoot: vi.fn(async () => undefined),
  };
  return { state, store, execute: createEvolutionFlowExecutor(store) };
}

describe('Evolution Flow isolated executor', () => {
  it('checkpoints start, decision branch, and end through the fenced transition contract', async () => {
    const h = harness(
      [
        {
          node_key: 'start',
          node_type: 'start',
          config: { next_node_key: 'decision' },
        },
        {
          node_key: 'decision',
          node_type: 'condition',
          config: {
            subject: 'var',
            subject_key: 'eligible',
            operator: 'equals',
            value: 'yes',
            true_next: 'finish',
            false_next: 'finish',
          },
        },
        { node_key: 'finish', node_type: 'end', config: {} },
      ],
      { eligible: 'yes' }
    );

    const result = await h.execute({
      dispatchId: ROOT.id,
      leaseToken: ROOT.lease_token!,
    });

    expect(result).toEqual({
      status: 'done',
      flowRunId: 'run-1',
      transitions: 3,
    });
    expect(h.store.claimStep).toHaveBeenCalledTimes(3);
    expect(h.store.completeTransition).toHaveBeenCalledTimes(3);
    expect(h.store.completeTransition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: 'node_entered',
        nodeKey: 'decision',
        payload: { branch: 'yes' },
        expectedTransitionSeq: 1,
      })
    );
    expect(h.store.completeRoot).toHaveBeenCalledWith(
      ROOT.id,
      ROOT.lease_token,
      'done',
      null
    );
  });

  it('does not claim or checkpoint unsupported nodes', async () => {
    const h = harness([
      {
        node_key: 'send',
        node_type: 'send_message',
        config: { text: 'not sent' },
      },
    ]);

    const result = await h.execute({
      dispatchId: ROOT.id,
      leaseToken: ROOT.lease_token!,
    });

    expect(result).toEqual({
      status: 'unsupported_node',
      flowRunId: 'run-1',
      nodeKey: 'send',
      nodeType: 'send_message',
    });
    expect(h.store.claimStep).not.toHaveBeenCalled();
    expect(h.store.completeTransition).not.toHaveBeenCalled();
    expect(h.store.completeRoot).not.toHaveBeenCalled();
  });

  it.each(['add', 'remove'] as const)(
    'applies %s through one fenced Flow set_tag checkpoint',
    async (mode) => {
      const h = harness([
        {
          node_key: 'label',
          node_type: 'set_tag',
          config: {
            mode,
            tag_id: 'd9428888-122b-4c9d-88dd-778877887788',
            next_node_key: 'finish',
          },
        },
        { node_key: 'finish', node_type: 'end', config: {} },
      ]);

      const result = await h.execute({
        dispatchId: ROOT.id,
        leaseToken: ROOT.lease_token!,
      });

      expect(result).toEqual({
        status: 'done',
        flowRunId: 'run-1',
        transitions: 2,
      });
      expect(h.store.claimStep).toHaveBeenCalledWith(
        ROOT.id,
        ROOT.lease_token,
        '0:label'
      );
      expect(h.store.completeSetTagTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeKey: 'label',
          mode,
          tagId: 'd9428888-122b-4c9d-88dd-778877887788',
          nextNodeKey: 'finish',
          expectedTransitionSeq: 0,
        })
      );
      expect(h.store.completeTransition).toHaveBeenCalledTimes(1);
    }
  );

  it('fails closed on an invalid set_tag config before claiming a step', async () => {
    const h = harness([
      {
        node_key: 'label',
        node_type: 'set_tag',
        config: { mode: 'replace', tag_id: 'tag', next_node_key: 'finish' },
      },
    ]);

    await expect(
      h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! })
    ).rejects.toMatchObject({
      code: 'set_tag_mode_invalid',
    });
    expect(h.store.claimStep).not.toHaveBeenCalled();
    expect(h.store.completeSetTagTransition).not.toHaveBeenCalled();
  });

  it('replays a completed set_tag checkpoint without applying it again', async () => {
    const h = harness([
      {
        node_key: 'label',
        node_type: 'set_tag',
        config: {
          mode: 'add',
          tag_id: 'd9428888-122b-4c9d-88dd-778877887788',
          next_node_key: 'finish',
        },
      },
      { node_key: 'finish', node_type: 'end', config: {} },
    ]);
    vi.mocked(h.store.claimStep).mockImplementationOnce(async () => {
      h.state.run.transition_seq = 1;
      h.state.run.current_node_key = 'finish';
      return {
        step_id: 'step-0',
        state: 'done',
        lease_token: null,
        request_id: 'evolution-step:step-0',
        should_execute: false,
      };
    });

    const result = await h.execute({
      dispatchId: ROOT.id,
      leaseToken: ROOT.lease_token!,
    });

    expect(result).toEqual({
      status: 'done',
      flowRunId: 'run-1',
      transitions: 2,
    });
    expect(h.store.completeSetTagTransition).not.toHaveBeenCalled();
    expect(h.store.completeTransition).toHaveBeenCalledTimes(1);
  });

  it('leaves a node untouched when another live step lease owns it', async () => {
    const h = harness([
      {
        node_key: 'start',
        node_type: 'start',
        config: { next_node_key: 'done' },
      },
      { node_key: 'done', node_type: 'end', config: {} },
    ]);
    vi.mocked(h.store.claimStep).mockResolvedValue({
      step_id: 'step-live',
      state: 'processing',
      lease_token: 'other-worker',
      request_id: 'evolution-step:step-live',
      should_execute: false,
    });

    const result = await h.execute({
      dispatchId: ROOT.id,
      leaseToken: ROOT.lease_token!,
    });

    expect(result).toEqual({
      status: 'waiting',
      flowRunId: 'run-1',
      nodeKey: 'start',
    });
    expect(h.store.completeTransition).not.toHaveBeenCalled();
    expect(h.store.completeRoot).not.toHaveBeenCalled();
  });

  it('reconciles an already-completed checkpoint by reading the advanced run', async () => {
    const h = harness([
      {
        node_key: 'start',
        node_type: 'start',
        config: { next_node_key: 'done' },
      },
      { node_key: 'done', node_type: 'end', config: {} },
    ]);
    vi.mocked(h.store.claimStep).mockImplementationOnce(async () => {
      h.state.run.current_node_key = 'done';
      h.state.run.transition_seq = 1;
      return {
        step_id: 'step-0',
        state: 'done',
        lease_token: null,
        request_id: 'evolution-step:step-0',
        should_execute: false,
      };
    });

    const result = await h.execute({
      dispatchId: ROOT.id,
      leaseToken: ROOT.lease_token!,
    });

    expect(result).toEqual({
      status: 'done',
      flowRunId: 'run-1',
      transitions: 2,
    });
    expect(h.store.completeTransition).toHaveBeenCalledTimes(1);
    expect(h.store.completeTransition).toHaveBeenCalledWith(
      expect.objectContaining({ nodeKey: 'done' })
    );
  });

  it('does not report failed terminal runs as successful roots', async () => {
    const h = harness([
      {
        node_key: 'start',
        node_type: 'start',
        config: { next_node_key: 'done' },
      },
    ]);
    h.state.run.status = 'failed';

    const result = await h.execute({
      dispatchId: ROOT.id,
      leaseToken: ROOT.lease_token!,
    });

    expect(result).toEqual({
      status: 'terminal_non_success',
      flowRunId: 'run-1',
      runStatus: 'failed',
    });
    expect(h.store.completeRoot).toHaveBeenCalledWith(
      ROOT.id,
      ROOT.lease_token,
      'failed',
      'flow_run_failed'
    );
  });

  it('reconciles applied=false only when the run reflects that exact checkpoint', async () => {
    const h = harness([
      {
        node_key: 'start',
        node_type: 'start',
        config: { next_node_key: 'done' },
      },
      { node_key: 'done', node_type: 'end', config: {} },
    ]);
    vi.mocked(h.store.completeTransition).mockImplementationOnce(
      async (input) => {
        h.state.run.transition_seq = 1;
        h.state.run.current_node_key = input.nextNodeKey;
        return { applied: false, transition_seq: 1, status: 'active' };
      }
    );

    const result = await h.execute({
      dispatchId: ROOT.id,
      leaseToken: ROOT.lease_token!,
    });

    expect(result).toEqual({
      status: 'done',
      flowRunId: 'run-1',
      transitions: 2,
    });
    expect(h.store.completeTransition).toHaveBeenCalledTimes(2);
  });

  it('fails closed when applied=false is not reflected by the run sequence', async () => {
    const h = harness([
      {
        node_key: 'start',
        node_type: 'start',
        config: { next_node_key: 'done' },
      },
      { node_key: 'done', node_type: 'end', config: {} },
    ]);
    vi.mocked(h.store.completeTransition).mockResolvedValueOnce({
      applied: false,
      transition_seq: 0,
      status: 'active',
    });

    await expect(
      h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! })
    ).rejects.toMatchObject({
      code: 'checkpoint_inconsistent',
    });
    expect(h.store.claimStep).toHaveBeenCalledTimes(1);
    expect(h.store.completeRoot).not.toHaveBeenCalled();
  });
});
