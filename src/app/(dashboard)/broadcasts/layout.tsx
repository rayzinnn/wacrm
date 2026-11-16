import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { getEvolutionCapabilities } from '@/lib/whatsapp/evolution/capabilities'

export default function BroadcastsLayout({ children }: { children: ReactNode }) {
  const capabilities = getEvolutionCapabilities()
  const t = useTranslations('ResourceUnavailable')

  if (capabilities.broadcasts) return children

  return (
    <section
      aria-labelledby="broadcasts-unavailable-title"
      className="max-w-2xl rounded-xl border border-border bg-card p-5"
    >
      <h1 id="broadcasts-unavailable-title" className="text-base font-semibold text-foreground">
        {t('title')}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      <Link
        href="/settings?tab=whatsapp"
        className="mt-4 inline-flex min-h-10 items-center rounded-lg px-3 py-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t('connectionLink')}
      </Link>
    </section>
  )
}
