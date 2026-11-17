export const EVOLUTION_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

export type EvolutionOutboundKind = "image" | "document";
export type EvolutionComposerKind = EvolutionOutboundKind | "audio" | "video";

export function canStageEvolutionKind(
  kind: EvolutionComposerKind,
  capabilities: readonly string[],
): kind is EvolutionOutboundKind {
  return (kind === "image" || kind === "document") && capabilities.includes(kind);
}

const ALLOWED_MEDIA: Record<string, { kind: EvolutionOutboundKind; extensions: string[] }> = {
  "image/png": { kind: "image", extensions: ["png"] },
  "image/jpeg": { kind: "image", extensions: ["jpg", "jpeg"] },
  "application/pdf": { kind: "document", extensions: ["pdf"] },
};

export type StagedEvolutionMedia = {
  stageId: string;
  kind: EvolutionOutboundKind;
  filename: string;
  previewUrl: string;
  idempotencyKey: string;
};

export function validateEvolutionMediaFile(file: Pick<File, "name" | "size" | "type">): string | null {
  const descriptor = ALLOWED_MEDIA[file.type.toLowerCase()];
  if (!descriptor) return "unsupported_file_type";
  if (!Number.isSafeInteger(file.size) || file.size < 1) return "invalid_file";
  if (file.size > EVOLUTION_MEDIA_MAX_BYTES) return "file_too_large";
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !descriptor.extensions.includes(extension)) return "file_type_mismatch";
  return null;
}

export async function stageEvolutionMedia(
  file: File,
  conversationId: string,
  fetcher: typeof fetch = fetch,
): Promise<StagedEvolutionMedia> {
  const validationError = validateEvolutionMediaFile(file);
  if (validationError) throw new Error(validationError);

  const query = new URLSearchParams({ conversation_id: conversationId, filename: file.name });
  const response = await fetcher(`/api/whatsapp/media/staging?${query}`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  const kind = result?.content_type;
  const filename = result?.filename;
  const stageId = result?.media_ref?.stage_id;
  if (!response.ok || typeof stageId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stageId) ||
    (kind !== "image" && kind !== "document") || typeof filename !== "string") {
    throw new Error(typeof result?.error === "string" ? result.error : "staging_failed");
  }

  return {
    stageId,
    kind,
    filename,
    previewUrl: `/api/whatsapp/media/staging/${encodeURIComponent(stageId)}`,
    idempotencyKey: crypto.randomUUID(),
  };
}

export async function sendStagedEvolutionMedia(
  input: { conversationId: string; stageId: string; caption?: string; idempotencyKey: string },
  fetcher: typeof fetch = fetch,
): Promise<{ outcome: "accepted" | "pending" | "unknown" | "rejected"; messageId?: string }> {
  try {
    const response = await fetcher("/api/whatsapp/media/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        conversation_id: input.conversationId,
        media_ref: { version: 1, stage_id: input.stageId },
        ...(input.caption ? { caption: input.caption } : {}),
      }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    const messageId = typeof result?.message_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.message_id)
      ? result.message_id
      : undefined;
    if (response.ok && result?.outcome === "accepted") {
      return messageId ? { outcome: "accepted", messageId } : { outcome: "unknown" };
    }
    if (result?.outcome === "unknown" || result?.outcome === "pending" || response.status === 504) {
      return { outcome: result?.outcome === "pending" ? "pending" : "unknown", ...(messageId ? { messageId } : {}) };
    }
    return { outcome: "rejected", ...(messageId ? { messageId } : {}) };
  } catch {
    // A network failure may happen after the server/provider accepted the POST.
    // Keep this attempt unresolved and never retry automatically.
    return { outcome: "unknown" };
  }
}
