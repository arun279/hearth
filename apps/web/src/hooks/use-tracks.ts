import type {
  ContributionPolicyEnvelope,
  GroupMembership,
  LearningTrack,
  StudyGroup,
  TrackEnrollment,
  TrackStructureEnvelope,
} from "@hearth/domain";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

export type TrackCaps = {
  readonly canEditMetadata: boolean;
  readonly canEditStructure: boolean;
  readonly canEditContributionPolicy: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canArchive: boolean;
};

export type TrackSummaryCounts = {
  readonly activityCount: number;
  readonly sessionCount: number;
  readonly libraryItemCount: number;
  readonly pendingContributionCount: number;
  readonly facilitatorCount: number;
  readonly enrollmentCount: number;
};

export type TrackDetail = {
  readonly track: LearningTrack;
  readonly group: {
    readonly id: StudyGroup["id"];
    readonly name: string;
    readonly status: StudyGroup["status"];
  };
  readonly myGroupMembership: GroupMembership | null;
  readonly myEnrollment: TrackEnrollment | null;
  readonly structure: TrackStructureEnvelope;
  readonly contributionPolicy: ContributionPolicyEnvelope;
  readonly caps: TrackCaps;
};

const tracksByGroupKey = (groupId: string) => ["tracks", "by-group", groupId] as const;
const trackDetailKey = (trackId: string) => ["tracks", "detail", trackId] as const;
const trackSummaryKey = (groupId: string, trackId: string) =>
  ["tracks", "summary", groupId, trackId] as const;
const trackPeopleKey = (trackId: string) => ["tracks", "people", trackId] as const;

/**
 * Invalidate every cache entry that could become stale after a mutation
 * touches the track or one of its parents. Centralised so each mutation
 * stays a one-liner; missing an invalidation here surfaces as visibly
 * stale UI rather than a bug we'd catch later.
 */
function invalidateTrack(qc: QueryClient, groupId: string, trackId: string) {
  qc.invalidateQueries({ queryKey: trackDetailKey(trackId) });
  qc.invalidateQueries({ queryKey: trackSummaryKey(groupId, trackId) });
  qc.invalidateQueries({ queryKey: tracksByGroupKey(groupId) });
  // Group counts (tab badges, group home) include trackCount which can
  // shift when a track is created or archived.
  qc.invalidateQueries({ queryKey: ["groups", "detail", groupId] });
}

function invalidateTrackEnrollment(qc: QueryClient, groupId: string, trackId: string) {
  invalidateTrack(qc, groupId, trackId);
  qc.invalidateQueries({ queryKey: trackPeopleKey(trackId) });
  // /me/context's `enrollments` array shifts on every enroll/leave —
  // invalidate so the SPA's "Up next" / track-card pills stay accurate.
  qc.invalidateQueries({ queryKey: ["me", "context"] });
}

export function useTracksInGroup(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: tracksByGroupKey(groupId),
    enabled,
    queryFn: async (): Promise<readonly LearningTrack[]> => {
      const res = await api.g[":groupId"].tracks.$get({ param: { groupId } });
      await assertOk(res);
      const body = (await res.json()) as { entries: readonly LearningTrack[] };
      return body.entries;
    },
  });
}

export function useTrack(trackId: string, enabled: boolean) {
  return useQuery({
    queryKey: trackDetailKey(trackId),
    enabled,
    queryFn: async (): Promise<TrackDetail> => {
      const res = await api.tracks[":trackId"].$get({ param: { trackId } });
      await assertOk(res);
      return (await res.json()) as TrackDetail;
    },
  });
}

export function useTrackSummary(groupId: string, trackId: string, enabled: boolean) {
  return useQuery({
    queryKey: trackSummaryKey(groupId, trackId),
    enabled,
    // 30s matches the design plan's stale window for the track home —
    // counter shifts inside the window are tolerable for the small group
    // sizes M4 targets, and a tighter window would amplify D1 reads.
    staleTime: 30_000,
    queryFn: async (): Promise<TrackSummaryCounts> => {
      const res = await api.g[":groupId"].t[":trackId"].summary.$get({
        param: { groupId, trackId },
      });
      await assertOk(res);
      return (await res.json()) as TrackSummaryCounts;
    },
  });
}

export function useCreateTrack(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly name: string;
      readonly description?: string;
    }): Promise<LearningTrack> => {
      const res = await api.g[":groupId"].tracks.$post({ param: { groupId }, json: input });
      await assertOk(res);
      return (await res.json()) as LearningTrack;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tracksByGroupKey(groupId) });
      qc.invalidateQueries({ queryKey: ["groups", "detail", groupId] });
    },
  });
}

export function useUpdateTrackMetadata(groupId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly name?: string;
      readonly description?: string | null;
    }): Promise<LearningTrack> => {
      const res = await api.tracks[":trackId"].$patch({ param: { trackId }, json: input });
      await assertOk(res);
      return (await res.json()) as LearningTrack;
    },
    onSuccess: () => invalidateTrack(qc, groupId, trackId),
  });
}

export function useUpdateTrackStatus(groupId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: "pause" | "resume" | "archive"): Promise<LearningTrack> => {
      const res = await api.tracks[":trackId"].status.$post({
        param: { trackId },
        json: { action },
      });
      await assertOk(res);
      return (await res.json()) as LearningTrack;
    },
    onSuccess: () => invalidateTrack(qc, groupId, trackId),
  });
}

export function useUpdateTrackContributionPolicy(groupId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (envelope: ContributionPolicyEnvelope): Promise<LearningTrack> => {
      const res = await api.tracks[":trackId"]["contribution-policy"].$put({
        param: { trackId },
        json: envelope,
      });
      await assertOk(res);
      return (await res.json()) as LearningTrack;
    },
    onSuccess: () => invalidateTrack(qc, groupId, trackId),
  });
}

// ── Enrollment ─────────────────────────────────────────────────────────

export type TrackEnrolleeCapabilities = {
  readonly canRemove: boolean;
  readonly canPromote: boolean;
  readonly canDemote: boolean;
};

export type TrackEnrolleeRow = {
  readonly enrollment: TrackEnrollment;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly capabilities: TrackEnrolleeCapabilities;
};

type TrackPeoplePayload = {
  readonly track: LearningTrack;
  readonly facilitatorCount: number;
  readonly entries: readonly TrackEnrolleeRow[];
  readonly leftEntries: readonly TrackEnrolleeRow[];
};

export function useTrackPeople(trackId: string, enabled: boolean) {
  return useQuery({
    queryKey: trackPeopleKey(trackId),
    enabled,
    queryFn: async (): Promise<TrackPeoplePayload> => {
      const res = await api.tracks[":trackId"].people.$get({ param: { trackId } });
      await assertOk(res);
      return (await res.json()) as TrackPeoplePayload;
    },
  });
}

export function useEnrollInTrack(groupId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { readonly targetUserId?: string } = {},
    ): Promise<TrackEnrollment> => {
      const res = await api.tracks[":trackId"].enroll.$post({
        param: { trackId },
        json: input,
      });
      await assertOk(res);
      return (await res.json()) as TrackEnrollment;
    },
    onSuccess: () => invalidateTrackEnrollment(qc, groupId, trackId),
  });
}

export function useLeaveTrack(groupId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<TrackEnrollment> => {
      const res = await api.tracks[":trackId"].leave.$post({
        param: { trackId },
      });
      await assertOk(res);
      return (await res.json()) as TrackEnrollment;
    },
    onSuccess: () => invalidateTrackEnrollment(qc, groupId, trackId),
  });
}

export function useRemoveTrackEnrollment(groupId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string): Promise<TrackEnrollment> => {
      const res = await api.tracks[":trackId"].enrollments[":userId"].$delete({
        param: { trackId, userId },
      });
      await assertOk(res);
      return (await res.json()) as TrackEnrollment;
    },
    onSuccess: () => invalidateTrackEnrollment(qc, groupId, trackId),
  });
}

export function useAssignTrackFacilitator(groupId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targetUserId: string): Promise<TrackEnrollment> => {
      const res = await api.tracks[":trackId"].facilitators.$post({
        param: { trackId },
        json: { targetUserId },
      });
      await assertOk(res);
      return (await res.json()) as TrackEnrollment;
    },
    onSuccess: () => invalidateTrackEnrollment(qc, groupId, trackId),
  });
}

export function useRemoveTrackFacilitator(groupId: string, trackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string): Promise<TrackEnrollment> => {
      const res = await api.tracks[":trackId"].facilitators[":userId"].$delete({
        param: { trackId, userId },
      });
      await assertOk(res);
      return (await res.json()) as TrackEnrollment;
    },
    onSuccess: () => invalidateTrackEnrollment(qc, groupId, trackId),
  });
}
