import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  STORAGE_KEY,
  THEMES,
  THEME_IDS,
  isThemeId,
} from "@/lib/themes";

describe("theme catalog defaults", () => {
  it("defaults new preferences to SIS while retaining all existing accents", () => {
    expect(DEFAULT_THEME).toBe("sis");
    expect(THEME_IDS).toEqual([
      "violet",
      "emerald",
      "cobalt",
      "amber",
      "rose",
      "sis",
    ]);
    expect(THEMES.map(({ id }) => id)).toEqual(THEME_IDS);
    expect(["violet", "emerald", "cobalt", "amber", "rose"].every(isThemeId)).toBe(true);
  });

  it("keeps persisted keys and the independent dark-mode default", () => {
    expect(STORAGE_KEY).toBe("wacrm.theme");
    expect(MODE_STORAGE_KEY).toBe("wacrm.mode");
    expect(DEFAULT_MODE).toBe("dark");
  });
});
