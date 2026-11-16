import 'server-only';

import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { EVOLUTION_MEDIA_MAX_BYTES } from './media';
import type { ResolvedEvolutionMedia } from './media';

const BUCKET = 'evolution-media';

const MEDIA_EXTENSIONS: Record<
  string,
  { kind: ResolvedEvolutionMedia['contentType']; extension: string }
> = {
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'image/gif': { kind: 'image', extension: 'gif' },
  'application/pdf': { kind: 'document', extension: 'pdf' },
  'application/msword': { kind: 'document', extension: 'doc' },
  'application/vnd.ms-excel': { kind: 'document', extension: 'xls' },
  'application/vnd.ms-powerpoint': { kind: 'document', extension: 'ppt' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'document',
    extension: 'docx',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'document',
    extension: 'xlsx',
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    kind: 'document',
    extension: 'pptx',
  },
  'text/plain': { kind: 'document', extension: 'txt' },
  'audio/ogg': { kind: 'audio', extension: 'ogg' },
  'audio/opus': { kind: 'audio', extension: 'opus' },
  'audio/mpeg': { kind: 'audio', extension: 'mp3' },
  'audio/aac': { kind: 'audio', extension: 'aac' },
  'audio/mp4': { kind: 'audio', extension: 'm4a' },
  'audio/amr': { kind: 'audio', extension: 'amr' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
  'video/3gpp': { kind: 'video', extension: '3gp' },
  'video/3gp': { kind: 'video', extension: '3gp' },
  'video/quicktime': { kind: 'video', extension: 'mov' },
};

type MediaStageOutcome = 'staged' | 'duplicate' | 'stale' | 'conflict';

export class EvolutionMediaStorageError extends Error {
  constructor(
    readonly code:
      | 'invalid_media'
      | 'storage_unavailable'
      | 'stage_unavailable'
      | 'stage_rejected'
  ) {
    super('Evolution media storage operation failed.');
    this.name = 'EvolutionMediaStorageError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function stageMetadata(
  accountId: string,
  eventId: string,
  media: ResolvedEvolutionMedia
) {
  if (
    !isRecord(media) ||
    typeof media.mimeType !== 'string' ||
    typeof media.filename !== 'string'
  ) {
    throw new EvolutionMediaStorageError('invalid_media');
  }
  const descriptor = MEDIA_EXTENSIONS[media.mimeType];
  if (
    !isUuid(accountId) ||
    !isUuid(eventId) ||
    !descriptor ||
    descriptor.kind !== media.contentType ||
    !(media.bytes instanceof Uint8Array) ||
    media.bytes.byteLength < 1 ||
    media.bytes.byteLength > EVOLUTION_MEDIA_MAX_BYTES ||
    media.filename.length < 1 ||
    media.filename.length > 80 ||
    media.filename !== media.filename.trim() ||
    /[\u0000-\u001f\u007f/\\<>:"|?*]/.test(media.filename) ||
    media.filename.startsWith('.')
  ) {
    throw new EvolutionMediaStorageError('invalid_media');
  }

  const sha256 = createHash('sha256').update(media.bytes).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(media.sha256) || media.sha256 !== sha256) {
    throw new EvolutionMediaStorageError('invalid_media');
  }

  return {
    path: `account-${accountId}/evolution/${eventId}/payload.${descriptor.extension}`,
    sha256,
    sizeBytes: media.bytes.byteLength,
  };
}

function isAlreadyStored(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.status === 409 ||
      error.statusCode === '409' ||
      error.code === 'ResourceAlreadyExists' ||
      error.error === 'Duplicate')
  );
}

async function verifyExistingObject(
  bucket: ReturnType<ReturnType<typeof supabaseAdmin>['storage']['from']>,
  path: string,
  expected: { sha256: string; sizeBytes: number }
): Promise<boolean> {
  try {
    const { data, error } = await bucket.download(path);
    if (error || !data || typeof data.arrayBuffer !== 'function') return false;
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (
      bytes.byteLength !== expected.sizeBytes ||
      bytes.byteLength > EVOLUTION_MEDIA_MAX_BYTES
    )
      return false;
    return createHash('sha256').update(bytes).digest('hex') === expected.sha256;
  } catch {
    return false;
  }
}

/** Uploads validated bytes to the private bucket at an event-scoped deterministic path. */
async function ensurePrivateObject(
  media: ResolvedEvolutionMedia,
  expected: ReturnType<typeof stageMetadata>
): Promise<boolean> {
  const bucket = supabaseAdmin().storage.from(BUCKET);
  try {
    const { data, error } = await bucket.upload(expected.path, media.bytes, {
      cacheControl: '0',
      contentType: media.mimeType,
      upsert: false,
      metadata: { sha256: expected.sha256, sizeBytes: expected.sizeBytes },
    });
    if (!error) return isRecord(data) && data.path === expected.path;
    if (!isAlreadyStored(error))
      throw new EvolutionMediaStorageError('storage_unavailable');
    return verifyExistingObject(bucket, expected.path, expected);
  } catch (error) {
    if (error instanceof EvolutionMediaStorageError) throw error;
    throw new EvolutionMediaStorageError('storage_unavailable');
  }
}

async function resolveEventAccount(
  eventId: string,
  leaseToken: string
): Promise<string | 'stale'> {
  const db = supabaseAdmin();
  let eventResult: { data: unknown; error: unknown };
  try {
    eventResult = await db
      .from('evolution_events')
      .select('id,connection_id,state,lease_token,lease_until,media_state')
      .eq('id', eventId)
      .maybeSingle();
  } catch {
    throw new EvolutionMediaStorageError('stage_unavailable');
  }
  if (eventResult.error)
    throw new EvolutionMediaStorageError('stage_unavailable');
  if (!isRecord(eventResult.data) || eventResult.data.id !== eventId)
    return 'stale';

  const event = eventResult.data;
  const leaseUntil =
    typeof event.lease_until === 'string'
      ? Date.parse(event.lease_until)
      : Number.NaN;
  if (
    event.state !== 'processing' ||
    event.lease_token !== leaseToken ||
    !Number.isFinite(leaseUntil) ||
    leaseUntil <= Date.now()
  )
    return 'stale';
  if (event.media_state !== 'pending' && event.media_state !== 'stored') {
    throw new EvolutionMediaStorageError('stage_rejected');
  }
  if (typeof event.connection_id !== 'string')
    throw new EvolutionMediaStorageError('stage_rejected');

  let connectionResult: { data: unknown; error: unknown };
  try {
    connectionResult = await db
      .from('whatsapp_connections')
      .select('id,account_id,provider')
      .eq('id', event.connection_id)
      .maybeSingle();
  } catch {
    throw new EvolutionMediaStorageError('stage_unavailable');
  }
  if (connectionResult.error)
    throw new EvolutionMediaStorageError('stage_unavailable');
  if (
    !isRecord(connectionResult.data) ||
    connectionResult.data.id !== event.connection_id ||
    connectionResult.data.provider !== 'evolution' ||
    !isUuid(connectionResult.data.account_id)
  )
    throw new EvolutionMediaStorageError('stage_rejected');

  return connectionResult.data.account_id;
}

function stageOutcome(
  data: unknown
): { outcome: MediaStageOutcome; path: string | null } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row) || typeof row.outcome !== 'string') return null;
  if (!['staged', 'duplicate', 'stale', 'conflict'].includes(row.outcome))
    return null;
  return {
    outcome: row.outcome as MediaStageOutcome,
    path:
      typeof row.media_storage_path === 'string'
        ? row.media_storage_path
        : null,
  };
}

/**
 * Worker staging step: durable private object first, then the fenced SQL stage RPC.
 * It deliberately does not apply the inbound event or acknowledge completion.
 */
export async function stageEvolutionInboundMedia(input: {
  eventId: string;
  leaseToken: string;
  media: ResolvedEvolutionMedia;
}): Promise<MediaStageOutcome> {
  if (
    !isRecord(input) ||
    Object.keys(input).some(
      (key) => !['eventId', 'leaseToken', 'media'].includes(key)
    )
  ) {
    throw new EvolutionMediaStorageError('invalid_media');
  }
  if (!isUuid(input.leaseToken))
    throw new EvolutionMediaStorageError('invalid_media');
  if (!isUuid(input.eventId))
    throw new EvolutionMediaStorageError('invalid_media');

  const accountId = await resolveEventAccount(input.eventId, input.leaseToken);
  if (accountId === 'stale') return 'stale';
  const metadata = stageMetadata(accountId, input.eventId, input.media);
  const objectMatches = await ensurePrivateObject(input.media, metadata);
  if (!objectMatches) return 'conflict';

  let result: { data: unknown; error: unknown };
  try {
    result = await supabaseAdmin().rpc('stage_evolution_media', {
      p_event_id: input.eventId,
      p_lease_token: input.leaseToken,
      p_sha256: metadata.sha256,
      p_size_bytes: metadata.sizeBytes,
      p_media_type: input.media.mimeType,
      p_filename: input.media.filename,
    });
  } catch {
    throw new EvolutionMediaStorageError('stage_unavailable');
  }

  if (result.error) {
    if (
      isRecord(result.error) &&
      (result.error.code === '40001' || result.error.code === 'P0002')
    )
      return 'stale';
    if (isRecord(result.error) && result.error.code === '22023')
      throw new EvolutionMediaStorageError('stage_rejected');
    throw new EvolutionMediaStorageError('stage_unavailable');
  }

  const staged = stageOutcome(result.data);
  if (!staged) throw new EvolutionMediaStorageError('stage_unavailable');
  if (staged.outcome === 'staged' || staged.outcome === 'duplicate') {
    if (staged.path !== metadata.path)
      throw new EvolutionMediaStorageError('stage_rejected');
  }
  return staged.outcome;
}
