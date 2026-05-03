import {
  BookOpen,
  Clapperboard,
  Headphones,
  Link2,
  ListChecks,
  PenLine,
  Users,
} from "lucide-react";

/**
 * Display-layer mapping from the seven Activity Part canonical-kind
 * strings to a Lucide icon + a friendly label. The canonical strings
 * (`read_library_item`, `listen_audio`, etc.) live in `packages/domain`;
 * this module is presentation-only so the labels stay out of the wire
 * format and stored JSON — schema evolution depends on discriminator
 * stability, so a future rename of the friendly label here cannot
 * affect persisted data.
 *
 * The kind parameter is typed as `string` rather than the domain union
 * to keep `@hearth/ui` a leaf package free of domain dependencies. Call
 * sites pass `ActivityPartKind` values, which TypeScript happily widens
 * to `string`. Unknown kinds resolve to a generic icon + the raw kind
 * string — useful for forward-compat with future Part kinds before this
 * registry is extended.
 */
type PartIconLucide = typeof BookOpen;

const ICONS: Record<string, PartIconLucide> = {
  read_library_item: BookOpen,
  listen_audio: Headphones,
  watch_video: Clapperboard,
  write_reflection: PenLine,
  quiz: ListChecks,
  attend_session: Users,
  embed: Link2,
};

const LABELS: Record<string, string> = {
  read_library_item: "Reading",
  listen_audio: "Audio",
  watch_video: "Video",
  write_reflection: "Reflection",
  quiz: "Quiz",
  attend_session: "Session",
  embed: "Embed",
};

export function PartIcon({
  kind,
  size = 12,
  className,
}: {
  readonly kind: string;
  readonly size?: number;
  readonly className?: string;
}) {
  const Icon = ICONS[kind] ?? Link2;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" className={className} />;
}

export function partKindLabel(kind: string): string {
  return LABELS[kind] ?? kind;
}
