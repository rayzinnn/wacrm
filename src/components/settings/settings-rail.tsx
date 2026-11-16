'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { getEvolutionCapabilities } from '@/lib/whatsapp/evolution/capabilities';
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-sections';

/**
 * Grouped section navigation on wide layouts and a native select on
 * narrow layouts so all sections remain directly reachable without a
 * horizontal tab strip.
 */
export function SettingsRail({
  active,
  onSelect,
  hints,
}: {
  active: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  hints?: Partial<Record<SettingsSection, ReactNode>>;
}) {
  const t = useTranslations('Settings');
  const capabilities = getEvolutionCapabilities();
  return (
    <>
      <label className="block lg:hidden">
        <span className="mb-2 block text-xs font-medium text-muted-foreground">
          {t('sectionsNav')}
        </span>
        <select
          value={active}
          onChange={(event) => onSelect(event.target.value as SettingsSection)}
          className="min-h-11 w-full rounded-xl border border-border bg-card px-3.5 text-base text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {SETTINGS_SECTIONS.filter(
            (section) => section !== 'templates' || capabilities.templates || active === 'templates',
          ).map((section) => (
            <option
              key={section}
              value={section}
              disabled={section === 'templates' && !capabilities.templates}
            >
              {t(`sections.${section}`)}
            </option>
          ))}
        </select>
      </label>
      <nav
        aria-label={t('sectionsNav')}
        className="hidden rounded-2xl border border-border bg-card p-2 shadow-sm lg:sticky lg:top-4 lg:block"
      >
      {RAIL_GROUPS.map(({ group }) => {
        const label = group === 'top' ? null : t(`groups.${group}`);
        const items = SETTINGS_SECTIONS.filter(
          (s) => SECTION_META[s].group === group && (s !== 'templates' || capabilities.templates),
        );
        return (
          <div key={group} className="flex flex-col gap-0.5">
            {label ? (
              <div className="px-3 pb-1 pt-3 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase first:pt-1">
                {label}
              </div>
            ) : null}
            {items.map((s) => {
              const meta = SECTION_META[s];
              const Icon = meta.icon;
              const isActive = s === active;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSelect(s)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex min-h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                    isActive
                      ? 'bg-primary-soft text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1">{t(`sections.${s}`)}</span>
                  {hints?.[s] != null ? (
                    <span
                      className={cn(
                        'ml-auto hidden items-center gap-1.5 text-xs lg:inline-flex',
                        isActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {hints[s]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        );
      })}
      </nav>
    </>
  );
}
