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

/**
 * The concrete scopes a participant can pin as a record-level override. The
 * chooser deliberately omits `default`: selecting it would store the explicit
 * `"default"` value while *clearing* the override (`null`) resolves to the
 * same scope, so two affordances would mean the same end state. `null` is the
 * single "inherit my account default" path, surfaced as a separate clear
 * action rather than a radio.
 */
export const SELECTABLE_VISIBILITY_OVERRIDES = ["track_only", "private"] as const;

/**
 * Trigger label for the record's effective visibility. `null` resolves to the
 * account default, whose scope is `default` ("Track") until per-user defaults
 * exist — so the label names that concrete scope rather than leaving "Your
 * default" an opaque pointer (recognition over recall).
 *
 * TODO(m12): when per-user default-visibility preferences ship, derive the
 * resolved scope from the user's default rather than hardcoding "Track" here.
 * The `no-stale-milestone-todo` gate auto-flags this the moment M12 lands.
 */
export function visibilityTriggerLabel(value: VisibilityPreference | null): string {
  return value !== null
    ? VISIBILITY_LABELS[value].label
    : `Your default (${VISIBILITY_LABELS.default.label})`;
}
