import { useCallback, useEffect, useRef } from "react";

/**
 * A debounced version of `fn`: rapid calls collapse into a single
 * invocation `delayMs` after the last one. The pending call is flushed on
 * unmount so an in-flight reflection autosave is never dropped when the
 * participant navigates away mid-edit. `fn` is read through a ref so the
 * debounced identity stays stable across renders.
 */
export function useDebouncedCallback<A extends readonly unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): (...args: A) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        pending.current?.();
      }
    },
    [],
  );

  return useCallback(
    (...args: A) => {
      if (timer.current !== null) clearTimeout(timer.current);
      pending.current = () => fnRef.current(...args);
      timer.current = setTimeout(() => {
        pending.current?.();
        pending.current = null;
        timer.current = null;
      }, delayMs);
    },
    [delayMs],
  );
}
