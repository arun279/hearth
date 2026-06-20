import {
  type ActivityPartId,
  countWords,
  type LearningActivityId,
  type UserId,
} from "@hearth/domain";
import type { ActivityRecordRepository } from "@hearth/ports";
import {
  type LoadWritableOwnPartDeps,
  loadWritableOwnPart,
} from "./_lib/load-own-record-context.ts";

export type SaveReflectionDraftInput = {
  readonly actor: UserId;
  readonly activityId: LearningActivityId;
  readonly partId: string;
  readonly text: string;
};

export type SaveReflectionDraftResult = {
  readonly saved: true;
  readonly wordCount: number;
  /** Whether the draft meets the Part's `minWords` nudge. Advisory only — a
   * below-threshold draft still saves; `minWords` never gates the write. */
  readonly meetsMinWords: boolean;
};

export type SaveReflectionDraftDeps = LoadWritableOwnPartDeps & {
  readonly records: ActivityRecordRepository;
};

/**
 * Debounced autosave for a reflection Part. Own-record only (the record is
 * upserted for the actor). `minWords` is reported back, never enforced — the
 * existing `completed` flag is preserved so a later Mark-Complete is not
 * undone by an autosave.
 */
export async function saveReflectionDraft(
  input: SaveReflectionDraftInput,
  deps: SaveReflectionDraftDeps,
): Promise<SaveReflectionDraftResult> {
  const part = await loadWritableOwnPart(
    { actor: input.actor, activityId: input.activityId, partId: input.partId },
    "write_reflection",
    deps,
  );

  const record = await deps.records.upsert({
    activityId: input.activityId,
    participantId: input.actor,
  });
  const existing = await deps.records.getPartProgress({
    activityRecordId: record.id,
    partId: part.id as ActivityPartId,
  });
  const completed = existing?.state.kind === "write_reflection" ? existing.state.completed : false;
  await deps.records.savePartProgress({
    activityRecordId: record.id,
    partId: part.id as ActivityPartId,
    state: { kind: "write_reflection", completed, text: input.text },
  });

  const wordCount = countWords(input.text);
  const meetsMinWords = part.minWords === undefined || wordCount >= part.minWords;

  await deps.records.flushEvidenceSignals([
    {
      activityId: input.activityId,
      participantId: input.actor,
      partId: part.id as ActivityPartId,
      signalType: "word_count",
      value: wordCount,
    },
    {
      activityId: input.activityId,
      participantId: input.actor,
      partId: part.id as ActivityPartId,
      signalType: "draft_saved_at",
      value: deps.clock.now().toISOString(),
    },
  ]);

  return { saved: true, wordCount, meetsMinWords };
}
