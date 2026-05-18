import type {
  ActivityAudience,
  ActivityFlow,
  ActivityPart,
  ActivityWindow,
  CompletionRule,
  LearningActivity,
  LearningActivityListItem,
  PostClosePolicy,
} from "@hearth/domain";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

/**
 * The list-projection the Activities tab renders. Branded ids erase
 * to plain strings at runtime, so the domain shape works as-is in
 * the SPA — keeps one source of truth for the row shape across
 * server, port, and client.
 */
export type ActivityListItem = LearningActivityListItem;

const trackActivitiesKey = (trackId: string) => ["activities", "by-track", trackId] as const;
const activityDetailKey = (id: string) => ["activities", "detail", id] as const;
const trackSummaryKey = (groupId: string, trackId: string) =>
  ["tracks", "summary", groupId, trackId] as const;

function invalidateActivities(qc: QueryClient, groupId: string, trackId: string) {
  qc.invalidateQueries({ queryKey: trackActivitiesKey(trackId) });
  qc.invalidateQueries({ queryKey: trackSummaryKey(groupId, trackId) });
}

/**
 * The composer's serialized payload. The SPA constructs this from the
 * dialog's form state and ships it to `POST /tracks/:trackId/activities`
 * (or `PUT /activities/:id`). Field shapes mirror the domain envelope
 * data so both client and server validate against the same Zod source.
 */
export type ActivityComposerPayload = {
  readonly trackId: string;
  readonly title: string;
  readonly description: string | null;
  readonly parts: readonly ActivityPart[];
  readonly flow: ActivityFlow;
  readonly audience: ActivityAudience;
  readonly window: ActivityWindow | null;
  readonly postClosePolicy: PostClosePolicy | null;
  readonly completionRule: CompletionRule;
  readonly libraryRefs: ReadonlyArray<{
    readonly libraryItemId: string;
    readonly pinnedRevisionId: string | null;
  }>;
  readonly prerequisiteActivityIds: readonly string[];
  readonly suggestedNextActivityIds: readonly string[];
};

export function useTrackActivities(trackId: string, enabled: boolean) {
  return useQuery({
    queryKey: trackActivitiesKey(trackId),
    enabled,
    queryFn: async (): Promise<readonly ActivityListItem[]> => {
      const res = await api.tracks[":trackId"].activities.$get({ param: { trackId } });
      await assertOk(res);
      return (await res.json()) as readonly ActivityListItem[];
    },
  });
}

export function useActivity(id: string, enabled: boolean) {
  return useQuery({
    queryKey: activityDetailKey(id),
    enabled,
    queryFn: async (): Promise<LearningActivity> => {
      const res = await api.activities[":activityId"].$get({ param: { activityId: id } });
      await assertOk(res);
      return (await res.json()) as LearningActivity;
    },
  });
}

export function useCreateActivity(groupId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ActivityComposerPayload): Promise<LearningActivity> => {
      const res = await api.tracks[":trackId"].activities.$post({
        param: { trackId },
        // The hc client's Zod-derived input is structurally identical to
        // ActivityComposerPayload — the cast keeps the types from
        // double-importing every fragment from the api package.
        json: payload as never,
      });
      await assertOk(res);
      return (await res.json()) as LearningActivity;
    },
    onSuccess: () => invalidateActivities(qc, groupId, trackId),
  });
}

export function useUpdateActivity(groupId: string, trackId: string, activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<ActivityComposerPayload>): Promise<LearningActivity> => {
      const res = await api.activities[":activityId"].$put({
        param: { activityId },
        json: patch as never,
      });
      await assertOk(res);
      return (await res.json()) as LearningActivity;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: activityDetailKey(activityId) });
      invalidateActivities(qc, groupId, trackId);
    },
  });
}

export function useDeleteActivity(groupId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (activityId: string): Promise<void> => {
      const res = await api.activities[":activityId"].$delete({
        param: { activityId },
      });
      await assertOk(res);
    },
    onSuccess: () => invalidateActivities(qc, groupId, trackId),
  });
}
