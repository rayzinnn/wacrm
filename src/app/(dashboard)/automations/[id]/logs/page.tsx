'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import type {
  Automation,
  AutomationLog,
  AutomationLogStepResult,
} from '@/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/automations/trigger-meta';

export default function AutomationLogsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const t = useTranslations('Automations.logs');
  const tRelative = useTranslations('Automations.relative');

  const [automation, setAutomation] = useState<Automation | null>(null);
  const [logs, setLogs] = useState<AutomationLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openLogId, setOpenLogId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const [autRes, logRes] = await Promise.all([
          supabase.from('automations').select('*').eq('id', id).maybeSingle(),
          supabase
            .from('automation_logs')
            .select('*, contact:contacts(id, name, phone)')
            .eq('automation_id', id)
            .order('created_at', { ascending: false })
            .limit(100),
        ]);
        if (autRes.error) throw autRes.error;
        if (logRes.error) throw logRes.error;
        setAutomation(autRes.data as Automation | null);
        setLogs((logRes.data ?? []) as AutomationLog[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('loadError'));
      }
    }
    load();
  }, [id]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => router.push('/automations')}>
          {t('back')}
        </Button>
      </div>
    );
  }

  if (!automation || logs === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-6">
      <div className="border-border flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/automations')}
            className="border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border transition-colors focus-visible:ring-2 focus-visible:outline-none"
            aria-label={t('backAria')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-primary mb-1 text-xs font-semibold tracking-[0.14em] uppercase">
              {t('title')}
            </p>
            <h1 className="text-foreground truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {automation.name}
            </h1>
          </div>
        </div>
        {logs.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label={t('title')}
          >
            {(['success', 'partial', 'failed'] as const).map((status) => {
              const count = logs.filter((log) => log.status === status).length;
              return (
                <StatusSummary
                  key={status}
                  status={status}
                  count={count}
                  t={t}
                />
              );
            })}
          </div>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="border-border bg-card/40 flex h-48 flex-col items-center justify-center rounded-xl border border-dashed">
          <p className="text-foreground text-sm">{t('emptyTitle')}</p>
          <p className="text-muted-foreground mt-1 text-xs">{t('emptyDesc')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => {
            const isOpen = openLogId === log.id;
            return (
              <li
                key={log.id}
                className="border-border bg-card rounded-xl border"
              >
                <button
                  type="button"
                  onClick={() => setOpenLogId(isOpen ? null : log.id)}
                  aria-expanded={isOpen}
                  aria-controls={`automation-log-${log.id}`}
                  className="hover:bg-muted/40 focus-visible:ring-ring grid w-full grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:px-5"
                >
                  {isOpen ? (
                    <ChevronDown className="text-muted-foreground h-4 w-4" />
                  ) : (
                    <ChevronRight className="text-muted-foreground h-4 w-4" />
                  )}
                  <StatusBadge status={log.status} t={t} />
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground truncate text-sm font-medium">
                      {log.contact?.name ??
                        log.contact?.phone ??
                        t('unknownContact')}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {log.trigger_event} · {log.steps_executed?.length ?? 0}{' '}
                      {log.steps_executed?.length === 1
                        ? t('step', { count: 1 }).replace('1 ', '')
                        : t('stepPlural', {
                            count: log.steps_executed?.length ?? 0,
                          }).replace(/^[0-9]+ /, '')}
                    </div>
                  </div>
                  <div className="text-muted-foreground col-span-3 pl-7 text-xs sm:col-span-1 sm:pl-0 sm:text-right">
                    {formatRelative(log.created_at, tRelative)}
                  </div>
                </button>
                {isOpen && (
                  <div
                    id={`automation-log-${log.id}`}
                    className="border-border bg-muted/20 border-t px-4 py-4 sm:px-5"
                  >
                    {log.error_message && (
                      <p className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                        {log.error_message}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {(log.steps_executed ?? []).map((r, i) => (
                        <StepRow key={i} result={r} />
                      ))}
                      {(log.steps_executed ?? []).length === 0 && (
                        <li className="text-muted-foreground text-xs">
                          {t('noSteps')}
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: AutomationLog['status'];
  t: ReturnType<typeof useTranslations>;
}) {
  const classes =
    status === 'success'
      ? 'border-primary/30 bg-primary/10 text-primary'
      : status === 'partial'
        ? 'border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
        : 'border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300';
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
        classes
      )}
    >
      {status === 'success' ? (
        <Check className="h-3 w-3" aria-hidden="true" />
      ) : status === 'partial' ? (
        <CircleAlert className="h-3 w-3" aria-hidden="true" />
      ) : (
        <X className="h-3 w-3" aria-hidden="true" />
      )}
      {t(`status.${status}`)}
    </span>
  );
}

function StatusSummary({
  status,
  count,
  t,
}: {
  status: AutomationLog['status'];
  count: number;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="border-border bg-card flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
      <StatusBadge status={status} t={t} />
      <span className="text-foreground min-w-5 text-right font-semibold tabular-nums">
        {count}
      </span>
    </div>
  );
}

function StepRow({ result }: { result: AutomationLogStepResult }) {
  const ok = result.status === 'success';
  const skipped = result.status === 'skipped';
  return (
    <li className="odd:bg-card/60 grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 rounded-lg px-2 py-2 text-xs">
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full',
          ok
            ? 'bg-primary/15 text-primary'
            : skipped
              ? 'bg-muted text-muted-foreground'
              : 'bg-red-500/15 text-red-500'
        )}
        aria-hidden
      >
        {ok ? (
          <Check className="h-3 w-3" />
        ) : skipped ? (
          <span className="text-[10px]">–</span>
        ) : (
          <X className="h-3 w-3" />
        )}
      </span>
      <span className="text-foreground font-medium">{result.step_type}</span>
      <span className="text-muted-foreground min-w-0 break-words">
        <span className="mr-2 font-medium">{result.status}</span>
        {result.detail && <span>· {result.detail}</span>}
      </span>
    </li>
  );
}
