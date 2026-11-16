'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';
import { MessageSquare, CheckCircle, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const t = useTranslations('ForgotPasswordPage');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // The emailed link returns to /auth/callback, which exchanges it
    // for a recovery session and forwards to /reset-password (issue
    // #592). Supabase must allow this origin under Authentication →
    // URL Configuration → Redirect URLs, or it silently falls back to
    // its Site URL; see docs/auth-emails.md.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="w-full">
        <Card className="border-border bg-card w-full max-w-md rounded-2xl py-6 shadow-sm">
          <CardHeader className="items-start text-left">
            <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
              <CheckCircle className="text-primary h-6 w-6" />
            </div>
            <h1 className="text-foreground text-[clamp(1.5rem,4vw,1.875rem)] leading-tight font-semibold tracking-tight">
              {t('checkEmailTitle')}
            </h1>
            <CardDescription className="text-muted-foreground">
              {t.rich('checkEmailDesc', {
                email,
                strong: (chunks) => (
                  <span className="text-foreground">{chunks}</span>
                ),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login">
              <Button
                variant="outline"
                className="border-border text-foreground hover:bg-muted h-11 w-full rounded-xl"
              >
                {t('backToSignIn')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full">
      <Card className="border-border bg-card w-full max-w-md rounded-2xl py-6 shadow-sm">
        <CardHeader className="items-start text-left">
          <div className="bg-primary/10 mb-2 flex h-12 w-12 items-center justify-center rounded-xl">
            <MessageSquare className="text-primary h-6 w-6" />
          </div>
          <h1 className="text-foreground text-[clamp(1.5rem,4vw,1.875rem)] leading-tight font-semibold tracking-tight">
            {t('title')}
          </h1>
          <CardDescription className="text-muted-foreground">
            {t('desc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleReset} className="flex flex-col gap-4">
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

            <Button
              type="submit"
              disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 h-11 w-full rounded-xl disabled:opacity-50"
            >
              {loading ? t('sending') : t('sendLink')}
            </Button>
          </form>

          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-card mt-6 flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('backToSignIn')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
