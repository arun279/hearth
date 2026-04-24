import type { MeContext } from "@hearth/domain";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";

const ME_CONTEXT_QUERY_KEY = ["me", "context"] as const;

async function fetchMeContext(): Promise<MeContext> {
  const res = await api.me.context.$get();
  if (!res.ok) {
    throw new Error(`Failed to load context (${res.status})`);
  }
  return (await res.json()) as MeContext;
}

export function useMeContext() {
  return useQuery({
    queryKey: ME_CONTEXT_QUERY_KEY,
    queryFn: fetchMeContext,
    staleTime: 60_000,
  });
}
