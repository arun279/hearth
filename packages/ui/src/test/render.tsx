import { type RenderOptions, type RenderResult, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

/**
 * Mount seam for primitive DOM tests. Primitives are presentational and carry
 * their own internal state (focus traps, popovers, radio groups); they consume
 * no data-fetching context, so this is deliberately lighter than the SPA's
 * `apps/web/src/test/render.tsx` (which adds a `QueryClientProvider` + toaster
 * for feature components). Keeping the two shaped to their actual needs avoids
 * pulling react-query into `@hearth/ui` and keeps each harness honest.
 */
export interface RenderPrimitiveResult extends RenderResult {
  user: ReturnType<typeof userEvent.setup>;
}

export function renderPrimitive(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): RenderPrimitiveResult {
  return {
    ...render(ui, options),
    user: userEvent.setup(),
  };
}
