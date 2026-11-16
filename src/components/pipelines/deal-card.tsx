'use client';

import type { Deal, PipelineStage } from '@/types';
import { Calendar, Check, X } from 'lucide-react';
import { formatCurrency } from '@/lib/currency';
import { useTranslations } from 'next-intl';

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || '?').trim();
  if (!source) return '?';
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations('Pipelines.card');
  const contactLabel =
    deal.contact?.name || deal.contact?.phone || t('noContact');
  const assigneeLabel = deal.assignee?.full_name || null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group border-border bg-card focus-visible:ring-ring focus-visible:ring-offset-card relative w-full cursor-pointer overflow-hidden rounded-xl border px-3.5 py-3 text-left shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[border-color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none ${
        isOverlay
          ? 'shadow-xl'
          : 'hover:border-primary/30 hover:bg-muted/70 hover:-translate-y-px hover:shadow-md'
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: stage?.color ?? '#94a3b8' }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="text-foreground min-w-0 flex-1 text-[13px] leading-snug font-semibold tracking-[-0.01em] break-words">
          {deal.title}
        </h4>
        {deal.status === 'won' && (
          <span className="bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold">
            <Check className="h-3 w-3" />
            {t('won')}
          </span>
        )}
        {deal.status === 'lost' && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-1 text-xs font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t('lost')}
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="border-border/70 mt-3 flex min-w-0 items-center gap-2 border-t pt-2.5">
        <span className="bg-muted text-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {contactLabel}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-foreground min-w-0 font-mono text-sm font-semibold break-words tabular-nums">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            aria-label={assigneeLabel}
            className="bg-muted text-muted-foreground flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
