import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, CircleAlert } from 'lucide-react';

import { getEvolutionCapabilities } from '@/lib/whatsapp/evolution/capabilities';

export default function BroadcastsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const capabilities = getEvolutionCapabilities();
  const t = useTranslations('ResourceUnavailable');

  if (capabilities.broadcasts) return children;

  return (
    <section
      aria-labelledby="broadcasts-unavailable-title"
      className="border-border bg-card w-full max-w-3xl overflow-hidden rounded-3xl border shadow-sm"
    >
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:gap-6 sm:p-8">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-800 dark:text-amber-300">
          <CircleAlert className="size-6" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <h1
            id="broadcasts-unavailable-title"
            className="text-foreground text-xl leading-tight font-semibold tracking-tight sm:text-2xl"
          >
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-3 max-w-prose text-sm leading-6 sm:text-base">
            {t('description')}
          </p>
          <Link
            href="/settings?tab=whatsapp"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring focus-visible:ring-offset-card mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:w-fit"
          >
            <span>{t('connectionLink')}</span>
            <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
