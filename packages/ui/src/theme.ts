import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "hearth.theme";

function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" ? raw : null;
}

function systemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

/**
 * Syncs with `localStorage["hearth.theme"]`. Initial render honors OS
 * preference; any explicit toggle persists. No data-sensitive state is stored
 * here — just the string "light" or "dark".
 */
export function useTheme(): readonly [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? systemTheme());

  useEffect(() => {
    applyTheme(theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
  }, [theme]);

  return [theme, setThemeState] as const;
}
