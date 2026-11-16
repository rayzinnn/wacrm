import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { getT } from '@/lib/i18n/translate';

const t = getT('Api');

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

    return NextResponse.json(
      { error: t('media.fetchFailed') },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    console.error('WhatsApp media GET failed');
    return NextResponse.json(
      { error: t('media.fetchFailed') },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
