import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./use-theme";

function ThemeProbe() {
  const { theme, mode } = useTheme();
  return createElement("output", null, `${theme}/${mode}`);
}

describe("useTheme SSR defaults", () => {
  it("provides SIS and dark when server rendering without a stored preference", () => {
    const html = renderToStaticMarkup(
      createElement(ThemeProvider, null, createElement(ThemeProbe)),
    );

    expect(html).toContain("sis/dark");
  });

  it("uses the same defaults in its provider-free fallback", () => {
    const html = renderToStaticMarkup(createElement(ThemeProbe));

    expect(html).toContain("sis/dark");
  });

  it("keeps a saved legacy theme and mode instead of replacing them with defaults", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        if (key === "wacrm.theme") return "violet";
        if (key === "wacrm.mode") return "light";
        return null;
      },
    });

    try {
      const html = renderToStaticMarkup(
        createElement(ThemeProvider, null, createElement(ThemeProbe)),
      );

      expect(html).toContain("violet/light");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
