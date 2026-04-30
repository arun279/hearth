import { useEffect, useState } from "react";

/**
 * Debounce a value for `delayMs`. The returned value updates only after
 * the input has been stable for the full delay window — typing bursts
 * coalesce into one downstream effect (one search request, one filter
 * recalculation).
 *
 * Initial render returns the input verbatim so first-paint reflects the
 * caller's seed value. The hook is layout-agnostic: switching tabs,
 * unmounting mid-burst, or supplying a new delay all clear the pending
 * timer in the cleanup phase.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
