'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { useAuth } from '@/hooks/use-auth'

type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'unknown'
type ConnectionDto = { configured: boolean; state: ConnectionState }
type AccountConnection = { accountId: string; dto: ConnectionDto }

const STATE_DOT_CLASS: Record<ConnectionState, string> = {
  connected: 'bg-status-good',
  connecting: 'bg-status-warning',
  disconnected: 'bg-status-critical',
  unknown: 'bg-muted-foreground/60',
}

function isConnectionDto(value: unknown): value is ConnectionDto {
  if (!value || typeof value !== 'object') return false
  const dto = value as Record<string, unknown>
  return typeof dto.configured === 'boolean'
    && (dto.state === 'connected' || dto.state === 'connecting' || dto.state === 'disconnected' || dto.state === 'unknown')
}

export function WhatsAppHealthChip() {
  const { accountId } = useAuth()
  const t = useTranslations('Settings.whatsapp')
  const [connection, setConnection] = useState<AccountConnection | null>(null)

  useEffect(() => {
    if (!accountId) return

    const controller = new AbortController()
    let active = true

    fetch('/api/whatsapp/config', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null
        const dto: unknown = await response.json()
        return isConnectionDto(dto) ? dto : null
      })
      .then((dto) => {
        if (active && dto) setConnection({ accountId, dto })
      })
      .catch(() => {})

    return () => {
      active = false
      controller.abort()
    }
  }, [accountId])

  const current = connection?.accountId === accountId ? connection.dto : null
  if (!current) return null

  const stateLabel = !current.configured
    ? t('stateNotConfigured')
    : current.state === 'connected'
      ? t('stateConnected')
      : current.state === 'connecting'
        ? t('stateConnecting')
        : current.state === 'disconnected'
          ? t('stateDisconnected')
          : t('stateUnknown')
  const dotState = current.configured ? current.state : 'disconnected'

  return (
    <Link
      href="/settings?tab=whatsapp"
      title={t('sessionState')}
      aria-label={`${t('sessionState')}: ${stateLabel}`}
      className="inline-flex h-8 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className={`size-2 shrink-0 rounded-full ${STATE_DOT_CLASS[dotState]}`} aria-hidden="true" />
      <span className="truncate">{stateLabel}</span>
    </Link>
  )
}
