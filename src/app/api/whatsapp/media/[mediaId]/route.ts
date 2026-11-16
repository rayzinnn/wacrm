import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';

const t = getT('Api');
const BUCKET = 'evolution-media';
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const MIME: Record<string, { kind: string; extension: string }> = {
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'image/gif': { kind: 'image', extension: 'gif' },
  'application/pdf': { kind: 'document', extension: 'pdf' },
  'application/msword': { kind: 'document', extension: 'doc' },
  'application/vnd.ms-excel': { kind: 'document', extension: 'xls' },
  'application/vnd.ms-powerpoint': { kind: 'document', extension: 'ppt' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'document', extension: 'docx' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'document', extension: 'xlsx' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { kind: 'document', extension: 'pptx' },
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

type Row = Record<string, unknown>;
function row(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function unavailable(status: number) {
  return NextResponse.json(
    { error: t('media.fetchFailed') },
    { status, headers: { 'Cache-Control': 'private, no-store' } }
  );
}

function byteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  const start = first ?? Math.max(0, size - (last ?? 0));
  const end = first === null ? size - 1 : Math.min(last ?? size - 1, size - 1);
  return start >= 0 && start < size && end >= start ? { start, end } : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params;

    if (!mediaId) {
      return NextResponse.json(
        { error: t('media.idRequired') },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: t('common.unauthorized') },
        { status: 401 }
      );
    }

    const limit = checkRateLimit(
      `whatsapp-media:${user.id}`,
      RATE_LIMITS.whatsappMedia
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Resolve the caller's account link independently of the messaging
    // provider; access to shared account data is scoped by account_id.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: t('common.profileNotLinked') },
        { status: 403 }
      );
    }

    if (!uuid(mediaId) || !uuid(accountId)) return unavailable(404);

    const db = supabaseAdmin();
    const eventResult = await db.from('evolution_events')
      .select('id,connection_id,state,normalized_event,media_state,media_storage_path,media_type,media_filename,media_sha256,media_size_bytes')
      .eq('id', mediaId).maybeSingle();
    if (eventResult.error) return unavailable(503);
    const event = row(eventResult.data);
    if (!event || event.id !== mediaId || event.state !== 'done' || event.media_state !== 'stored' || !uuid(event.connection_id)) return unavailable(404);

    const connectionResult = await db.from('whatsapp_connections')
      .select('id,account_id,provider').eq('id', event.connection_id).maybeSingle();
    if (connectionResult.error) return unavailable(503);
    const connection = row(connectionResult.data);
    if (!connection || connection.id !== event.connection_id || connection.account_id !== accountId || connection.provider !== 'evolution') return unavailable(404);

    const normalized = row(event.normalized_event);
    const externalMessageId = normalized?.externalMessageId;
    const descriptor = typeof event.media_type === 'string' ? MIME[event.media_type] : undefined;
    const expectedPath = descriptor && `account-${accountId}/evolution/${mediaId}/payload.${descriptor.extension}`;
    if (!descriptor || normalized?.kind !== 'message' || normalized.contentType !== descriptor.kind || typeof externalMessageId !== 'string' || !externalMessageId ||
        event.media_storage_path !== expectedPath ||
        typeof event.media_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(event.media_sha256) ||
        typeof event.media_size_bytes !== 'number' || !Number.isSafeInteger(event.media_size_bytes) || event.media_size_bytes < 1 || event.media_size_bytes > MAX_MEDIA_BYTES ||
        typeof event.media_filename !== 'string' || event.media_filename.length < 1 || event.media_filename.length > 80 || event.media_filename !== event.media_filename.trim() ||
        /[\u0000-\u001f\u007f/\\<>:"|?*]/.test(event.media_filename) || event.media_filename.startsWith('.')) return unavailable(404);

    const messageResult = await db.from('messages')
      .select('conversation_id,sender_type,content_type,media_type,media_url')
      .eq('provider_connection_id', event.connection_id)
      .eq('message_id', externalMessageId).maybeSingle();
    if (messageResult.error) return unavailable(503);
    const message = row(messageResult.data);
    if (!message || !uuid(message.conversation_id) || message.sender_type !== 'customer' || message.content_type !== descriptor.kind ||
        message.media_type !== event.media_type || message.media_url !== `/api/whatsapp/media/${mediaId}`) return unavailable(404);

    const conversationResult = await db.from('conversations')
      .select('id,account_id').eq('id', message.conversation_id).maybeSingle();
    if (conversationResult.error) return unavailable(503);
    const conversation = row(conversationResult.data);
    if (!conversation || conversation.id !== message.conversation_id || conversation.account_id !== accountId) return unavailable(404);

    const { data: blob, error: downloadError } = await db.storage.from(BUCKET).download(expectedPath as string);
    if (downloadError || !blob) return unavailable(503);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength !== event.media_size_bytes || createHash('sha256').update(bytes).digest('hex') !== event.media_sha256) return unavailable(503);

    const filename = encodeURIComponent(event.media_filename);
    const rangeHeader = request.headers.get('range');
    const range = rangeHeader ? byteRange(rangeHeader, bytes.byteLength) : null;
    if (rangeHeader && !range) {
      return new Response(null, { status: 416, headers: {
        'Content-Range': `bytes */${bytes.byteLength}`,
        'Cache-Control': 'private, no-store',
      } });
    }
    const payload = range ? bytes.slice(range.start, range.end + 1) : bytes;
    return new Response(payload, {
      status: range ? 206 : 200,
      headers: {
        'Content-Type': event.media_type as string,
        'Content-Length': String(payload.byteLength),
        'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.byteLength}` } : {}),
        'Content-Disposition': `${descriptor.kind === 'document' ? 'attachment' : 'inline'}; filename*=UTF-8''${filename}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch {
    console.error('WhatsApp media GET failed');
    return NextResponse.json(
      { error: t('media.fetchFailed') },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
