'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, card frame) while the form hydrates with the query
// string on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get('invite');
  const t = useTranslations('LoginPage');
  // Set by /auth/callback when an emailed link (confirmation, password
  // reset) could not be turned into a session — see src/lib/auth/callback.ts.
  const linkError = searchParams.get('error');
  const linkErrorMessage =
    linkError === 'link_expired'
      ? t('linkExpired')
      : linkError === 'link_invalid'
        ? t('linkInvalid')
        : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Full-page navigation (not router.push) so the browser issues a
    // fresh top-level request that carries the just-written Supabase
    // auth cookies to the middleware gating /dashboard. A soft
    // client-side navigation can reach the protected route before the
    // server observes the new session, so the middleware bounces it
    // back to /login — which looks like the page "just refreshing"
    // instead of signing in (issue #365). Mirrors the deliberate full
    // reload the invite-accept flow already uses in join/[token].
    const destination = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : '/dashboard';
    window.location.href = destination;
  };

  return (
    <div className="w-full">
      <header className="mb-8 space-y-2">
        <h1 className="text-foreground text-[clamp(1.875rem,4vw,2.5rem)] leading-[1.08] font-semibold tracking-[-0.04em]">
          {inviteToken ? t('titleAccept') : t('titleWelcome')}
        </h1>
        <p className="text-muted-foreground text-base leading-6">
          {inviteToken ? t('descAccept') : t('descWelcome')}
        </p>
      </header>

      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        {linkErrorMessage && !error && (
          <div
            role="alert"
            className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-800 dark:text-amber-200"
          >
            {linkErrorMessage}
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="border-destructive/20 bg-destructive/10 text-destructive rounded-xl border px-4 py-3 text-sm leading-relaxed"
          >
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-muted-foreground">
            {t('emailLabel')}
          </Label>
          <Input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20 h-11 rounded-xl"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="text-muted-foreground">
            {t('passwordLabel')}
          </Label>
          <Input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder={t('passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20 h-11 rounded-xl"
          />
          {/* Below the input so Tab goes email -> password -> link. */}
          <Link
            href="/forgot-password"
            className="text-primary focus-visible:ring-ring focus-visible:ring-offset-card min-h-11 self-end px-1 text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {t('forgotPassword')}
          </Link>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 h-11 w-full rounded-xl disabled:opacity-50"
        >
          {loading ? t('signingIn') : t('signIn')}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-sm">
        {t('noAccount')}{' '}
        <span className="ml-1">
          <Link
            href={
              inviteToken
                ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                : '/signup'
            }
            className="text-primary focus-visible:ring-ring focus-visible:ring-offset-background rounded-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {t('createAccount')}
          </Link>
        </span>
      </p>
    </div>
  );
}
