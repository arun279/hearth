import type { GroupInvitation, GroupInvitationStatus } from "@hearth/domain";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

const invitationsKey = (groupId: string) => ["groups", "invitations", groupId] as const;
const previewKey = (token: string) => ["invitations", "preview", token] as const;

export type GroupInvitationView = {
  readonly invitation: GroupInvitation;
  readonly status: GroupInvitationStatus;
};

type CreateGroupInvitationResponse = {
  readonly invitation: GroupInvitation;
  readonly emailApproved: boolean;
};

type InvitationPreview = {
  readonly instanceName: string;
  readonly groupName: string;
  readonly inviterDisplayName: string | null;
  readonly targetEmail: string | null;
  readonly status: GroupInvitationStatus;
};

function invalidateInvitations(qc: QueryClient, groupId: string) {
  qc.invalidateQueries({ queryKey: invitationsKey(groupId) });
}

export function useGroupInvitations(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: invitationsKey(groupId),
    enabled,
    queryFn: async (): Promise<readonly GroupInvitationView[]> => {
      const res = await api.g[":groupId"].invitations.$get({ param: { groupId } });
      await assertOk(res);
      const body = (await res.json()) as { entries: readonly GroupInvitationView[] };
      return body.entries;
    },
  });
}

export function useCreateGroupInvitation(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      email?: string;
      trackId?: string;
    }): Promise<CreateGroupInvitationResponse> => {
      const res = await api.g[":groupId"].invitations.$post({
        param: { groupId },
        json: input,
      });
      await assertOk(res);
      return (await res.json()) as CreateGroupInvitationResponse;
    },
    onSuccess: () => invalidateInvitations(qc, groupId),
  });
}

export function useRevokeGroupInvitation(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invitationId: string): Promise<void> => {
      const res = await api.g[":groupId"].invitations[":invitationId"].$delete({
        param: { groupId, invitationId },
      });
      await assertOk(res);
    },
    onSuccess: () => invalidateInvitations(qc, groupId),
  });
}

export function useInvitationPreview(token: string | null) {
  return useQuery({
    queryKey: previewKey(token ?? ""),
    enabled: token !== null && token.length > 0,
    // The preview is unauthenticated; it's safe to refetch on focus to
    // pick up state changes (revoked, consumed by another tab) so the
    // landing always shows current copy.
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<InvitationPreview> => {
      // `enabled` above guarantees this never runs with a null/empty
      // token, but TS can't see across React Query's boundary. The
      // explicit narrow keeps the type system honest without resorting
      // to `!`.
      if (token === null || token.length === 0) {
        throw new Error("token required");
      }
      const res = await api.invitations["by-token"][":token"].$get({ param: { token } });
      await assertOk(res);
      return (await res.json()) as InvitationPreview;
    },
  });
}

export function useConsumeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string): Promise<{ membership: unknown }> => {
      const res = await api.invitations.consume.$post({ json: { token } });
      await assertOk(res);
      return (await res.json()) as { membership: unknown };
    },
    onSuccess: () => {
      // Joining a group changes /me/context, the groups list, and
      // potentially the active group's detail.
      qc.invalidateQueries({ queryKey: ["me", "context"] });
      qc.invalidateQueries({ queryKey: ["groups", "list"] });
    },
  });
}
