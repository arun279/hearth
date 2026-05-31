import type { VisibilityPreference } from "@hearth/domain";

/**
 * Friendly copy for the canonical visibility preferences. The wire values
 * (`default | track_only | private`) stay the source of truth; these are the
 * labels shown in the selector next to a reflection.
 *
 * Wording tracks the normative Visibility Scope resolution: under
 * `track_only` fellow track participants still see the full work (only the
 * wider group is shut out), so the label is "Track only," not "facilitators
 * only." Facilitators always see full work regardless — surfaced as a
 * standing note in the selector rather than per-option.
 */
export const VISIBILITY_LABELS: Record<
  VisibilityPreference,
  { readonly label: string; readonly description: string }
> = {
  default: {
    label: "Track",
    description: "Others in this track see your full work; the wider group sees a brief summary.",
  },
  track_only: {
    label: "Track only",
    description: "Only this track sees your work — the rest of the group can't.",
  },
  private: {
    label: "Just me",
    description: "Hidden from the group; others in your track see only that you took part.",
  },
};

/** Display order for the selector (most open → most private). */
export const VISIBILITY_ORDER: readonly VisibilityPreference[] = [
  "default",
  "track_only",
  "private",
];
