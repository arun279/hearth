import type {
  ActivityPartId,
  ActivityRecordId,
  LearningActivityId,
  LibraryRevisionId,
  UserId,
} from "../ids.ts";
import type { QuizAnswerResponseInput, QuizAnswerResult } from "../parts/quiz-answer.ts";
import type { VisibilityPreference } from "../visibility/preference.ts";

export type CompletionState = "in_progress" | "completed";

/**
 * The rolled-up state of one participant's work on one Learning Activity.
 * Exactly one row per (activity, participant) — resume and completion are
 * tracked here; the per-Part detail lives in `PartProgress`.
 *
 * `visibilityOverride` is the per-record exception to the participant's
 * default Visibility Preference. `null` means "use my default"; the
 * resolution from override + default into a concrete scope is a later
 * milestone's read-time projection and is deliberately absent here.
 */
export type ActivityRecord = {
  readonly id: ActivityRecordId;
  readonly activityId: LearningActivityId;
  readonly participantId: UserId;
  readonly completionState: CompletionState;
  readonly completedAt: Date | null;
  readonly visibilityOverride: VisibilityPreference | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/**
 * The participant's submitted response to one quiz question, paired with
 * the server-computed grade. The grade is stored — not recomputed on the
 * client — because the answer key never ships to participants (see
 * `stripQuizAnswerKeys`); resume re-renders feedback from this row alone.
 *
 * `correctIndex` and `explanation` are post-answer reveals: populated by
 * server grading for a question the participant has already answered, so
 * the client can highlight the right multiple-choice option and show the
 * explanation without ever holding the key before submission.
 */
export type QuizAnswer = {
  readonly questionId: string;
  readonly response: QuizAnswerResponseInput;
  readonly result: QuizAnswerResult;
  readonly correctIndex?: number;
  readonly explanation?: string;
};

/**
 * The authoritative per-Part state inside an Activity Record, discriminated
 * by the Part's kind. It carries only durable state: the honor-system
 * `completed` flag (every kind) plus authored content (reflection `text`,
 * quiz `answers`). Resume cursors — scroll position, playback position —
 * are assistive Evidence Signals in their own table, never part progress.
 */
export type PartProgressState =
  | { readonly kind: "read_library_item"; readonly completed: boolean }
  | { readonly kind: "listen_audio"; readonly completed: boolean }
  | { readonly kind: "watch_video"; readonly completed: boolean }
  | { readonly kind: "write_reflection"; readonly completed: boolean; readonly text: string }
  | { readonly kind: "quiz"; readonly completed: boolean; readonly answers: readonly QuizAnswer[] }
  | { readonly kind: "attend_session"; readonly completed: boolean }
  | { readonly kind: "embed"; readonly completed: boolean };

export type PartProgressKind = PartProgressState["kind"];

export type PartProgress = {
  readonly id: string;
  readonly activityRecordId: ActivityRecordId;
  readonly partId: ActivityPartId;
  readonly state: PartProgressState;
  readonly updatedAt: Date;
};

/**
 * Why a participant's prior Part work was preserved into history:
 *   - `retry`            — the participant re-did the Part, superseding earlier work.
 *   - `revision_bump`    — a newer Library Revision reopened an unpinned Part.
 *   - `facilitator_reset`— a Track Facilitator reset the participant's progress.
 */
export type PartHistoryReason = "retry" | "revision_bump" | "facilitator_reset";

export type PartHistory = {
  readonly id: string;
  readonly activityRecordId: ActivityRecordId;
  readonly partId: ActivityPartId;
  readonly snapshot: PartProgressState;
  readonly reason: PartHistoryReason;
  readonly revisionIdAtTime: LibraryRevisionId | null;
  readonly recordedAt: Date;
};
