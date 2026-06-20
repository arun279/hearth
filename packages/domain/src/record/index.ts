export { affectedPartIdsForRevisionBump, type RevisionMap } from "./affected-parts.ts";
export {
  initialPartProgressState,
  type PartProgressEnvelope,
  type PartProgressState,
  partProgressEnvelopeSchema,
  partProgressStateSchema,
} from "./part-progress.ts";
export { type ActivityRecordFullView, projectRecordFull } from "./projection.ts";
export type {
  ActivityRecord,
  CompletionState,
  EvidenceSignal,
  MyActivityRecordView,
  PartHistory,
  PartHistoryReason,
  PartProgress,
} from "./types.ts";
