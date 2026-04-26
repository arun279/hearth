import type { GroupMembership, GroupRole, StudyGroup } from "@hearth/domain";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

const membersKey = (groupId: string) => ["groups", "members", groupId] as const;

export type GroupMemberCapabilities = {
  readonly canRemove: boolean;
  readonly canPromote: boolean;
  readonly canDemote: boolean;
};

export type GroupMemberRow = {
  readonly membership: GroupMembership;
  /** Pre-resolved label — server projects nickname ?? user.name ?? user.email. */
  readonly displayName: string;
  readonly capabilities: GroupMemberCapabilities;
};

type GroupMembersResult = {
  readonly group: StudyGroup;
  readonly entries: readonly GroupMemberRow[];
  readonly adminCount: number;
};

function invalidateMembers(qc: QueryClient, groupId: string) {
  qc.invalidateQueries({ queryKey: membersKey(groupId) });
  qc.invalidateQueries({ queryKey: ["groups", "detail", groupId] });
  qc.invalidateQueries({ queryKey: ["me", "context"] });
}

export function useGroupMembers(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: membersKey(groupId),
    enabled,
    queryFn: async (): Promise<GroupMembersResult> => {
      const res = await api.g[":groupId"].members.$get({ param: { groupId } });
      await assertOk(res);
      return (await res.json()) as GroupMembersResult;
    },
  });
}

export function useRemoveGroupMember(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string): Promise<void> => {
      const res = await api.g[":groupId"].members[":userId"].$delete({
        param: { groupId, userId },
      });
      await assertOk(res);
    },
    onSuccess: () => invalidateMembers(qc, groupId),
  });
}

export function useSetGroupAdmin(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; role: GroupRole }): Promise<GroupMembership> => {
      const res = await api.g[":groupId"].members[":userId"].role.$patch({
        param: { groupId, userId: input.userId },
        json: { role: input.role },
      });
      await assertOk(res);
      return (await res.json()) as GroupMembership;
    },
    onSuccess: () => invalidateMembers(qc, groupId),
  });
}

export function useLeaveGroup(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { attribution?: "preserve_name" | "anonymize" }): Promise<void> => {
      const res = await api.g[":groupId"].leave.$post({
        param: { groupId },
        json: input.attribution !== undefined ? { attribution: input.attribution } : {},
      });
      await assertOk(res);
    },
    onSuccess: () => {
      // Leaving the group also drops it from /me/context.memberships and the
      // sidebar list, so invalidate everything that refers to it.
      qc.invalidateQueries({ queryKey: ["me", "context"] });
      qc.invalidateQueries({ queryKey: ["groups", "list"] });
      qc.invalidateQueries({ queryKey: ["groups", "detail", groupId] });
      qc.invalidateQueries({ queryKey: membersKey(groupId) });
    },
  });
}
