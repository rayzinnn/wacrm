import { describe, expect, it, vi } from "vitest";
import {
  canStageEvolutionKind,
  sendStagedEvolutionMedia,
  stageEvolutionMedia,
  validateEvolutionMediaFile,
} from "./evolution-media-composer";

const png = new File([new Uint8Array([137, 80, 78, 71])], "preview.png", { type: "image/png" });

describe("Evolution media composer pipeline", () => {
  it("gates each visible attachment independently and never enables Evolution audio/video", () => {
    expect(canStageEvolutionKind("image", ["image"])).toBe(true);
    expect(canStageEvolutionKind("document", ["image"])).toBe(false);
    expect(canStageEvolutionKind("document", ["document"])).toBe(true);
    expect(canStageEvolutionKind("image", ["document"])).toBe(false);
    expect(canStageEvolutionKind("audio", ["audio"])).toBe(false);
    expect(canStageEvolutionKind("video", ["video"])).toBe(false);
    expect(canStageEvolutionKind("image", [])).toBe(false);
  });

  it("rejects unsupported, mismatched and oversized files before any upload request", async () => {
    const fetcher = vi.fn();
    expect(validateEvolutionMediaFile(new File(["x"], "photo.webp", { type: "image/webp" }))).toBe("unsupported_file_type");
    expect(validateEvolutionMediaFile(new File(["x"], "photo.pdf", { type: "image/png" }))).toBe("file_type_mismatch");
    expect(validateEvolutionMediaFile({ name: "large.pdf", type: "application/pdf", size: 16 * 1024 * 1024 + 1 })).toBe("file_too_large");
    await expect(stageEvolutionMedia(new File(["x"], "photo.pdf", { type: "image/png" }), "conversation", fetcher)).rejects.toThrow("file_type_mismatch");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stages bytes and returns an authenticated same-origin preview path without a public URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      media_ref: { version: 1, stage_id: "11111111-1111-4111-8111-111111111111" },
      content_type: "image",
      filename: "preview.png",
    }, { status: 201 }));
    const result = await stageEvolutionMedia(png, "conversation-123", fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toContain("/api/whatsapp/media/staging?");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { "Content-Type": "image/png" }, cache: "no-store" });
    expect(result.previewUrl).toBe("/api/whatsapp/media/staging/11111111-1111-4111-8111-111111111111");
    expect(result.previewUrl).not.toMatch(/^https?:/);
    expect(result.stageId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.idempotencyKey).toBeTruthy();
  });

  it("sends once with the stable key and records unknown outcomes without retry", async () => {
    const messageId = "22222222-2222-4222-8222-222222222222";
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "delivery_unknown", outcome: "unknown", message_id: messageId }, { status: 504 }));
    const input = { conversationId: "conversation", stageId: "stage", caption: "caption", idempotencyKey: "stable-key" };
    expect(await sendStagedEvolutionMedia(input, fetcher)).toEqual({ outcome: "unknown", messageId });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "Idempotency-Key": "stable-key" },
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      conversation_id: "conversation",
      media_ref: { version: 1, stage_id: "stage" },
      caption: "caption",
    });
  });

  it("treats transport failure as ambiguous and never retries", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network lost"));
    expect(await sendStagedEvolutionMedia({ conversationId: "conversation", stageId: "stage", idempotencyKey: "key" }, fetcher)).toEqual({ outcome: "unknown" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns a validated persisted id for accepted sends and rejects malformed IDs as unknown", async () => {
    const input = { conversationId: "conversation", stageId: "stage", idempotencyKey: "stable" };
    const messageId = "33333333-3333-4333-8333-333333333333";
    const accepted = vi.fn().mockResolvedValue(Response.json({ outcome: "accepted", message_id: messageId }));
    expect(await sendStagedEvolutionMedia(input, accepted)).toEqual({ outcome: "accepted", messageId });
    const malformed = vi.fn().mockResolvedValue(Response.json({ outcome: "accepted", message_id: "not-a-uuid" }));
    expect(await sendStagedEvolutionMedia(input, malformed)).toEqual({ outcome: "unknown" });
  });
});
