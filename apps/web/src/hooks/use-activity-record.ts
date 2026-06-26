import type {
  ActivityRecordFullView,
  ActivityRecordId,
  CompletionState,
  MyActivityRecordView,
  PartHistory,
  QuizAnswer,
  QuizVerdict,
  UserId,
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
 * completion rollup, and each Part's working state. Read-only; the record
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

type SetPartCompletedResponse = {
  readonly partId: string;
  readonly completed: boolean;
  /** Present iff this flip auto-completed the activity (the
   * `all_parts_complete` rule fired on the last Part), so the SPA flips the
   * completed chrome without a follow-up GET. */
  readonly record?: { readonly completionState: CompletionState };
};

export function useSetPartCompleted(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly partId: string;
      readonly completed: boolean;
    }): Promise<SetPartCompletedResponse> => {
      const res = await api.activities[":activityId"]["my-record"].parts[":partId"].completion.$put(
        {
          param: { activityId, partId: input.partId },
          json: { completed: input.completed },
        },
      );
      await assertOk(res);
      return (await res.json()) as SetPartCompletedResponse;
    },
    // Seed the record cache with the activity-level rollup the server already
    // returned on an inline auto-complete so the completed chrome flips
    // immediately, then invalidate so the per-Part completion chips refetch.
    onSuccess: (result) => {
      if (result.record) {
        const completionState = result.record.completionState;
        qc.setQueryData<MyActivityRecordView>(recordKey(activityId), (prev) =>
          prev ? { ...prev, completionState } : prev,
        );
      }
      invalidateRecord(qc, activityId);
    },
  });
}

/**
 * Mark the actor's own activity record complete. Under `manual_mark` (the v1
 * default Completion Rule) this is the only path that closes the record — the
 * SPA gates the calling CTA on that rule. Under `all_parts_complete` the server
 * auto-completes on the last Part, so no UI invokes this there. Invalidates the
 * record query on success so the header badge + CTA reflect `completed`; the
 * same invalidate-on-success shape as the sibling mutations (a background
 * refetch can't clobber the activity-level rollup the editor never holds).
 */
export function useMarkActivityComplete(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ readonly completionState: CompletionState }> => {
      const res = await api.activities[":activityId"]["my-record"].complete.$post({
        param: { activityId },
      });
      await assertOk(res);
      return (await res.json()) as { readonly completionState: CompletionState };
    },
    onSuccess: () => invalidateRecord(qc, activityId),
  });
}

/**
 * The owner's Part History for one Part — what `<PartHistoryDrawer>` reads when
 * a per-Part history chip is clicked. Owner-addressed (activity id + `my-record`,
 * never the record id), so it stays consistent with the lean own-record path
 * that deliberately hides the record id. A READ — never writes — so it's safe
 * under the killswitch's read-only mode. Returns `[]` for an owner with no
 * record yet; the route 404s a non-audience viewer (handled by the drawer's
 * status-split error branch). Lazily enabled so it fetches only when the drawer
 * opens, not for every Part with history.
 */
export function useMyPartHistory(activityId: string, partId: string, enabled = true) {
  return useQuery<readonly PartHistory[]>({
    queryKey: ["activity-part-history", activityId, partId] as const,
    enabled: enabled && activityId.length > 0 && partId.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await api.activities[":activityId"]["my-record"].history.$get({
        param: { activityId },
        query: { partId },
      });
      await assertOk(res);
      return (await res.json()) as readonly PartHistory[];
    },
  });
}

const participantsKey = (activityId: string) => ["activity-participants", activityId] as const;

/**
 * One facilitator-roster row as the SPA consumes it. Mirrors the core
 * `ActivityParticipantRecordRow` wire shape; declared here against
 * `@hearth/domain` primitives because `apps/web` cannot import `@hearth/core`,
 * and the `hc` client degrades this route's inferred body to `string` (the
 * mixed JSON/text response union), matching the cast-the-response pattern the
 * other record hooks use.
 */
export type ActivityParticipantRow = {
  readonly recordId: ActivityRecordId;
  readonly participantId: UserId;
  readonly displayName: string;
  readonly completionState: CompletionState;
  readonly completedAt: string | null;
  readonly partHistoryCount: number;
};

type ParticipantsResponse = { readonly entries: readonly ActivityParticipantRow[] };

/**
 * The facilitator roster for an activity: every participant with a record, their
 * display name, completion state, and prior-attempt count. Track-Facilitator /
 * Group-Admin only — the route 404s a non-viewer of the parent group and 403s an
 * authorized non-facilitator, so the reset surface is only ever populated for
 * someone who could act on a row. Lazily enabled so it fetches only when the
 * facilitator opens the roster, not on every Player mount.
 */
export function useActivityParticipants(activityId: string, enabled = true) {
  return useQuery<ParticipantsResponse>({
    queryKey: participantsKey(activityId),
    enabled: enabled && activityId.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.activities[":activityId"].participants.$get({ param: { activityId } });
      await assertOk(res);
      return (await res.json()) as ParticipantsResponse;
    },
  });
}

type ResetResponse = ActivityRecordFullView;

/**
 * Facilitator reset of a participant's progress. The participant's work is
 * preserved as Part History (the destructive-confirm copy says so); the prior
 * attempt count climbs. Addressed by activity + participant, never the record id.
 * On success the roster cache is patched in place from the returned full view —
 * the reset participant's `partHistoryCount` advances and `completionState`
 * resets — so the facilitator's surface updates without a refetch.
 *
 * The reset clears the participant's per-Part progress and appends prior
 * attempts, so any open Player for this activity (the facilitator's own session
 * — reset is participant-scoped server-side, but the only Player a facilitator
 * has open is their own) would otherwise show stale progress, stale per-Part
 * history, and a stale prior-attempts chip until a manual reload. Invalidate
 * every record-derived cache for the activity so those surfaces refetch the
 * cleared state. An invalidate (not a write-through) because the reset touches
 * multiple Part rows and the Player refetch is cheap and already gated by
 * `staleTime`; for a facilitator not viewing the reset participant the refetch
 * is a harmless no-op.
 */
export function useResetParticipant(activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (participantId: string): Promise<ResetResponse> => {
      const res = await api.activities[":activityId"].participants[":participantId"].reset.$post({
        param: { activityId, participantId },
      });
      await assertOk(res);
      return (await res.json()) as ResetResponse;
    },
    onSuccess: (full) => {
      qc.setQueryData<ParticipantsResponse>(participantsKey(activityId), (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          entries: prev.entries.map((row) =>
            row.participantId === full.participantId
              ? {
                  ...row,
                  completionState: full.completionState,
                  // `completedAt` is a `Date` in the type but a JSON string over
                  // the wire; the roster row holds the string form.
                  completedAt: full.completedAt === null ? null : String(full.completedAt),
                  partHistoryCount: full.partHistoryCount,
                }
              : row,
          ),
        };
      });
      qc.invalidateQueries({ queryKey: recordKey(activityId) });
      qc.invalidateQueries({ queryKey: ["activity-part-history", activityId] });
      qc.invalidateQueries({ queryKey: ["activity-quiz-verdict", activityId] });
    },
  });
}
