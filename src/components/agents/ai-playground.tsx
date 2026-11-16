'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Bot,
  RotateCcw,
  Send,
  Loader2,
  UserCircle2,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ArrowUpRight, SlidersHorizontal } from 'lucide-react';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** assistant-only: the agent signalled a human handoff on this turn. */
  handoff?: boolean;
}

export function AiPlayground({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const t = useTranslations('Agents.playground');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send only role+content — the server ignores anything else.
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(t('notConfigured'));
        } else {
          toast.error(data.error ?? t('noReply'));
        }
        // Roll the unsent user turn back so the transcript stays clean.
        setTurns(turns);
        setInput(text);
        return;
      }
      setTurns([
        ...next,
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim()
              ? data.reply
              : '',
          handoff: Boolean(data.handoff),
        },
      ]);
    } catch {
      toast.error(t('unreachable'));
      setTurns(turns);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <section
        aria-label={t('title')}
        className="border-border bg-card flex h-[min(68vh,760px)] min-h-[440px] flex-col overflow-hidden rounded-2xl border shadow-sm"
      >
        {/* Header */}
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Bot className="text-primary h-4 w-4 shrink-0" />
              <span className="text-foreground text-sm font-semibold">
                {t('title')}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('subtitle')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTurns([])}
            disabled={turns.length === 0 || sending}
            className="text-muted-foreground"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t('reset')}
          </Button>
        </div>

        {/* Transcript */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6"
        >
          {turns.length === 0 && (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center text-center text-sm">
              <span className="border-border bg-muted/60 mb-3 grid h-12 w-12 place-items-center rounded-2xl border">
                <Bot className="text-muted-foreground/70 h-6 w-6" />
              </span>
              <p className="text-foreground max-w-md font-medium">
                {t('emptyTitle')}
              </p>
              <p className="mt-1 text-xs">{t('emptyDesc')}</p>
              {onGoToSetup && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={onGoToSetup}
                  className="mt-1 h-auto p-0 text-xs"
                >
                  {t('goToSetup')} <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          )}

          {turns.map((turn, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-2',
                turn.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {turn.role === 'assistant' && (
                <Bot className="text-primary mt-1 h-5 w-5 shrink-0" />
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                  turn.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-muted text-foreground rounded-bl-sm'
                )}
              >
                {turn.content && (
                  <p className="whitespace-pre-wrap">{turn.content}</p>
                )}
                {turn.role === 'assistant' && turn.handoff && (
                  <p
                    className={cn(
                      'flex items-center gap-1 text-xs text-amber-500',
                      turn.content && 'border-border/50 mt-1.5 border-t pt-1.5'
                    )}
                  >
                    <UserCircle2 className="h-3.5 w-3.5" />
                    {t('handoff')}
                  </p>
                )}
              </div>
              {turn.role === 'user' && (
                <UserCircle2 className="text-muted-foreground mt-1 h-5 w-5 shrink-0" />
              )}
            </div>
          ))}

          {sending && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Bot className="text-primary h-5 w-5" />
              <Loader2 className="h-4 w-4 animate-spin" /> {t('thinking')}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-border bg-muted/20 flex items-end gap-2 border-t p-3 sm:p-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('placeholder')}
            rows={1}
            className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm outline-none"
            aria-label={t('placeholder')}
          />
          <Button
            size="sm"
            onClick={send}
            disabled={!input.trim() || sending}
            className="h-9 w-9 shrink-0 p-0"
            aria-label={t('placeholder')}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        <section className="border-border bg-card rounded-2xl border p-5">
          <div className="bg-muted text-foreground mb-4 flex h-10 w-10 items-center justify-center rounded-xl">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
            {t('goToSetup')}
          </p>
          <h2 className="text-foreground mt-2 text-lg font-semibold tracking-tight">
            {t('title')}
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {t('emptyDesc')}
          </p>
          {onGoToSetup && (
            <Button
              variant="outline"
              size="sm"
              onClick={onGoToSetup}
              className="mt-5 w-full justify-between"
            >
              {t('goToSetup')} <ArrowUpRight className="h-4 w-4" />
            </Button>
          )}
        </section>
      </aside>
    </div>
  );
}
