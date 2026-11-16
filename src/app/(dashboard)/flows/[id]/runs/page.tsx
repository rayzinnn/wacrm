'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  CircleCheck,
  CircleAlert,
  Clock,
  UserPlus,
  PlayCircle,
  CircleSlash,
  PauseCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

import { useLocale, useTranslations } from 'next-intl';
import { formatRelativeTime, getDateFnsLocale } from '@/lib/i18n/relative-time';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import styles from './runs.module.css';

/**
 * Run history viewer.
 *
 * Lists the 50 most recent runs for a flow, newest first. Each row
 * collapses to a one-liner (contact + status + time); expanding shows
 * the full `flow_run_events` timeline for that run — useful for
 * debugging "why didn't my flow advance?" by surfacing the engine's
 * own log.
 */

interface RunRow {
  id: string;
  status:
    | 'active'
    | 'completed'
    | 'handed_off'
    | 'timed_out'
    | 'paused_by_agent'
    | 'cancelled'
    | 'failed';
  current_node_key: string | null;
  started_at: string;
  last_advanced_at: string;
  ended_at: string | null;
  end_reason: string | null;
  vars: Record<string, unknown>;
  reprompt_count: number;
  contact: { id: string; name: string | null; phone: string } | null;
}

interface EventRow {
  flow_run_id: string;
  event_type: string;
  node_key: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const STATUS_META: Record<
  RunRow['status'],
  { classes: string; icon: typeof Clock }
> = {
  active: {
    classes:
      'border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: PlayCircle,
  },
  completed: {
    classes: 'border-border bg-muted text-muted-foreground',
    icon: CircleCheck,
  },
  handed_off: {
    classes:
      'border-amber-600/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    icon: UserPlus,
  },
  timed_out: {
    classes: 'border-border bg-muted/60 text-muted-foreground',
    icon: Clock,
  },
  paused_by_agent: {
    classes: 'border-border bg-muted text-muted-foreground',
    icon: PauseCircle,
  },
  cancelled: {
    classes: 'border-border bg-muted/60 text-muted-foreground',
    icon: CircleSlash,
  },
  failed: {
    classes: 'border-red-600/40 bg-red-500/10 text-red-800 dark:text-red-300',
    icon: CircleAlert,
  },
};

export default function FlowRunsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const t = useTranslations('Flows.logs');
  const tEdit = useTranslations('Flows.edit');

  const [flow, setFlow] = useState<{ id: string; name: string } | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/flows/${params.id}/runs`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as {
          flow: { id: string; name: string };
          runs: RunRow[];
          events: EventRow[];
        };
        if (!cancelled) {
          setFlow(json.flow);
          setRuns(json.runs ?? []);
          setEvents(json.events ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error(t('loadError'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  function toggle(runId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (notFound || !flow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground text-sm">{tEdit('notFound')}</p>
        <button
          type="button"
          onClick={() => router.push('/flows')}
          className="text-primary text-sm hover:opacity-80"
        >
          {tEdit('backToFlows')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <button
        type="button"
        onClick={() => router.push(`/flows/${flow.id}`)}
        className={styles.back}
      >
        <ArrowLeft className="h-3 w-3" />
        {flow.name}
      </button>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{flow.name}</p>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.description}>{t('description')}</p>
      </header>

      {runs.length === 0 ? (
        <div className={styles.emptyState}>{t('emptyState')}</div>
      ) : (
        <div className={styles.runList}>
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              events={events.filter((e) => e.flow_run_id === run.id)}
              expanded={expanded.has(run.id)}
              onToggle={() => toggle(run.id)}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({
  run,
  events,
  expanded,
  onToggle,
  t,
}: {
  run: RunRow;
  events: EventRow[];
  expanded: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const meta = STATUS_META[run.status];
  const StatusIcon = meta.icon;
  const locale = useLocale();
  const contactLabel =
    run.contact?.name?.trim() || run.contact?.phone || t('unknownContact');
  const duration = run.ended_at
    ? formatRelativeTime(new Date(run.ended_at), locale)
    : null;
  return (
    <article className={styles.runCard}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={styles.runToggle}
      >
        {expanded ? (
          <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
        )}
        <div className={styles.runSummary}>
          <div className={styles.runTitleRow}>
            <span className={styles.runContact}>{contactLabel}</span>
            <Badge variant="outline" className={cn('gap-1', meta.classes)}>
              <StatusIcon className="h-3 w-3" />
              {t(
                run.status === 'active'
                  ? 'statusActive'
                  : run.status === 'completed'
                    ? 'statusCompleted'
                    : run.status === 'handed_off'
                      ? 'statusHandedOff'
                      : run.status === 'timed_out'
                        ? 'statusTimedOut'
                        : run.status === 'paused_by_agent'
                          ? 'statusPaused'
                          : run.status === 'cancelled'
                            ? 'statusCancelled'
                            : 'statusFailed'
              )}
            </Badge>
            {run.status === 'active' && run.current_node_key && (
              <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
                {t('atNode', { node: run.current_node_key })}
              </code>
            )}
          </div>
          <div className={styles.runMeta}>
            <span className={styles.runMetaItem}>
              {t('started', { time: format(new Date(run.started_at), 'PP p', { locale: getDateFnsLocale(locale) }) })}
            </span>
            {run.reprompt_count > 0 && (
              <span className={styles.runMetaItem}>
                {t('reprompts', { count: run.reprompt_count })}
              </span>
            )}
            {duration && (
              <span className={styles.runMetaItem}>
                {t('ranFor', { duration })}
              </span>
            )}
          </div>
        </div>
      </button>
      {expanded && (
        <div className={styles.runDetails}>
          {Object.keys(run.vars).length > 0 && (
            <details className={styles.capturedVars}>
              <summary className="cursor-pointer">
                {t('capturedVars', { count: Object.keys(run.vars).length })}
              </summary>
              <pre className="mt-2 overflow-x-auto">
                {JSON.stringify(run.vars, null, 2)}
              </pre>
            </details>
          )}
          <div className={styles.eventList}>
            {events.length === 0 ? (
              <p className="text-muted-foreground text-xs">{t('noEvents')}</p>
            ) : (
              events.map((ev, ix) => <EventLine key={ix} ev={ev} />)
            )}
          </div>
        </div>
      )}
    </article>
  );
}

const EVENT_COLOR: Record<string, string> = {
  started: 'text-emerald-700 dark:text-emerald-300',
  node_entered: 'text-muted-foreground',
  message_sent: 'text-sky-700 dark:text-sky-300',
  reply_received: 'text-primary',
  fallback_fired: 'text-amber-800 dark:text-amber-300',
  handoff: 'text-amber-800 dark:text-amber-300',
  timeout: 'text-muted-foreground',
  error: 'text-red-800 dark:text-red-300',
  completed: 'text-emerald-700 dark:text-emerald-300',
};

function EventLine({ ev }: { ev: EventRow }) {
  const cls = EVENT_COLOR[ev.event_type] ?? 'text-muted-foreground';
  return (
    <div className={styles.eventLine}>
      <span className={styles.eventTime}>
        {format(new Date(ev.created_at), 'HH:mm:ss')}
      </span>
      <span className={cn(styles.eventType, cls)}>{ev.event_type}</span>
      {ev.node_key && <code className={styles.eventNode}>{ev.node_key}</code>}
      {Object.keys(ev.payload).length > 0 && (
        <span className={styles.eventPayload}>
          {summarizePayload(ev.payload)}
        </span>
      )}
    </div>
  );
}

function summarizePayload(payload: Record<string, unknown>): string {
  // Show the keys that matter most to a human debugger; full JSON is
  // available via the "Captured vars" details panel for the run.
  const keys = ['reply_id', 'captured_key', 'reason', 'advancing_to'];
  for (const k of keys) {
    if (k in payload && payload[k] !== null && payload[k] !== undefined) {
      return `${k}=${String(payload[k]).slice(0, 80)}`;
    }
  }
  return '';
}
