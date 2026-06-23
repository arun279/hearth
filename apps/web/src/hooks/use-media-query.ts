import { useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query and re-render on match changes.
 * SSR-safe: the server snapshot returns `false` (matches resolve client-side
 * once `window.matchMedia` exists), so a component renders its narrow-width
 * branch during hydration and corrects on mount without a layout mismatch
 * warning. Used to pick the structural layout when CSS alone can't switch it —
 * e.g. a centred Dialog at ≥ md vs an edge Sheet below it.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  );
}
