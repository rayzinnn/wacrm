import type { ReactNode } from 'react';
import { MessageSquareText } from 'lucide-react';

/** Shared SIS-inspired frame for sign-in, recovery, and invitation steps. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background grid min-h-svh min-w-0 grid-cols-1 items-center gap-12 px-4 py-8 sm:px-8 sm:py-12 lg:grid-cols-[minmax(20rem,34rem)_minmax(0,1fr)] lg:gap-12 lg:px-10 lg:py-4 xl:gap-16 xl:px-14">
      <section className="mx-auto flex w-full max-w-lg min-w-0 flex-col justify-center lg:mx-0 lg:py-8">
        <div className="mb-8 flex items-center gap-3 sm:mb-10">
          <span className="bg-foreground text-background flex size-10 shrink-0 items-center justify-center rounded-xl">
            <MessageSquareText className="size-5" aria-hidden="true" />
          </span>
          <span className="text-foreground text-base font-semibold tracking-tight">
            WACRM
          </span>
        </div>
        <div className="w-full">{children}</div>
      </section>

      <aside className="hidden min-w-0 p-4 ps-0 lg:block" aria-hidden="true">
        <div className="bg-foreground text-background relative flex min-h-[calc(100svh-2rem)] items-center justify-center overflow-hidden rounded-3xl px-8 py-10 xl:px-12 xl:py-14">
          <span className="border-background/10 absolute -top-24 -right-24 size-80 rounded-full border xl:size-[28rem]" />
          <span className="border-background/10 absolute -bottom-32 -left-28 size-96 rounded-full border xl:size-[34rem]" />

          <div className="relative w-full max-w-4xl">
            <svg
              viewBox="0 0 720 480"
              fill="none"
              className="h-auto w-full"
              aria-hidden="true"
            >
              <path
                d="M36 96H684M36 240H684M36 384H684"
                stroke="currentColor"
                strokeOpacity="0.1"
              />
              <path
                d="M36 338C134 338 127 248 229 248C323 248 319 142 422 142C526 142 531 208 684 72"
                stroke="currentColor"
                strokeOpacity="0.72"
                strokeWidth="2"
              />
              <path
                d="M36 382C158 382 163 302 263 302C361 302 365 226 456 226C554 226 583 270 684 194"
                stroke="currentColor"
                strokeOpacity="0.24"
                strokeWidth="1.5"
              />
              <circle cx="36" cy="338" r="5" fill="currentColor" />
              <circle cx="229" cy="248" r="5" fill="currentColor" />
              <circle cx="422" cy="142" r="5" fill="currentColor" />
              <circle cx="684" cy="72" r="5" fill="currentColor" />
            </svg>
          </div>
        </div>
      </aside>
    </main>
  );
}
