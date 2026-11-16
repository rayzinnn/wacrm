import type { ReactNode } from 'react';
import { MessageSquareText } from 'lucide-react';

/** Shared SIS-inspired frame for sign-in, recovery, and invitation steps. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background grid min-h-svh min-w-0 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
      <section className="flex min-w-0 items-center justify-center px-4 py-8 sm:px-8 sm:py-12 lg:px-10 xl:px-14">
        <div className="w-full max-w-lg">
          <div className="mb-7 flex items-center gap-3 sm:mb-9">
            <span className="bg-foreground text-background flex size-10 shrink-0 items-center justify-center rounded-xl">
              <MessageSquareText className="size-5" aria-hidden="true" />
            </span>
            <span className="text-foreground text-base font-semibold tracking-tight">
              WACRM
            </span>
          </div>
          {children}
        </div>
      </section>

      <aside className="hidden min-w-0 p-4 ps-0 lg:block" aria-hidden="true">
        <div className="relative flex min-h-[calc(100svh-2rem)] flex-col justify-between overflow-hidden rounded-3xl bg-neutral-950 px-8 py-10 text-neutral-50 xl:px-12 xl:py-14">
          <span className="border-background/10 absolute -top-20 -right-20 size-72 rounded-full border xl:size-96" />
          <span className="border-background/10 absolute -bottom-28 -left-24 size-80 rounded-full border xl:size-[28rem]" />

          <div className="relative flex items-center gap-3">
            <span className="bg-background/10 flex size-10 items-center justify-center rounded-xl">
              <MessageSquareText className="size-5" />
            </span>
            <span className="text-sm font-semibold tracking-wide">WACRM</span>
          </div>

          <div className="relative flex items-end justify-between gap-4">
            <span className="text-[clamp(11rem,22vw,21rem)] leading-[0.72] font-semibold tracking-[-0.1em] select-none">
              W
            </span>
            <MessageSquareText className="mb-2 size-12 shrink-0 text-white/45 xl:mb-4 xl:size-16" />
          </div>

          <span className="bg-background/60 relative size-2 rounded-full" />
        </div>
      </aside>
    </main>
  );
}
