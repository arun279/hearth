import type { ActivityPart } from "@hearth/domain";

/**
 * The player's content-measure tokens. The header, body, and footer all take a
 * value of this type from `partMeasure(activePart)`, so the prop types reference
 * this single source instead of restating the `max-w-*` union and drifting from
 * the function that produces it.
 */
export type PartMeasure = "max-w-2xl" | "max-w-3xl";

/**
 * The player's two-tier content measure, keyed off the Part's kind. Text Parts
 * (reflection, quiz, attend) cap at the app's 672px reading measure so the
 * writing/answering column never runs past a comfortable line length; media
 * Parts (PDF, audio, video, embed) use the wider 768px measure because WCAG
 * 1.4.10 lists media as a two-dimensional-layout reflow exception and a 16:9
 * video or a PDF page is cramped inside 672px.
 *
 * Returns the bare `max-w-*` token so the caller composes its own
 * `mx-auto w-full` wrapper — the player's header/body/footer each own different
 * vertical padding, so they share the measure but not the full PageContainer
 * string. Off-record states (access notices, the record-error surface) read as
 * text and take the narrow tier.
 */
export function partMeasure(part: ActivityPart): PartMeasure {
  switch (part.kind) {
    case "read_library_item":
    case "listen_audio":
    case "watch_video":
    case "embed":
      return "max-w-3xl";
    case "write_reflection":
    case "quiz":
    case "attend_session":
      return "max-w-2xl";
    default:
      part satisfies never;
      return "max-w-2xl";
  }
}
