'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles, Settings2, BarChart3, Activity } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AiConfig } from '@/components/settings/ai-config';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

type Tab = 'playground' | 'setup' | 'usage';

export default function AgentsPage() {
  const t = useTranslations('Agents');
  const { accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<Tab>('playground');
  const [decided, setDecided] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [assistantActive, setAssistantActive] = useState(false);
  const handleAiStatusChange = useCallback(
    (status: { configured: boolean; isActive: boolean }) => {
      setConfigured(status.configured);
      setAssistantActive(status.isActive);
    },
    []
  );
  const statusLabel = t(
    !configured
      ? 'statusNotConfigured'
      : assistantActive
        ? 'statusActive'
        : 'statusPaused'
  );

  // Land first-time users on Setup, returning users on the Playground.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          handleAiStatusChange({
            configured: Boolean(data?.configured),
            isActive: Boolean(data?.configured && data?.is_active),
          });
          setTab(data?.configured ? 'playground' : 'setup');
        }
      } catch {
        if (!cancelled) setTab('setup');
      } finally {
        if (!cancelled) setDecided(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handleAiStatusChange]);

  return (
    <div className="mx-auto w-full max-w-[1440px] pb-10">
      <header className="border-border mb-7 flex flex-col justify-between gap-5 border-b pb-6 sm:flex-row sm:items-end">
        <div className="max-w-3xl">
          <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-[0.16em] uppercase">
            {t('tabSetup')}
          </p>
          <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
            {t('description')}
          </p>
        </div>
        <div
          className="border-border bg-card text-muted-foreground inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium"
          role="status"
        >
          <Activity
            aria-hidden="true"
            className={`h-3.5 w-3.5 ${assistantActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}
          />
          <span>{statusLabel}</span>
        </div>
      </header>

      {decided && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="space-y-5"
        >
          <TabsList
            variant="line"
            className={`border-border grid h-auto w-full ${canViewUsage ? 'grid-cols-3' : 'grid-cols-2'} justify-start gap-1 rounded-none border-b bg-transparent p-0 sm:inline-flex`}
          >
            <TabsTrigger
              value="playground"
              className="min-w-0 px-1 text-xs whitespace-normal sm:px-1.5 sm:text-sm"
            >
              <Sparkles className="mr-1.5 hidden h-4 w-4 sm:block" />
              {t('tabPlayground')}
            </TabsTrigger>
            <TabsTrigger
              value="setup"
              className="min-w-0 px-1 text-xs whitespace-normal sm:px-1.5 sm:text-sm"
            >
              <Settings2 className="mr-1.5 hidden h-4 w-4 sm:block" />
              {t('tabSetup')}
            </TabsTrigger>
            {canViewUsage && (
              <TabsTrigger
                value="usage"
                className="min-w-0 px-1 text-xs whitespace-normal sm:px-1.5 sm:text-sm"
              >
                <BarChart3 className="mr-1.5 hidden h-4 w-4 sm:block" />
                {t('tabUsage')}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="playground" className="mt-0">
            <AiPlayground onGoToSetup={() => setTab('setup')} />
          </TabsContent>

          <TabsContent value="setup" className="mt-0">
            <AiConfig onStatusChange={handleAiStatusChange} />
          </TabsContent>

          {canViewUsage && (
            <TabsContent value="usage" className="mt-0">
              <AiUsageCard />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
