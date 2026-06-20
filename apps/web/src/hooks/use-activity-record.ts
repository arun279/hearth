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

export function useSaveReflection(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly partId: string;
      readonly text: string;
    }): Promise<void> => {
      const res = await api.activities[":activityId"]["my-record"].parts[":partId"].reflection.$put(
        {
          param: { activityId, partId: input.partId },
          json: { text: input.text },
        },
      );
      await assertOk(res);
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

/**
 * Mount-time quiz verdict rehydration. The per-question verdict + score are
 * derived server-side from the participant's persisted answers, so a refreshed
 * Player can show the grade again without re-submitting. A READ — the endpoint
 * never writes (re-grading on every mount must not consume a D1 write, the
 * ≤ 50-write/user/day budget behind the $0 guarantee), so this stays safe under
 * the killswitch's read-only mode. Resolves to `null` when no answers are
 * stored yet, in which case the quiz renders its ungraded prompt.
 */
export function useQuizVerdict(activityId: string, partId: string, enabled = true) {
  return useQuery<QuizSubmitResult | null>({
    queryKey: ["activity-quiz-verdict", activityId, partId] as const,
    enabled: enabled && activityId.length > 0 && partId.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await api.activities[":activityId"]["my-record"].parts[":partId"].quiz.$get({
        param: { activityId, partId },
      });
      await assertOk(res);
      return (await res.json()) as QuizSubmitResult | null;
    },
  });
}

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
    // Seed the verdict cache from the fresh grade so a Part switch + back reads
    // the just-submitted result without a re-grade round-trip, then invalidate
    // the record so the completion chips reflect any persisted answer change.
    onSuccess: (result, variables) => {
      qc.setQueryData<QuizSubmitResult | null>(
        ["activity-quiz-verdict", activityId, variables.partId],
        result,
      );
      invalidateRecord(qc, activityId);
    },
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
