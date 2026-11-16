'use client';

import { Suspense, useMemo, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { InboxSettings } from '@/components/settings/inbox-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { TemplateManager } from '@/components/settings/template-manager';
import { getEvolutionCapabilities } from '@/lib/whatsapp/evolution/capabilities';
import {
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';

// `useSearchParams` opts this page out of static prerendering unless it
// sits under a Suspense boundary. Without one, the production build hits
// the "missing Suspense with CSR bailout" error and the whole page bails
// to client-side rendering — shipping a settings screen whose rail never
// wires up its click handlers. You land on the section the URL carried
// (the account-menu Settings link points at `?tab=whatsapp`) and can't
// navigate away. Mirror the login/signup split: a thin wrapper supplies
// the boundary; the inner component reads the query string.
export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');
  const tUnavailable = useTranslations('ResourceUnavailable');
  const capabilities = getEvolutionCapabilities();

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  const section = resolveSection(searchParams.get('tab'));

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppConfig />,
    templates: capabilities.templates ? <TemplateManager /> : (
      <section
        aria-labelledby="templates-unavailable-title"
        className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <CircleAlert className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="templates-unavailable-title" className="text-lg font-semibold text-foreground">
              {tUnavailable('title')}
            </h2>
            <p className="mt-1 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
              {tUnavailable('description')}
            </p>
          </div>
        </div>
        <Link
          href="/settings?tab=whatsapp"
          className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          {tUnavailable('connectionLink')}
        </Link>
      </section>
    ),
    'quick-replies': <QuickRepliesManager />,
    fields: <FieldsAndTagsPanel />,
    inbox: <InboxSettings />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    api: <ApiKeysSettings />,
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-8 pb-10">
      <header className="max-w-3xl">
        <h1 className="text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.08] tracking-tight text-foreground">
          {t('pageTitle')}
        </h1>
        <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          {t('pageDesc')}
        </p>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:items-start xl:gap-8">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        <div id="settings-content" className="min-w-0">
          {panel[section]}
        </div>
      </div>
    </div>
  );
}
