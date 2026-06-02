import type { ActivityPlayerProjection } from "@hearth/domain";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

const activityPlayerKey = (activityId: string) => ["activity-player", activityId] as const;

/**
 * Fetch the Activity Player projection. The endpoint returns a denormalized
 * blob — activity body + resolved library refs (signed read URLs and mime
 * types) + access state + viewer enrollment status — so the player can
 * render its chrome without N+1 round-trips against the library service.
 *
 * 404 responses (post-close hidden, audience exclusion, not-a-member)
 * surface through React Query's `isError` branch with the standard
 * Problem shape; the route renders a not-found state in that case.
 *
 * `staleTime: 60_000` matches the other read-mostly surfaces' cadence.
 * A composer save (existing surfaces) and per-record updates (future)
 * invalidate this query at the mutation call site; the cache key is
 * derived at the call site by `["activity-player", activityId]`.
 */
export function useActivityPlayer(activityId: string, enabled = true) {
  return useQuery<ActivityPlayerProjection>({
    queryKey: activityPlayerKey(activityId),
    enabled: enabled && activityId.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await api.activities[":activityId"].player.$get({
        param: { activityId },
      });
      await assertOk(res);
      return (await res.json()) as ActivityPlayerProjection;
    },
  });
}
