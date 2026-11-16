'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { notificationsAccountFilter } from '@/lib/notifications/unread-count';
import type { Notification } from '@/types';
import { Bell, CheckCheck, Loader2, UserPlus } from 'lucide-react';
import { formatRelativeTime } from '@/lib/i18n/relative-time';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';

// Icon per notification type. Only one type exists today
// (conversation_assigned) but this keeps future types a one-line add.
const TYPE_ICON: Record<Notification['type'], typeof Bell> = {
  conversation_assigned: UserPlus,
};

export default function NotificationsPage() {
  const t = useTranslations('Notifications');
  const locale = useLocale();
  const router = useRouter();
  const { accountId } = useAuth();
  const [notifications, setNotifications] = useState<Notification[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data, error: fetchErr } = await supabase
      .from('notifications')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (fetchErr) {
      setError(fetchErr.message);
      return;
    }
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Realtime — new assignments appear without a refresh, and a
  // "mark all read" fired from another tab/device stays in sync here.
  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications-page:${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: notificationsAccountFilter(accountId),
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Notification;
            setNotifications(
              (prev) =>
                prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ??
                prev
            );
          } else if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications(
              (prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  const markRead = useCallback(
    async (id: string) => {
      // Optimistic — the row is already visually "read" by the time the
      // request lands, so the UI doesn't wait on the round-trip.
      setNotifications(
        (prev) =>
          prev?.map((n) =>
            n.id === id && !n.read_at
              ? { ...n, read_at: new Date().toISOString() }
              : n
          ) ?? prev
      );
      const supabase = createClient();
      const { error: updateErr } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null);
      if (updateErr) {
        toast.error(t('markReadFailed'));
        load();
      }
    },
    [load, t]
  );

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [markRead, router]
  );

  const unreadIds =
    notifications?.filter((n) => !n.read_at).map((n) => n.id) ?? [];

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0 || !accountId) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications(
      (prev) =>
        prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev
    );
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from('notifications')
      .update({ read_at: now })
      .eq('account_id', accountId)
      .is('read_at', null);
    setMarkingAll(false);
    if (updateErr) {
      toast.error(t('markAllFailed'));
      load();
    }
  }, [unreadIds.length, accountId, load, t]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <header className="border-border flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-foreground text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.08] font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-6">
            {t('description')}
          </p>
        </div>

        <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center sm:flex-col sm:items-end lg:flex-row lg:items-center">
          {notifications !== null && (
            <div className="border-border bg-card flex items-center gap-2 rounded-lg border px-3 py-2.5">
              <span className="text-muted-foreground text-xs font-medium">
                {t('unread')}
              </span>
              <span className="text-foreground font-mono text-sm font-semibold tabular-nums">
                {unreadIds.length}
              </span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="min-h-10 w-full justify-center px-3 sm:w-auto"
            disabled={
              unreadIds.length === 0 ||
              markingAll ||
              notifications === null ||
              Boolean(error)
            }
            onClick={markAllRead}
          >
            {markingAll ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4" />
            )}
            {t('markAllRead')}
          </Button>
        </div>
      </header>

      {error ? (
        <section
          className="border-destructive/25 bg-destructive/5 flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border px-5 py-10 text-center"
          role="alert"
        >
          <p className="text-destructive max-w-2xl text-sm break-words">
            {error}
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t('retry')}
          </Button>
        </section>
      ) : notifications === null ? (
        <section
          aria-busy="true"
          className="border-border bg-card/50 flex min-h-52 items-center justify-center rounded-xl border"
        >
          <Loader2 className="text-primary h-6 w-6 animate-spin" />
        </section>
      ) : notifications.length === 0 ? (
        <section className="border-border bg-card/40 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
          <div className="border-border bg-card text-muted-foreground flex h-12 w-12 items-center justify-center rounded-xl border">
            <Bell className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-foreground mt-4 text-sm font-semibold">
            {t('emptyTitle')}
          </p>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm leading-6">
            {t('emptyDesc')}
          </p>
        </section>
      ) : (
        <section aria-label={t('title')}>
          <ul className="space-y-1">
            {notifications.map((n) => {
              const Icon = TYPE_ICON[n.type] ?? Bell;
              const isUnread = !n.read_at;
              return (
                <li
                  key={n.id}
                  className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 pb-3 last:pb-0 sm:grid-cols-[1.75rem_minmax(0,1fr)] sm:gap-x-4"
                >
                  <span
                    aria-hidden="true"
                    className="bg-border absolute top-0 bottom-0 left-[0.575rem] w-px sm:left-[0.825rem]"
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'bg-background relative z-10 mt-4 flex h-5 w-5 items-center justify-center rounded-full border sm:mt-[1.125rem] sm:h-7 sm:w-7',
                      isUnread
                        ? 'border-primary/50 text-primary'
                        : 'border-border text-muted-foreground'
                    )}
                  >
                    <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  </span>
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    className={cn(
                      'group focus-visible:ring-ring focus-visible:ring-offset-background min-w-0 rounded-xl border px-4 py-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:px-5 sm:py-4',
                      isUnread
                        ? 'border-primary/25 bg-card hover:border-primary/45 hover:bg-card-2'
                        : 'border-border bg-card/70 hover:border-border hover:bg-card'
                    )}
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={cn(
                          'min-w-0 flex-1 text-sm leading-5 break-words',
                          isUnread
                            ? 'text-foreground font-semibold'
                            : 'text-muted-foreground font-medium'
                        )}
                      >
                        {n.title}
                      </span>
                      {isUnread && (
                        <span className="border-primary/25 bg-primary/10 text-foreground inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] leading-4 font-semibold">
                          <span
                            aria-hidden="true"
                            className="bg-primary h-1.5 w-1.5 rounded-full"
                          />
                          {t('unread')}
                        </span>
                      )}
                    </span>
                    {n.body && (
                      <span
                        className={cn(
                          'mt-1 block text-xs leading-5 break-words whitespace-pre-wrap',
                          isUnread
                            ? 'text-muted-foreground'
                            : 'text-muted-foreground/80'
                        )}
                      >
                        {n.body}
                      </span>
                    )}
                    <time
                      dateTime={n.created_at}
                      className="text-muted-foreground mt-2 block text-[11px] leading-4"
                    >
                      {formatRelativeTime(new Date(n.created_at), locale, true)}
                    </time>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
