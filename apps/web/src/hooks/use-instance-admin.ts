import type {
  ApprovedEmail,
  InstanceOperator,
  InstanceOperatorWithIdentity,
  InstanceSettings,
} from "@hearth/domain";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

const settingsKey = ["instance", "settings"] as const;
const approvedEmailsKey = ["instance", "approved-emails"] as const;
const operatorsKey = ["instance", "operators"] as const;

function invalidateAll(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["me", "context"] });
  qc.invalidateQueries({ queryKey: ["instance"] });
}

type ApprovedEmailsList = {
  readonly entries: readonly ApprovedEmail[];
};

type OperatorsPage = {
  readonly entries: readonly InstanceOperatorWithIdentity[];
};

export function useInstanceSettings(enabled: boolean) {
  return useQuery({
    queryKey: settingsKey,
    enabled,
    queryFn: async (): Promise<InstanceSettings> => {
      const res = await api.instance.settings.$get();
      await assertOk(res);
      return (await res.json()) as InstanceSettings;
    },
  });
}

// TODO(approved-emails-pagination): the server returns `nextCursor` on
// this list, but at v1 instance scale (~dozens of approved emails) the
// SPA renders the first page in full. If an instance ever grows past
// the API's default page size, swap this hook for useInfiniteQuery and
// surface a "Load more" affordance — the cursor plumbing is already
// wired server-side.
export function useApprovedEmails(enabled: boolean) {
  return useQuery({
    queryKey: approvedEmailsKey,
    enabled,
    queryFn: async (): Promise<ApprovedEmailsList> => {
      const res = await api.instance["approved-emails"].$get({ query: {} });
      await assertOk(res);
      const body = (await res.json()) as { readonly entries: readonly ApprovedEmail[] };
      return { entries: body.entries };
    },
  });
}

export function useOperators(enabled: boolean) {
  return useQuery({
    queryKey: operatorsKey,
    enabled,
    queryFn: async (): Promise<OperatorsPage> => {
      // includeRevoked=true so the UI can render an audit-trail section
      // alongside the current operators. The tab splits on revokedAt.
      const res = await api.instance.operators.$get({ query: { includeRevoked: "true" } });
      await assertOk(res);
      return (await res.json()) as OperatorsPage;
    },
  });
}

export function useRenameInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<InstanceSettings> => {
      const res = await api.instance.settings.$patch({ json: { name } });
      await assertOk(res);
      return (await res.json()) as InstanceSettings;
    },
    onSuccess: () => invalidateAll(qc),
  });
}

export function useAddApprovedEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; note?: string }): Promise<ApprovedEmail> => {
      const res = await api.instance["approved-emails"].$post({ json: input });
      await assertOk(res);
      return (await res.json()) as ApprovedEmail;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: approvedEmailsKey });
    },
  });
}

export function useRemoveApprovedEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (email: string): Promise<void> => {
      const res = await api.instance["approved-emails"][":email"].$delete({ param: { email } });
      await assertOk(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: approvedEmailsKey });
    },
  });
}

export function useAssignOperator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string }): Promise<InstanceOperator> => {
      const res = await api.instance.operators.$post({ json: input });
      await assertOk(res);
      return (await res.json()) as InstanceOperator;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: operatorsKey });
    },
  });
}

export function useRevokeOperator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string): Promise<void> => {
      const res = await api.instance.operators[":userId"].$delete({ param: { userId } });
      await assertOk(res);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: operatorsKey });
    },
  });
}
