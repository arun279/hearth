import type { ContributionMode } from "./track.ts";

/**
 * The track's contribution policy. `mode` decides what happens when a
 * non-facilitator tries to publish an activity:
 *
 * - `direct` — published immediately, no review.
 * - `optional_review` — author chooses publish or send to review.
 * - `required_review` — every contribution lands in pending review.
 * - `none` — only facilitators may publish; no participant pathway exists.
 *
 * Wrapped in a versioned envelope so future fields (per-mode quotas,
 * required reviewer roles) can be added additively without a migration.
 */
export type ContributionPolicy = {
  readonly mode: ContributionMode;
};

export type ContributionPolicyEnvelope = {
  readonly v: 1;
  readonly data: ContributionPolicy;
};

/** New tracks default to "direct" — the friction-free option for trusted small groups. */
export const DEFAULT_CONTRIBUTION_POLICY: ContributionPolicyEnvelope = {
  v: 1,
  data: { mode: "direct" },
};

/**
 * Single source of truth for the user-facing copy of each contribution mode.
 * The track-settings dialog and the pending-tab empty state both render from
 * this map so the labels never drift.
 */
export const CONTRIBUTION_MODE_COPY: Record<
  ContributionMode,
  { readonly label: string; readonly hint: string }
> = {
  direct: {
    label: "Direct",
    hint: "Participants publish activities immediately, no review.",
  },
  optional_review: {
    label: "Optional review",
    hint: "Participants choose to publish or send for facilitator review.",
  },
  required_review: {
    label: "Required review",
    hint: "Every participant contribution lands in pending review.",
  },
  none: {
    label: "Facilitators only",
    hint: "Only facilitators may add activities to this track.",
  },
};
