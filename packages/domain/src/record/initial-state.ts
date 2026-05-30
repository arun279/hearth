import type { ActivityPart } from "../parts/index.ts";
import type { PartProgressState } from "./types.ts";

/**
 * The empty starting state for a Part's progress, keyed by kind. Single
 * source of truth for two paths: creating a Part Progress row the first
 * time a participant resumes an activity, and resetting a Part to blank
 * during `reopenAgainstRevision` (revision bump or facilitator reset).
 * Nothing is ever silently lost — the reset path snapshots the prior
 * state into Part History before overwriting with this.
 */
export function initialPartProgressState(part: ActivityPart): PartProgressState {
  switch (part.kind) {
    case "write_reflection":
      return { kind: "write_reflection", completed: false, text: "" };
    case "quiz":
      return { kind: "quiz", completed: false, answers: [] };
    case "read_library_item":
      return { kind: "read_library_item", completed: false };
    case "listen_audio":
      return { kind: "listen_audio", completed: false };
    case "watch_video":
      return { kind: "watch_video", completed: false };
    case "attend_session":
      return { kind: "attend_session", completed: false };
    case "embed":
      return { kind: "embed", completed: false };
  }
}
