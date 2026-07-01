export { affectedPartIdsForRevisionBump, type RevisionMap } from "./affected-parts.ts";
export {
  initialPartProgressState,
  initialPartProgressStateForKind,
  type PartHistoryEnvelope,
  type PartProgressEnvelope,
  type PartProgressState,
  partHistoryEnvelopeSchema,
  partProgressEnvelopeSchema,
  partProgressStateSchema,
} from "./part-progress.ts";
export { projectTrackProgressRow, type TrackProgressRow } from "./progress.ts";
export { type ActivityRecordFullView, projectRecordFull } from "./projection.ts";
export type {
  ActivityRecord,
  CompletionState,
  MyActivityRecordView,
  PartHistory,
  PartHistoryReason,
  PartProgress,
} from "./types.ts";
