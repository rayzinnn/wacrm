'use client';

import { Moon, Sun } from 'lucide-react';

import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

import { useTranslations } from 'next-intl';

/**
 * Light/dark mode toggle — a single icon button that flips the app
 * between the two modes. Sun shows in light mode (click → go dark),
 * moon shows in dark mode (click → go light); the label always names
 * the destination so screen-reader users hear what the click does.
 *
 * 40×40 hit target to match the header's other touch controls.
 */
export function ModeToggle({ className }: { className?: string }) {
  const t = useTranslations('ModeToggle');
  const { mode, toggleMode } = useTheme();
  const goingTo = mode === 'dark' ? 'light' : 'dark';
  const switchLabel = t('switchMode', { mode: goingTo });

  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label={switchLabel}
      title={switchLabel}
      className={cn(
        'sis-shell__mode-toggle text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-ring flex h-10 w-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
        className
      )}
    >
      {mode === 'dark' ? (
        <Moon className="h-5 w-5" />
      ) : (
        <Sun className="h-5 w-5" />
      )}
    </button>
  );
}
