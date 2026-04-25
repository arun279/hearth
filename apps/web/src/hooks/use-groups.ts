import type { GroupMembership, StudyGroup } from "@hearth/domain";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

const groupsListKey = ["groups", "list"] as const;
const groupKey = (id: string) => ["groups", "detail", id] as const;

export type GroupCaps = {
  readonly canArchive: boolean;
  readonly canUnarchive: boolean;
  readonly canUpdateMetadata: boolean;
};

type GroupCounts = {
  readonly memberCount: number;
  readonly trackCount: number;
  readonly libraryItemCount: number;
};

export type GroupDetail = {
  readonly group: StudyGroup;
  readonly myMembership: GroupMembership | null;
  readonly counts: GroupCounts;
  readonly caps: GroupCaps;
};

function invalidateGroup(qc: QueryClient, groupId: string) {
  qc.invalidateQueries({ queryKey: ["me", "context"] });
  qc.invalidateQueries({ queryKey: groupsListKey });
  qc.invalidateQueries({ queryKey: groupKey(groupId) });
}

export function useMyGroups(enabled: boolean) {
  return useQuery({
    queryKey: groupsListKey,
    enabled,
    queryFn: async (): Promise<readonly StudyGroup[]> => {
      const res = await api.g.$get();
      await assertOk(res);
      const body = (await res.json()) as { entries: readonly StudyGroup[] };
      return body.entries;
    },
  });
}

export function useGroup(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: groupKey(groupId),
    enabled,
    queryFn: async (): Promise<GroupDetail> => {
      const res = await api.g[":groupId"].$get({ param: { groupId } });
      await assertOk(res);
      return (await res.json()) as GroupDetail;
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly name: string;
      readonly description?: string;
    }): Promise<StudyGroup> => {
      const res = await api.g.$post({ json: input });
      await assertOk(res);
      return (await res.json()) as StudyGroup;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "context"] });
      qc.invalidateQueries({ queryKey: groupsListKey });
    },
  });
}

export function useUpdateGroupMetadata(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly name?: string;
      readonly description?: string | null;
    }): Promise<StudyGroup> => {
      const res = await api.g[":groupId"].$patch({ param: { groupId }, json: input });
      await assertOk(res);
      return (await res.json()) as StudyGroup;
    },
    onSuccess: () => invalidateGroup(qc, groupId),
  });
}

export function useArchiveGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const res = await api.g[":groupId"].archive.$post({ param: { groupId } });
      await assertOk(res);
    },
    onSuccess: () => invalidateGroup(qc, groupId),
  });
}

export function useUnarchiveGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const res = await api.g[":groupId"].unarchive.$post({ param: { groupId } });
      await assertOk(res);
    },
    onSuccess: () => invalidateGroup(qc, groupId),
  });
}
