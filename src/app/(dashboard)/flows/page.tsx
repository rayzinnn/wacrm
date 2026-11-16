'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  PlayCircle,
  PauseCircle,
  Archive,
  HelpCircle,
  UserPlus,
  FileText,
} from 'lucide-react';

import { useTranslations } from 'next-intl';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import styles from './flows.module.css';

/**
 * Flows list page.
 *
 * Open to every authenticated user. Flows is in soft-GA — the "Beta"
 * chip in the header is the only remaining signal that the surface
 * is new. The previous per-account beta gate was removed in PR #134.
 */

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS = (
  t: ReturnType<typeof useTranslations>
): Record<FlowRow['status'], string> => ({
  draft: t('statusDraft'),
  active: t('statusActive'),
  archived: t('statusArchived'),
});

const STATUS_COLORS: Record<FlowRow['status'], string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  active:
    'border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  archived: 'border-border bg-muted/50 text-muted-foreground',
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon: 'MessageSquare' | 'HelpCircle' | 'UserPlus';
  trigger_type: string;
  node_count: number;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
} as const;

export default function FlowsPage() {
  const router = useRouter();
  const canCreate = useCan('send-messages');
  const t = useTranslations('Flows.list');
  const tGate = useTranslations('GatedButton');
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowsRes, tmplRes] = await Promise.all([
          fetch('/api/flows'),
          fetch('/api/flows/templates'),
        ]);
        if (!flowsRes.ok) {
          throw new Error(`Failed to load flows: ${flowsRes.status}`);
        }
        const flowsJson = (await flowsRes.json()) as { flows: FlowRow[] };
        if (!cancelled) setFlows(flowsJson.flows ?? []);
        // Templates endpoint is forward-looking — if it 404s on an
        // older deployment, gracefully fall through.
        if (tmplRes.ok) {
          const tmplJson = (await tmplRes.json()) as {
            templates: TemplateSummary[];
          };
          if (!cancelled) setTemplates(tmplJson.templates ?? []);
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
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: 'keyword',
          trigger_config: { keywords: [] },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      setNewName('');
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      console.error(err);
      toast.error(t('createError'));
    } finally {
      setCreating(false);
    }
  }

  async function handleUseTemplate(slug: string) {
    setCreating(true);
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_slug: slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          json.error ?? t('cloneFailedStatus', { status: res.status })
        );
      }
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('cloneError');
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(t('deleteConfirm', { name: flow.name }));
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success(t('deleteSuccess'));
    } catch (err) {
      console.error(err);
      toast.error(t('deleteError'));
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.intro}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{t('title')}</h1>
            <span className={styles.beta}>{t('beta')}</span>
          </div>
          <p className={styles.description}>{t('description')}</p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason={tGate('reasons.createFlows')}
          onClick={() => setCreateOpen(true)}
          className={styles.createButton}
        >
          <Plus className="h-4 w-4" />
          {t('newFlow')}
        </GatedButton>
      </header>

      {flows.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          canCreate={canCreate}
          t={t}
        />
      ) : (
        <div className={styles.cardGrid}>
          {flows.map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              onEdit={() => router.push(`/flows/${flow.id}`)}
              onDelete={() => handleDelete(flow)}
              t={t}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* `sm:max-w-4xl` not `max-w-4xl` — shadcn's DialogContent has
            `sm:max-w-sm` baked into its default classes. Without the
            sm: prefix our override applies at base only and the
            sm-scoped 384px wins at every real desktop breakpoint. */}
        <DialogContent
          className={cn(
            styles.createDialog,
            'bg-popover text-popover-foreground sm:max-w-4xl'
          )}
        >
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('createDesc')}
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div className={styles.templateSection}>
              <p className={styles.sectionLabel}>{t('startTemplate')}</p>
              <div className={styles.templateGrid}>
                {templates.map((template) => {
                  const Icon = TEMPLATE_ICONS[template.icon] ?? FileText;
                  return (
                    <button
                      key={template.slug}
                      type="button"
                      onClick={() => handleUseTemplate(template.slug)}
                      disabled={creating}
                      className={styles.templateTile}
                    >
                      <Icon className={cn(styles.templateIcon, 'h-5 w-5')} />
                      <span className={styles.templateName}>
                        {template.name}
                      </span>
                      <span className={styles.templateDescription}>
                        {template.description}
                      </span>
                      <span className={styles.templateCount}>
                        {t('nodeCount', { count: template.node_count })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className={styles.blankSection}>
            <p className={styles.sectionLabel}>{t('startBlank')}</p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('placeholderName')}
              aria-label={t('placeholderName')}
              className="bg-muted"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
            />
          </div>

          <DialogFooter className={styles.dialogFooter}>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('createBlank')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  onCreate,
  canCreate,
  t,
}: {
  onCreate: () => void;
  canCreate: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const tGate = useTranslations('GatedButton');
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <Workflow className="text-muted-foreground h-6 w-6" />
      </div>
      <h2 className={styles.emptyTitle}>{t('emptyTitle')}</h2>
      <p className={styles.emptyDescription}>{t('emptyDesc')}</p>
      <GatedButton
        canAct={canCreate}
        gateReason={tGate('reasons.createFlows')}
        onClick={onCreate}
        className={styles.emptyAction}
      >
        <Plus className="h-4 w-4" />
        {t('createFirst')}
      </GatedButton>
    </div>
  );
}

function FlowCard({
  flow,
  onEdit,
  onDelete,
  t,
}: {
  flow: FlowRow;
  onEdit: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const triggerSummary = describeTrigger(flow, t);
  const StatusIcon =
    flow.status === 'active'
      ? PlayCircle
      : flow.status === 'archived'
        ? Archive
        : PauseCircle;
  return (
    <article className={styles.flowCard}>
      <div className={styles.cardHeader}>
        <div className={styles.identity}>
          <span className={styles.flowMark}>
            <Workflow className="h-4 w-4 shrink-0" />
          </span>
          <h3 className={styles.flowName}>{flow.name}</h3>
        </div>
        <Badge
          variant="outline"
          className={cn(styles.status, STATUS_COLORS[flow.status])}
        >
          <StatusIcon className="h-3 w-3" />
          {STATUS_LABELS(t)[flow.status]}
        </Badge>
      </div>

      <p className={styles.cardDescription}>
        {flow.description || triggerSummary}
      </p>

      <div className={styles.cardMeta}>
        <span className={styles.runCount}>
          <MessageSquare className="h-3 w-3" />
          {t('runCount', { count: flow.execution_count })}
        </span>
      </div>

      <div className={styles.cardActions}>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          {t('edit')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-700 hover:bg-red-500/10 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('delete')}
        </Button>
      </div>
    </article>
  );
}

function describeTrigger(
  flow: FlowRow,
  t: ReturnType<typeof useTranslations>
): string {
  if (flow.trigger_type === 'keyword') {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return t('triggerKeywordNone');
    return t('triggerKeyword', { keywords: keywords.join(', ') });
  }
  if (flow.trigger_type === 'first_inbound_message') {
    return t('triggerFirstInbound');
  }
  return t('triggerManual');
}
