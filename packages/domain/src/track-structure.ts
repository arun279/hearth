import type { LearningActivityId } from "./ids.ts";

/**
 * How a Learning Track presents its activities to enrollees.
 *
 * `free` — activities are an unordered pool; participants pick what to do.
 * `ordered_sections` — activities are grouped into named sections rendered in
 * a fixed order. Section order is the array order; activities within a
 * section render in the array order. The `activityIds` arrays must be a
 * subset of the activities the track owns; the use case checks this when M8
 * lands. In M4 there are no activities yet, so the subset is trivially
 * satisfied.
 */
export type TrackStructure =
  | { readonly mode: "free" }
  | {
      readonly mode: "ordered_sections";
      readonly sections: readonly TrackStructureSection[];
    };

export type TrackStructureSection = {
  readonly id: string;
  readonly title: string;
  readonly activityIds: readonly LearningActivityId[];
};

/**
 * Versioned envelope per the relational-schema convention. New fields are
 * additive inside `data`; structural breaks bump `v` and the read-time shim
 * adds the missing path.
 */
export type TrackStructureEnvelope = {
  readonly v: 1;
  readonly data: TrackStructure;
};

/** Default a freshly-created track to `free` mode with no sections. */
export const EMPTY_TRACK_STRUCTURE: TrackStructureEnvelope = {
  v: 1,
  data: { mode: "free" },
};
