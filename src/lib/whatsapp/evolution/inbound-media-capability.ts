import type { EvolutionMediaKind } from './capabilities';

const LOCAL_MEDIA_KINDS: readonly EvolutionMediaKind[] = [
  'image',
  'document',
  'audio',
  'video',
];

/** Inbound media is enabled only for the verified local Evolution/Supabase pair. */
export function enabledEvolutionInboundMedia(): readonly EvolutionMediaKind[] {
  if (process.env.NODE_ENV !== 'development') return [];
  try {
    const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    const origins = (process.env.EVOLUTION_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim());
    if (
      supabase.origin !== 'http://127.0.0.1:54321' ||
      !origins.includes('http://127.0.0.1:8080')
    )
      return [];
  } catch {
    return [];
  }
  return LOCAL_MEDIA_KINDS;
}
