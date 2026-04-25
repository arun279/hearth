import type { ApprovedEmail, InstanceOperator, InstanceSettings } from "@hearth/domain";
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

type ApprovedEmailsPage = {
  readonly entries: readonly ApprovedEmail[];
  readonly nextCursor: string | null;
};

type OperatorsPage = {
  readonly entries: readonly InstanceOperator[];
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

export function useApprovedEmails(enabled: boolean) {
  return useQuery({
    queryKey: approvedEmailsKey,
    enabled,
    queryFn: async (): Promise<ApprovedEmailsPage> => {
      const res = await api.instance["approved-emails"].$get({ query: {} });
      await assertOk(res);
      return (await res.json()) as ApprovedEmailsPage;
    },
  });
}

export function useOperators(enabled: boolean) {
  return useQuery({
    queryKey: operatorsKey,
    enabled,
    queryFn: async (): Promise<OperatorsPage> => {
      const res = await api.instance.operators.$get({ query: {} });
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
    mutationFn: async (
      input: { email: string } | { userId: string },
    ): Promise<InstanceOperator> => {
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
