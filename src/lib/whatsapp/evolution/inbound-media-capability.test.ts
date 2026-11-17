import { afterEach, describe, expect, it, vi } from 'vitest';

import { enabledEvolutionInboundMedia } from './inbound-media-capability';

afterEach(() => vi.unstubAllEnvs());

describe('local Evolution inbound media gate', () => {
  it('enables the four verified kinds only for local development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'http://127.0.0.1:8080');
    expect(enabledEvolutionInboundMedia()).toEqual([
      'image',
      'document',
      'audio',
      'video',
    ]);
  });

  it('stays closed for production and nonlocal services', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('EVOLUTION_ALLOWED_ORIGINS', 'http://127.0.0.1:8080');
    expect(enabledEvolutionInboundMedia()).toEqual([]);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://remote.example');
    expect(enabledEvolutionInboundMedia()).toEqual([]);
  });
});
