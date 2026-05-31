import type {
  MyActivityRecordView,
  QuizAnswer,
  QuizVerdict,
  VisibilityPreference,
} from "@hearth/domain";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

const recordKey = (activityId: string) => ["activity-record", activityId] as const;

function invalidateRecord(qc: QueryClient, activityId: string) {
  qc.invalidateQueries({ queryKey: recordKey(activityId) });
}

/**
 * The participant's own record for an activity — `canParticipate`, the
 * visibility override, and each Part's working state. Read-only; the record
 * row is created lazily on the first write, so this never mutates and works
 * under the killswitch's read-only mode. The Player fetches it alongside the
 * content projection to hydrate the interactive Parts.
 */
export function useActivityRecord(activityId: string, enabled = true) {
  return useQuery<MyActivityRecordView>({
    queryKey: recordKey(activityId),
    enabled: enabled && activityId.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await api.activities[":activityId"]["my-record"].$get({ param: { activityId } });
      await assertOk(res);
      return (await res.json()) as MyActivityRecordView;
    },
  });
}

type SaveReflectionResult = {
  readonly saved: true;
  readonly wordCount: number;
  readonly meetsMinWords: boolean;
};

export function useSaveReflection(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly partId: string;
      readonly text: string;
    }): Promise<SaveReflectionResult> => {
      const res = await api.activities[":activityId"]["my-record"].parts[":partId"].reflection.$put(
        {
          param: { activityId, partId: input.partId },
          json: { text: input.text },
        },
      );
      await assertOk(res);
      return (await res.json()) as SaveReflectionResult;
    },
    // The mounted editor holds the live text in local state, so a background
    // refetch here can't clobber it; remounting (Part switch + back) reads
    // the freshly-persisted draft.
    onSuccess: () => invalidateRecord(qc, activityId),
  });
}

export type QuizSubmitResult = {
  readonly perQuestion: ReadonlyArray<{
    readonly questionId: string;
    readonly verdict: QuizVerdict;
    readonly correctIndex: number | null;
  }>;
  readonly autoScore: { readonly correct: number; readonly gradeable: number };
};

export function useSubmitQuiz(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly partId: string;
      readonly answers: readonly QuizAnswer[];
    }): Promise<QuizSubmitResult> => {
      const res = await api.activities[":activityId"]["my-record"].parts[":partId"].quiz.$put({
        param: { activityId, partId: input.partId },
        json: { answers: [...input.answers] },
      });
      await assertOk(res);
      return (await res.json()) as QuizSubmitResult;
    },
    onSuccess: () => invalidateRecord(qc, activityId),
  });
}

export function useSetPartCompleted(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly partId: string;
      readonly completed: boolean;
    }): Promise<{ readonly partId: string; readonly completed: boolean }> => {
      const res = await api.activities[":activityId"]["my-record"].parts[":partId"].completion.$put(
        {
          param: { activityId, partId: input.partId },
          json: { completed: input.completed },
        },
      );
      await assertOk(res);
      return (await res.json()) as { readonly partId: string; readonly completed: boolean };
    },
    onSuccess: () => invalidateRecord(qc, activityId),
  });
}

export function useSetRecordVisibility(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      preference: VisibilityPreference | null,
    ): Promise<{ readonly visibilityOverride: VisibilityPreference | null }> => {
      const res = await api.activities[":activityId"]["my-record"]["visibility-override"].$patch({
        param: { activityId },
        json: { preference },
      });
      await assertOk(res);
      return (await res.json()) as { readonly visibilityOverride: VisibilityPreference | null };
    },
    onSuccess: () => invalidateRecord(qc, activityId),
  });
}
