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
  user_id: 'user-1',
  account_id: 'account-1',
  contact_id: 'contact-1',
  conversation_id: 'conversation-1',
};

function harness(
  nodes: Array<{ node_key: string; node_type: string; config: unknown }>,
  vars: unknown = {}
) {
  const state = {
    promptEventId: null as string | null,
    run: {
      id: 'run-1',
      flow_id: 'flow-1',
      account_id: 'account-1',
      contact_id: 'contact-1',
      current_node_key: (nodes[0]?.node_key ?? null) as string | null,
      transition_seq: 0,
      status: 'active',
      vars,
      user_id: 'user-1',
      conversation_id: 'conversation-1',
    },
    nodes: nodes.map((node) => ({ ...node, flow_id: 'flow-1' })),
  };
  const store: EvolutionFlowStore = {
    loadRoot: vi.fn(async () => ROOT),
    isEntryEligible: vi.fn(async () => true),
    loadPromptEventId: vi.fn(async () => state.promptEventId),
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
    claimSendStep: vi.fn(async () => ({
      step_id: 'send-step-0',
      state: 'processing',
      lease_token: 'send-lease-0',
      request_id: 'evolution-step:send-step-0',
      send_attempt_id: null,
      should_execute: true,
      lease_acquired: true,
    })),
    loadSendContext: vi.fn(async (_root, _run, config) => ({
      connectionId: 'connection-1',
      conversationId: 'conversation-1',
      recipient: '15551234567@s.whatsapp.net',
      text: String(config.text),
      credentials: {
        baseUrl: 'http://127.0.0.1:8080',
        instanceId: 'fixture',
        token: 'synthetic',
      },
      senderId: 'user-1',
    })),
    sendText: vi.fn(async () => ({
      attemptId: 'attempt-1',
      messageRowId: 'message-row-1',
      outcome: 'accepted' as const,
      shouldSend: true,
      externalMessageId: 'external-1',
      persistenceUncertain: false,
    })),
    reconcileSend: vi.fn(async () => ({
      attemptId: 'attempt-1',
      messageRowId: 'message-row-1',
      outcome: 'accepted' as const,
      shouldSend: false,
    })),
    sendInteractive: vi.fn(async () => ({
      attemptId: 'attempt-1', messageRowId: 'message-row-1',
      outcome: 'accepted' as const, shouldSend: true,
      externalMessageId: 'external-1', persistenceUncertain: false,
    })),
    reconcileInteractiveSend: vi.fn(async () => ({
      attemptId: 'attempt-1', messageRowId: 'message-row-1',
      outcome: 'accepted' as const, shouldSend: false,
    })),
    linkSendAttempt: vi.fn(async () => undefined),
    completeTransition: vi.fn(async (input) => {
      expect(input.dispatchId).toBe(ROOT.id);
      expect(input.dispatchLeaseToken).toBe(ROOT.lease_token);
      expect(input.flowRunId).toBe('run-1');
      expect(input.eventId).toMatch(/^event-[12]$/);
      expect(input.expectedTransitionSeq).toBe(state.run.transition_seq);
      state.run.transition_seq += 1;
      state.run.current_node_key = input.nextNodeKey;
      state.run.status = input.nextStatus;
      if (input.eventType === 'message_sent' &&
          state.nodes.some((node) => node.node_key === input.nodeKey && node.node_type === 'collect_input'))
        state.promptEventId = input.eventId;
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
    completeCollectInputReply: vi.fn(async (input) => {
      const node = state.nodes.find((candidate) => candidate.node_key === input.nodeKey);
      const config = node?.config as { var_key: string; next_node_key: string };
      state.run.vars = { ...(state.run.vars as Record<string, unknown>), [config.var_key]: 'Ray' };
      state.run.current_node_key = config.next_node_key;
      state.run.transition_seq += 1;
      state.promptEventId = null;
      return { applied: true, transition_seq: state.run.transition_seq, status: 'active' };
    }),
    completeHandoff: vi.fn(async () => {
      state.run.transition_seq += 1;
      state.run.status = 'handed_off';
      return { applied: true, transition_seq: state.run.transition_seq, status: 'handed_off' };
    }),
    completeInteractivePrompt: vi.fn(async (input) => {
      state.run.transition_seq += 1;
      state.promptEventId = input.eventId;
      return { applied: true, transition_seq: state.run.transition_seq,
        status: 'active', prompt_message_id: 'message-row-1' };
    }),
    completeInteractiveReply: vi.fn(async () => {
      state.run.transition_seq += 1;
      state.run.current_node_key = 'end';
      state.promptEventId = null;
      return { applied: true, transition_seq: state.run.transition_seq,
        status: 'active', next_node_key: 'end' };
    }),
    completeRoot: vi.fn(async () => undefined),
  };
  return { state, store, execute: createEvolutionFlowExecutor(store) };
}

describe('Evolution Flow isolated executor', () => {
  it('skips a nonmatching new root without creating a run or a step', async () => {
    const h = harness([{ node_key: 'start', node_type: 'start', config: { next_node_key: 'end' } }]);
    vi.mocked(h.store.loadRoot).mockResolvedValue({ ...ROOT, flow_run_id: null });
    vi.mocked(h.store.isEntryEligible).mockResolvedValue(false);

    await expect(h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! }))
      .resolves.toEqual({ status: 'skipped' });
    expect(h.store.startRoot).not.toHaveBeenCalled();
    expect(h.store.claimStep).not.toHaveBeenCalled();
    expect(h.store.completeRoot).toHaveBeenCalledWith(ROOT.id, ROOT.lease_token, 'skipped', null);
  });

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
        node_type: 'send_media',
        config: {},
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
      nodeType: 'send_media',
    });
    expect(h.store.claimStep).not.toHaveBeenCalled();
    expect(h.store.completeTransition).not.toHaveBeenCalled();
    expect(h.store.completeRoot).not.toHaveBeenCalled();
  });

  it('sends a collect_input prompt once, then captures a later reply and continues', async () => {
    const h = harness([
      {
        node_key: 'ask_name',
        node_type: 'collect_input',
        config: { prompt_text: 'Your name?', var_key: 'name', next_node_key: 'finish' },
      },
      { node_key: 'finish', node_type: 'end', config: {} },
    ]);
    vi.mocked(h.store.loadRoot).mockResolvedValueOnce({ ...ROOT, flow_run_id: null });

    const first = await h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! });
    expect(first).toEqual({ status: 'waiting', flowRunId: 'run-1', nodeKey: 'ask_name' });
    expect(h.store.sendText).toHaveBeenCalledTimes(1);
    expect(h.store.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Your name?' })
    );
    expect(h.store.completeTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'message_sent', nodeKey: 'ask_name',
        nextNodeKey: 'ask_name', expectedTransitionSeq: 0,
      })
    );
    expect(h.store.completeRoot).toHaveBeenCalledWith(ROOT.id, ROOT.lease_token, 'done', null);

    vi.mocked(h.store.loadRoot).mockResolvedValueOnce({ ...ROOT, event_id: 'event-2', flow_run_id: null });
    const second = await h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! });
    expect(second).toEqual({ status: 'done', flowRunId: 'run-1', transitions: 2 });
    expect(h.store.sendText).toHaveBeenCalledTimes(1);
    expect(h.store.completeCollectInputReply).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event-2', nodeKey: 'ask_name', expectedTransitionSeq: 1 })
    );
    expect(h.state.run.vars).toEqual({ name: 'Ray' });
  });

  it('does not treat the prompt-triggering event as the collect_input reply', async () => {
    const h = harness([
      { node_key: 'ask', node_type: 'collect_input',
        config: { prompt_text: 'Reply?', var_key: 'reply', next_node_key: 'finish' } },
      { node_key: 'finish', node_type: 'end', config: {} },
    ]);
    h.state.promptEventId = ROOT.event_id;
    h.state.run.transition_seq = 1;

    await expect(h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! }))
      .resolves.toEqual({ status: 'waiting', flowRunId: 'run-1', nodeKey: 'ask' });
    expect(h.store.sendText).not.toHaveBeenCalled();
    expect(h.store.completeCollectInputReply).not.toHaveBeenCalled();
  });

  it('finishes a handoff through one fenced local transition', async () => {
    const h = harness([
      { node_key: 'transfer', node_type: 'handoff', config: { note: 'Please follow up' } },
    ]);

    await expect(h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! }))
      .resolves.toEqual({ status: 'done', flowRunId: 'run-1', transitions: 1 });
    expect(h.store.completeHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: ROOT.event_id,
        expectedTransitionSeq: 0,
        nodeKey: 'transfer',
      })
    );
    expect(h.store.completeTransition).not.toHaveBeenCalled();
    expect(h.store.completeRoot).toHaveBeenCalledWith(ROOT.id, ROOT.lease_token, 'done', null);
  });

  it('sends a button prompt once and waits on the same Flow node', async () => {
    const h = harness([
      { node_key: 'choose', node_type: 'send_buttons', config: {
        text: 'Escolha', buttons: [{ reply_id: 'yes', title: 'Sim', next_node_key: 'end' }],
      } },
      { node_key: 'end', node_type: 'end', config: {} },
    ]);

    await expect(h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! }))
      .resolves.toEqual({ status: 'waiting', flowRunId: 'run-1', nodeKey: 'choose' });
    expect(h.store.sendInteractive).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({
        kind: 'buttons', requestId: 'evolution-step:send-step-0',
        buttons: [{ id: 'yes', displayText: 'Sim' }],
      }),
    }));
    expect(h.store.completeInteractivePrompt).toHaveBeenCalledTimes(1);
    expect(h.store.completeTransition).not.toHaveBeenCalled();
    expect(h.store.completeRoot).toHaveBeenCalledWith(ROOT.id, ROOT.lease_token, 'done', null);
  });

  it('uses an interactive reply root to advance from the prompt without resending', async () => {
    const h = harness([
      { node_key: 'choose', node_type: 'send_list', config: {
        text: 'Escolha', button_label: 'Abrir',
        sections: [{ title: 'Opções', rows: [{ reply_id: 'one', title: 'Um', next_node_key: 'end' }] }],
      } },
      { node_key: 'end', node_type: 'end', config: {} },
    ]);
    h.state.promptEventId = 'event-1';
    h.state.run.transition_seq = 1;
    vi.mocked(h.store.loadRoot).mockResolvedValue({ ...ROOT, event_id: 'event-2' });

    await expect(h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! }))
      .resolves.toEqual({ status: 'done', flowRunId: 'run-1', transitions: 2 });
    expect(h.store.completeInteractiveReply).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'event-2', nodeKey: 'choose', expectedTransitionSeq: 1,
    }));
    expect(h.store.sendInteractive).not.toHaveBeenCalled();
    expect(h.store.completeTransition).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'event-2', nodeKey: 'end', eventType: 'completed',
    }));
  });

  it('sends once and advances only after a known accepted attempt', async () => {
    const h = harness([
      {
        node_key: 'send',
        node_type: 'send_message',
        config: { text: 'Hello', next_node_key: 'finish' },
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
    expect(h.store.claimSendStep).toHaveBeenCalledWith(
      ROOT.id,
      ROOT.lease_token,
      '0:send'
    );
    expect(h.store.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hello',
        senderType: 'bot',
        senderId: 'user-1',
        requestId: 'evolution-step:send-step-0',
      })
    );
    expect(h.store.linkSendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'attempt-1',
        state: 'processing',
      })
    );
    expect(h.store.completeTransition).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: 'message_sent',
        nodeKey: 'send',
        payload: { outcome: 'accepted' },
        nextNodeKey: 'finish',
      })
    );
  });

  it('replays an accepted linked attempt without another send', async () => {
    const h = harness([
      {
        node_key: 'send',
        node_type: 'send_message',
        config: { text: 'Hello', next_node_key: 'finish' },
      },
      { node_key: 'finish', node_type: 'end', config: {} },
    ]);
    vi.mocked(h.store.claimSendStep).mockResolvedValueOnce({
      step_id: 'send-step-0',
      state: 'processing',
      lease_token: 'send-lease-recovered',
      request_id: 'evolution-step:send-step-0',
      send_attempt_id: 'attempt-1',
      should_execute: false,
      lease_acquired: true,
    });

    const result = await h.execute({
      dispatchId: ROOT.id,
      leaseToken: ROOT.lease_token!,
    });

    expect(result.status).toBe('done');
    expect(h.store.sendText).not.toHaveBeenCalled();
    expect(h.store.reconcileSend).toHaveBeenCalledTimes(1);
    expect(h.store.completeTransition).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'message_sent', nodeKey: 'send' })
    );
  });

  it('does not advance a pending reservation', async () => {
    const h = harness([
      {
        node_key: 'send',
        node_type: 'send_message',
        config: { text: 'Hello', next_node_key: 'finish' },
      },
      { node_key: 'finish', node_type: 'end', config: {} },
    ]);
    vi.mocked(h.store.claimSendStep).mockResolvedValueOnce({
      step_id: 'send-step-0',
      state: 'processing',
      lease_token: 'send-lease-recovered',
      request_id: 'evolution-step:send-step-0',
      send_attempt_id: 'attempt-1',
      should_execute: false,
      lease_acquired: true,
    });
    vi.mocked(h.store.reconcileSend).mockResolvedValueOnce({
      attemptId: 'attempt-1',
      messageRowId: 'message-row-1',
      outcome: 'pending',
      shouldSend: false,
    });

    await expect(
      h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! })
    ).resolves.toEqual({
      status: 'waiting',
      flowRunId: 'run-1',
      nodeKey: 'send',
    });
    expect(h.store.sendText).not.toHaveBeenCalled();
    expect(h.store.completeTransition).not.toHaveBeenCalled();
  });

  it('fails closed on unknown replay and never advances', async () => {
    const h = harness([
      {
        node_key: 'send',
        node_type: 'send_message',
        config: { text: 'Hello', next_node_key: 'finish' },
      },
      { node_key: 'finish', node_type: 'end', config: {} },
    ]);
    vi.mocked(h.store.claimSendStep).mockResolvedValueOnce({
      step_id: 'send-step-0',
      state: 'processing',
      lease_token: 'send-lease-recovered',
      request_id: 'evolution-step:send-step-0',
      send_attempt_id: 'attempt-1',
      should_execute: false,
      lease_acquired: true,
    });
    vi.mocked(h.store.reconcileSend).mockResolvedValueOnce({
      attemptId: 'attempt-1',
      messageRowId: 'message-row-1',
      outcome: 'unknown',
      shouldSend: false,
    });

    await expect(
      h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! })
    ).rejects.toMatchObject({ code: 'send_outcome_unknown' });
    expect(h.store.sendText).not.toHaveBeenCalled();
    expect(h.store.completeTransition).not.toHaveBeenCalled();
    expect(h.store.linkSendAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'unknown', attemptId: 'attempt-1' })
    );
  });

  it('never sends when the send claim did not acquire its lease', async () => {
    const h = harness([
      {
        node_key: 'send',
        node_type: 'send_message',
        config: { text: 'Hello', next_node_key: 'finish' },
      },
      { node_key: 'finish', node_type: 'end', config: {} },
    ]);
    vi.mocked(h.store.claimSendStep).mockResolvedValueOnce({
      step_id: 'send-step-0',
      state: 'processing',
      lease_token: 'other-lease',
      request_id: 'evolution-step:send-step-0',
      send_attempt_id: null,
      should_execute: true,
      lease_acquired: false,
    });

    await expect(
      h.execute({ dispatchId: ROOT.id, leaseToken: ROOT.lease_token! })
    ).rejects.toMatchObject({ code: 'send_step_claim_invalid' });
    expect(h.store.sendText).not.toHaveBeenCalled();
    expect(h.store.completeTransition).not.toHaveBeenCalled();
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
