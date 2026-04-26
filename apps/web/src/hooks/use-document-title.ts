import { useEffect } from "react";

const SUFFIX = "Hearth";

/**
 * Set `document.title` for the lifetime of the calling component.
 * Restores the previous title on unmount so a route that sets
 * "People — Tuesday Night Learners — Hearth" doesn't leave that string
 * stuck on the next route.
 *
 * The title pattern is `${segments.join(" — ")} — Hearth` for nested
 * surfaces, or just `Hearth` if no segments are passed (SignInScreen,
 * empty home). Pass `null` parts to skip — e.g. before `/me/context`
 * loads the group name.
 */
export function useDocumentTitle(parts: ReadonlyArray<string | null | undefined>): void {
  // Serialize the parts into a stable scalar so the effect's dep array
  // doesn't churn on every render (a new `parts` array reference would
  // refire the effect even when the rendered title is unchanged).
  const next = computeTitle(parts);
  useEffect(() => {
    const prev = document.title;
    document.title = next;
    return () => {
      document.title = prev;
    };
  }, [next]);
}

function computeTitle(parts: ReadonlyArray<string | null | undefined>): string {
  const trimmed = parts.filter((p): p is string => typeof p === "string" && p.length > 0);
  return trimmed.length === 0 ? SUFFIX : `${trimmed.join(" — ")} — ${SUFFIX}`;
}
