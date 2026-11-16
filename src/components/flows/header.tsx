'use client';

/**
 * Editor toolbar — flow name / description, status chip, dirty
 * indicator, and the action buttons (Save, Activate/Pause, Delete,
 * View runs, Back).
 *
 * Restyled to the Flow Builder design handoff: a single compact
 * toolbar row (back · icon · inline-editable name · status chip ·
 * edited dot on the left; Runs · Delete · Activate · Save on the
 * right) followed by a subtle, full-width description "note" line.
 * Replaces the old three-row stack so the editor reads as one app
 * chrome bar above the canvas/list stage.
 *
 * Lifted out of flow-builder.tsx so the same toolbar renders above
 * both views in FlowEditorShell. Without this, canvas users had no
 * way to save without toggling to list view.
 *
 * Reads everything from the editor context (`useFlowEditor`) so it
 * stays in sync with whichever view is mutating state, and routes
 * router navigation locally (back to /flows, View runs to
 * /flows/[id]/runs) — those don't belong in the hook.
 */

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  CircleDot,
  History,
  Loader2,
  PauseCircle,
  PlayCircle,
  Save,
  Trash2,
  Workflow,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFlowEditor, type BuilderState } from './flow-editor-state';
import styles from './flow-editor.module.css';

export function EditorHeader() {
  const router = useRouter();
  const t = useTranslations('Flows.header');
  const {
    flow,
    state,
    setState,
    dirty,
    saving,
    activating,
    canActivate,
    save,
    setStatus,
    deleteFlow,
  } = useFlowEditor();

  return (
    <header className={styles.header}>
      <div className={styles.headerRow}>
        {/* ---- left: back · icon · name · status · edited ---- */}
        <button
          type="button"
          onClick={() => router.push('/flows')}
          title={t('backToFlows')}
          aria-label={t('backToFlows')}
          className={styles.backButton}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className={styles.flowMark}>
          <Workflow className="h-[18px] w-[18px]" />
        </span>
        <input
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          placeholder={t('namePlaceholder')}
          spellCheck={false}
          aria-label={t('namePlaceholder')}
          className={styles.flowName}
        />
        <StatusChip status={state.status} />
        {dirty && (
          <span
            className={styles.dirty}
            title={t('unsavedHint')}
            aria-live="polite"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {t('edited')}
          </span>
        )}

        {/* ---- right: runs · delete · activate · save ---- */}
        <div className={styles.headerActions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/flows/${flow.id}/runs`)}
            className={styles.pageButton}
          >
            <History className="h-3.5 w-3.5" />
            {t('runs')}
            <span className="bg-muted text-muted-foreground ml-0.5 rounded px-1.5 py-0.5 font-mono text-[11px]">
              {flow.execution_count}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteFlow()}
            className="text-red-700 hover:bg-red-500/10 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('delete')}
          </Button>
          {state.status === 'active' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus('draft')}
              disabled={activating}
              className={styles.pageButton}
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5" />
              )}
              {t('pause')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus('active')}
              disabled={activating || !canActivate}
              title={!canActivate ? t('fixIssues') : undefined}
              className={styles.pageButton}
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              {t('activate')}
            </Button>
          )}
          <Button
            onClick={() => void save()}
            disabled={saving}
            size="sm"
            className={styles.pageButton}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {t('save')}
          </Button>
        </div>
      </div>

      {/* ---- description note (subtle, inline-editable) ---- */}
      <input
        value={state.description}
        onChange={(e) =>
          setState((s) => ({ ...s, description: e.target.value }))
        }
        placeholder={t('descriptionPlaceholder')}
        aria-label={t('descriptionLabel')}
        className={styles.description}
      />
    </header>
  );
}

function StatusChip({ status }: { status: BuilderState['status'] }) {
  // Status labels live with the flows list so the chip and the list
  // badge can never drift apart.
  const t = useTranslations('Flows.list');
  const cfg = {
    draft: {
      cls: styles.statusChip,
      label: t('statusDraft'),
    },
    active: {
      cls: `${styles.statusChip} ${styles.statusActive}`,
      label: t('statusActive'),
    },
    archived: {
      cls: `${styles.statusChip} ${styles.statusArchived}`,
      label: t('statusArchived'),
    },
  }[status];
  return (
    <span className={cn('shrink-0', cfg.cls)}>
      <CircleDot className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}
