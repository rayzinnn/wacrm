# F8a — SIS as the default theme

**Date:** 2026-11-16
**Scope:** default theme and focused theme/hook tests only. No commit was created.

## Implementation

- `src/lib/themes.ts` now selects `sis` when no valid theme preference is present. SIS metadata identifies it as the default; Violet remains available as a legacy accent.
- The five legacy accents (`violet`, `emerald`, `cobalt`, `amber`, `rose`) remain in the theme catalog and valid theme IDs. Theme and mode storage keys are unchanged.
- The default mode remains dark. Theme/mode persistence, browser storage-event synchronization, and the root boot script were not changed. The existing boot script and hook consume `DEFAULT_THEME`, so their fallback follows the SIS default while valid saved preferences still take precedence.
- SSR fallback follows `DEFAULT_THEME`; the focused hook test covers the default and a saved legacy theme/mode.

## Checks

- `npx vitest run src/lib/themes.test.ts src/hooks/use-theme.test.tsx` — passed, 2 files / 5 tests.
- `npx eslint src/lib/themes.ts src/lib/themes.test.ts src/hooks/use-theme.test.tsx` — passed.
- `git diff --check` — passed.
- No global typecheck or build was run, per scope.

## Visual QA and pending observations

The local `/login` endpoint returned HTTP 200, but requests took about 4.9–6.9 seconds during the stability check. Because portal QA was conditional on a stable local session, no portal was opened. Desktop/mobile rendering, including viewport and theme-switch behavior in the browser, remains unverified. No screenshots or personal data were collected.

## Files in this recut

- `src/lib/themes.ts`
- `src/lib/themes.test.ts`
- `src/hooks/use-theme.test.tsx`
- `docs/project/evidence/SIS-F8-default.md`
