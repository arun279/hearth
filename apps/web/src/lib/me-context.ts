import type { MeContext } from "@hearth/domain";
import type { QueryClient } from "@tanstack/react-query";

const ME_CONTEXT_QUERY_KEY = ["me", "context"] as const;
const ME_CONTEXT_STALE_MS = 60_000;

async function meContextQueryFn(): Promise<MeContext> {
  const { api } = await import("./api-client.ts");
  const res = await api.me.context.$get();
  if (!res.ok) throw new Error(`me/context ${res.status}`);
  return (await res.json()) as MeContext;
}

/**
 * Fetch (or read from cache) the current user's `me/context` payload from
 * inside a TanStack Router `beforeLoad`. Returns `null` if the request
 * fails — used by routes that gate on auth and bounce on failure.
 */
export async function loadMeContextOrNull(
  queryClient: QueryClient,
): Promise<MeContext["data"] | null> {
  const result = await queryClient
    .fetchQuery<MeContext>({
      queryKey: ME_CONTEXT_QUERY_KEY,
      queryFn: meContextQueryFn,
      staleTime: ME_CONTEXT_STALE_MS,
    })
    .catch(() => null);
  return result?.data ?? null;
}

/**
 * Same as `loadMeContextOrNull` but throws on failure — used by routes
 * that should fail loud rather than silently treat the user as anonymous.
 */
export async function loadMeContext(queryClient: QueryClient): Promise<MeContext["data"]> {
  const result = await queryClient.fetchQuery<MeContext>({
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: meContextQueryFn,
    staleTime: ME_CONTEXT_STALE_MS,
  });
  return result.data;
}
