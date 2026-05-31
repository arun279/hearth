import { isValidElement, type ReactElement } from "react";

/**
 * Depth-first walk over a React element tree returned by calling a function
 * component directly (no DOM, no testing-library). Used by the player's
 * co-located unit tests to assert handler wiring — SSR drops handlers, so
 * identity-comparing an element's prop against the expected reference is the
 * strongest available wiring assertion.
 */
export function findElement(
  node: unknown,
  predicate: (el: ReactElement) => boolean,
): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (predicate(node)) return node;
  const children = (node.props as { children?: unknown }).children;
  return children === undefined ? null : findElement(children, predicate);
}
