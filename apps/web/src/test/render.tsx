import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, type RenderResult, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { Toaster } from "sonner";

/**
 * Canonical mount seam for SPA component DOM tests. Every `*.dom.test.tsx`
 * builds on this so a component is exercised against controllable state with a
 * single, consistent provider stack.
 *
 * Retries are disabled on both queries and mutations: a test asserts the
 * error branch the instant the first attempt rejects, with no exponential
 * backoff stalling the run or masking the transition under test. This is the
 * deliberate divergence from the production `QueryClient` (which retries
 * transient failures) — tests own the network via mocked hooks or the fetch
 * spy seam (`installFetchSpy`), so retry adds only flakiness here.
 *
 * Pass `withToaster` for components that surface `toast(...)` feedback and the
 * test needs to read the rendered toast (sonner queues without a mounted
 * `<Toaster>`, so assertions on toast content require it). Leave it off to
 * keep the tree minimal.
 */
function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
  withToaster?: boolean;
}

interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
  user: ReturnType<typeof userEvent.setup>;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { queryClient = makeTestQueryClient(), withToaster = false, ...renderOptions } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
        {withToaster ? <Toaster /> : null}
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
    queryClient,
    user: userEvent.setup(),
  };
}
