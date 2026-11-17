export type EvolutionInteractiveReply = {
  kind: 'button' | 'list';
  replyId: string;
  label: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function replyId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200 ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value))
    return null;
  return value;
}

function label(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(trimmed)
    ? trimmed
    : null;
}

/** Extracts an explicit Baileys selection ID; never guesses from free text. */
export function readEvolutionInteractiveReply(
  messageType: unknown,
  message: unknown
): EvolutionInteractiveReply | null {
  const body = record(message);
  if (!body) return null;

  if (messageType === 'buttonsResponseMessage') {
    const choice = record(body.buttonsResponseMessage);
    const id = replyId(choice?.selectedButtonId);
    return id
      ? { kind: 'button', replyId: id, label: label(choice?.selectedDisplayText) }
      : null;
  }
  if (messageType === 'templateButtonReplyMessage') {
    const choice = record(body.templateButtonReplyMessage);
    const id = replyId(choice?.selectedId);
    return id
      ? { kind: 'button', replyId: id, label: label(choice?.selectedDisplayText) }
      : null;
  }
  if (messageType === 'interactiveResponseMessage') {
    const choice = record(body.interactiveResponseMessage);
    const flow = record(choice?.nativeFlowResponseMessage);
    if (flow?.name !== 'quick_reply' ||
        typeof flow.paramsJson !== 'string' || flow.paramsJson.length > 2048)
      return null;
    let params: unknown;
    try { params = JSON.parse(flow.paramsJson); }
    catch { return null; }
    const parsed = record(params);
    const id = replyId(parsed?.id);
    return id
      ? { kind: 'button', replyId: id,
          label: label(record(choice?.body)?.text) ?? label(parsed?.display_text) }
      : null;
  }
  if (messageType === 'listResponseMessage') {
    const choice = record(body.listResponseMessage);
    const id = replyId(record(choice?.singleSelectReply)?.selectedRowId);
    return id
      ? { kind: 'list', replyId: id, label: label(choice?.title) }
      : null;
  }
  return null;
}
