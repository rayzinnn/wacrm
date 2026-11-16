'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Zap,
  Plus,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  FileText,
  MessageCircle,
  Clock,
  Users,
  PhoneCall,
  Loader2,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { useTranslations } from 'next-intl';
import type { Automation } from '@/types';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AUTOMATION_TEMPLATES,
  type TemplateSlug,
} from '@/lib/automations/templates';
import {
  triggerMeta,
  formatRelative,
  isKnownTrigger,
} from '@/lib/automations/trigger-meta';
import { cn } from '@/lib/utils';

const TEMPLATE_ORDER: TemplateSlug[] = [
  'welcome_message',
  'out_of_office',
  'lead_qualifier',
  'follow_up_reminder',
];

const TEMPLATE_ICON: Record<TemplateSlug, typeof Zap> = {
  welcome_message: MessageCircle,
  out_of_office: Clock,
  lead_qualifier: Users,
  follow_up_reminder: PhoneCall,
};

export default function AutomationsPage() {
  const router = useRouter();
  const canCreate = useCan('send-messages');
  const t = useTranslations('Automations.list');
  const tGate = useTranslations('GatedButton');
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      const supabase = createClient();
      const { data, error: fetchErr } = await supabase
        .from('automations')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      setAutomations((data ?? []) as Automation[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(a: Automation, next: boolean) {
    // Optimistic flip so the switch feels instant.
    setAutomations(
      (prev) =>
        prev?.map((x) => (x.id === a.id ? { ...x, is_active: next } : x)) ??
        prev
    );
    const res = await fetch(`/api/automations/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      // Roll back on error.
      setAutomations(
        (prev) =>
          prev?.map((x) => (x.id === a.id ? { ...x, is_active: !next } : x)) ??
          prev
      );
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? t('toasts.updateError'));
      return;
    }
    toast.success(next ? t('toasts.activated') : t('toasts.paused'));
  }

  async function duplicate(a: Automation) {
    const res = await fetch(`/api/automations/${a.id}/duplicate`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? t('toasts.duplicateError'));
      return;
    }
    toast.success(t('toasts.duplicated'));
    load();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const res = await fetch(`/api/automations/${pendingDelete.id}`, {
      method: 'DELETE',
    });
    setDeleting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? t('toasts.deleteError'));
      return;
    }
    toast.success(t('toasts.deleted'));
    setPendingDelete(null);
    load();
  }

  async function startFromTemplate(slug: TemplateSlug) {
    router.push(`/automations/new?template=${slug}`);
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (automations === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  const executionCount = automations.reduce(
    (total, automation) => total + (automation.execution_count ?? 0),
    0
  );
  const showTemplates = automations.length < 3;

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-8">
      <div className="border-border flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-primary mb-2 text-xs font-semibold tracking-[0.14em] uppercase">
            WACRM
          </p>
          <h1 className="text-foreground text-[1.75rem] font-semibold tracking-tight sm:text-3xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
            {t('subtitle')}
          </p>
          <p className="text-muted-foreground mt-3 text-xs" aria-live="polite">
            {executionCount === 1
              ? t('runs', { count: executionCount })
              : t('runsPlural', { count: executionCount })}
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason={tGate('reasons.createAutomations')}
          onClick={() => router.push('/automations/new')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('create')}
        </GatedButton>
      </div>

      {showTemplates && (
        <section
          aria-labelledby="automation-templates-title"
          className="space-y-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2
                id="automation-templates-title"
                className="text-foreground text-base font-semibold tracking-tight"
              >
                {t('templatesTitle')}
              </h2>
            </div>
            <span className="border-border bg-card text-muted-foreground hidden rounded-full border px-2.5 py-1 text-xs tabular-nums sm:inline-flex">
              {TEMPLATE_ORDER.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {TEMPLATE_ORDER.map((slug) => {
              const t = AUTOMATION_TEMPLATES[slug];
              const Icon = TEMPLATE_ICON[slug];
              return (
                <button
                  key={slug}
                  onClick={() => startFromTemplate(slug)}
                  style={{ backgroundColor: 'var(--card)' }}
                  className="group border-border bg-card hover:border-primary/40 hover:bg-card focus-visible:ring-ring focus-visible:ring-offset-background flex min-h-40 flex-col items-start rounded-2xl border p-5 text-left shadow-sm transition-[border-color,background-color,box-shadow] hover:shadow-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  <div className="bg-primary/10 text-primary group-hover:bg-primary/15 mb-4 flex h-10 w-10 items-center justify-center rounded-xl transition-colors">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-foreground text-sm font-semibold">
                    {t.name}
                  </div>
                  <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                    {t.description}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {automations.length === 0 ? (
        <div className="border-border bg-card/50 flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-10 text-center">
          <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-2xl">
            <Zap className="text-primary h-6 w-6" />
          </div>
          <p className="text-foreground mt-3 text-sm font-medium">
            {t('emptyTitle')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{t('emptyDesc')}</p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label={t('title')}>
          {automations.map((a) => (
            <AutomationCard
              key={a.id}
              automation={a}
              onToggle={(next) => toggleActive(a, next)}
              onEdit={() => router.push(`/automations/${a.id}/edit`)}
              onDuplicate={() => duplicate(a)}
              onLogs={() => router.push(`/automations/${a.id}/logs`)}
              onDelete={() => setPendingDelete(a)}
              t={t}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('deleteDesc', { name: pendingDelete?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AutomationCard({
  automation,
  onToggle,
  onEdit,
  onDuplicate,
  onLogs,
  onDelete,
  t,
}: {
  automation: Automation;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onLogs: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const tTriggers = useTranslations('Automations.builder.triggers');
  const tRelative = useTranslations('Automations.relative');
  const meta = triggerMeta(automation.trigger_type);
  const triggerLabel = isKnownTrigger(automation.trigger_type)
    ? tTriggers(`${automation.trigger_type}.label`)
    : automation.trigger_type;
  return (
    <li className="border-border bg-card hover:border-primary/20 overflow-hidden rounded-2xl border shadow-sm transition-[border-color,box-shadow] hover:shadow-md">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-5 sm:p-5">
        <div
          className="bg-primary/10 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
          aria-hidden
        >
          <Zap className="text-primary h-5 w-5" />
        </div>

        <button
          type="button"
          onClick={onEdit}
          className="focus-visible:ring-ring min-w-0 flex-1 text-left focus-visible:rounded-md focus-visible:ring-2 focus-visible:outline-none"
        >
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-sm font-semibold sm:text-[15px]">
              {automation.name}
            </span>
            {automation.is_active && (
              <span className="border-primary/25 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] leading-none font-semibold">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-current"
                  aria-hidden="true"
                />
                {t('activeIndicator')}
              </span>
            )}
          </div>
          {automation.description && (
            <p className="text-muted-foreground mt-1 truncate text-xs leading-5">
              {automation.description}
            </p>
          )}
          <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                meta.pillClass
              )}
            >
              {triggerLabel}
            </span>
            <span className="tabular-nums">
              {automation.execution_count === 1
                ? t('runs', { count: automation.execution_count })
                : t('runsPlural', { count: automation.execution_count })}
            </span>
            <span aria-hidden>·</span>
            <span>
              {t('lastRun', {
                time: formatRelative(automation.last_executed_at, tRelative),
              })}
            </span>
          </div>
        </button>

        <div className="border-border/70 col-span-2 flex items-center justify-end gap-2 border-t pt-3 sm:col-span-1 sm:border-0 sm:pt-0">
          <Switch
            checked={automation.is_active}
            onCheckedChange={(v) => onToggle(!!v)}
            aria-label={automation.is_active ? t('deactivate') : t('activate')}
          />

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('openMenu')}
              className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring data-[popup-open]:bg-muted inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                {t('edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-4 w-4" />
                {t('duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLogs}>
                <FileText className="h-4 w-4" />
                {t('viewLogs')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
                {t('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}
