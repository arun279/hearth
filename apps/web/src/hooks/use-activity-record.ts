import type {
  ActivityRecord,
  PartHistory,
  PartProgress,
  PartProgressState,
  QuizAnswerResponseInput,
} from "@hearth/domain";
import type { VisibilityPreference } from "@hearth/domain/visibility";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client.ts";
import { assertOk } from "../lib/problem.ts";

/**
 * One participant's own state for an activity: the rolled-up record plus
 * per-Part progress and the history fan-out the player needs to render
 * completion dots, the word-count meter, quiz feedback, and the "earlier
 * attempts" affordance — all from a single round-trip.
 */
type MyRecordView = {
  readonly record: ActivityRecord;
  readonly partProgress: readonly PartProgress[];
  readonly partsWithHistory: readonly string[];
  readonly partHistoryCount: number;
};

type SavePartResult = { readonly partProgress: PartProgress; readonly record: ActivityRecord };
type QuizResult = { readonly partProgress: PartProgress };

const myRecordKey = (activityId: string) => ["activity-record", activityId] as const;

export function useActivityRecord(activityId: string, enabled = true) {
  return useQuery<MyRecordView>({
    queryKey: myRecordKey(activityId),
    enabled: enabled && activityId.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.activities[":activityId"]["my-record"].$get({ param: { activityId } });
      await assertOk(res);
      return (await res.json()) as MyRecordView;
    },
  });
}

/**
 * Save one Part's progress (reflection autosave, or any Part's completion
 * flag). The mutation patches the cached record so completion dots and the
 * resume state update without a refetch; a background invalidation reconciles
 * the auto-complete cascade the server may have run.
 */
export function useSavePartProgress(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      partId: string;
      state: PartProgressState;
    }): Promise<SavePartResult> => {
      const res = await api.activities[":activityId"]["my-record"].parts[":partId"].$post({
        param: { activityId, partId: vars.partId },
        json: { state: vars.state } as never,
      });
      await assertOk(res);
      return (await res.json()) as SavePartResult;
    },
    onSuccess: (result) => {
      qc.setQueryData<MyRecordView>(myRecordKey(activityId), (prev) =>
        prev ? mergeProgress(prev, result.partProgress, result.record) : prev,
      );
      void qc.invalidateQueries({ queryKey: myRecordKey(activityId) });
    },
  });
}

export function useSubmitQuiz(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      partId: string;
      answers: ReadonlyArray<{ questionId: string; response: QuizAnswerResponseInput }>;
    }): Promise<QuizResult> => {
      const res = await api.activities[":activityId"]["my-record"].parts[":partId"].quiz.$post({
        param: { activityId, partId: vars.partId },
        json: { answers: vars.answers } as never,
      });
      await assertOk(res);
      return (await res.json()) as QuizResult;
    },
    onSuccess: (result) => {
      qc.setQueryData<MyRecordView>(myRecordKey(activityId), (prev) =>
        prev ? mergeProgress(prev, result.partProgress, prev.record) : prev,
      );
    },
  });
}

export function useMarkActivityComplete(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<ActivityRecord> => {
      const res = await api.activities[":activityId"]["my-record"].complete.$post({
        param: { activityId },
      });
      await assertOk(res);
      return (await res.json()) as ActivityRecord;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: myRecordKey(activityId) }),
  });
}

export function useSetRecordVisibility(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      recordId: string;
      override: VisibilityPreference | null;
    }): Promise<ActivityRecord> => {
      const res = await api.records[":recordId"]["visibility-override"].$patch({
        param: { recordId: vars.recordId },
        json: { override: vars.override } as never,
      });
      await assertOk(res);
      return (await res.json()) as ActivityRecord;
    },
    onSuccess: (record) => {
      qc.setQueryData<MyRecordView>(myRecordKey(activityId), (prev) =>
        prev ? { ...prev, record } : prev,
      );
    },
  });
}

export function usePartHistory(recordId: string | null, partId: string, open: boolean) {
  return useQuery<readonly PartHistory[]>({
    queryKey: ["part-history", recordId, partId] as const,
    enabled: open && recordId !== null,
    queryFn: async () => {
      const res = await api.records[":recordId"].history.$get({
        param: { recordId: recordId as string },
        query: { partId },
      });
      await assertOk(res);
      return ((await res.json()) as { history: readonly PartHistory[] }).history;
    },
  });
}

function mergeProgress(
  view: MyRecordView,
  saved: PartProgress,
  record: ActivityRecord,
): MyRecordView {
  const others = view.partProgress.filter((p) => p.partId !== saved.partId);
  return { ...view, record, partProgress: [...others, saved] };
}
