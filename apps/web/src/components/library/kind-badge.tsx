import type { LibraryDisplayKind } from "@hearth/domain";
import { cn } from "@hearth/ui";

const KIND_LABEL: Record<LibraryDisplayKind, string> = {
  pdf: "PDF",
  audio: "Audio",
  video: "Video",
  image: "Image",
  doc: "Doc",
  other: "File",
};

type Props = {
  readonly kind: LibraryDisplayKind;
  readonly className?: string;
};

/**
 * Small file-kind tile — matches the prototype's calm, file-shaped
 * thumbnail used on the Library list. Static (no MIME-derived emoji or
 * accent color) so the visual language stays restrained per the
 * "calm, text-focused" direction.
 */
export function KindBadge({ kind, className }: Props) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-10 w-9 shrink-0 items-end justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] pb-0.5 font-mono font-semibold text-[9px] text-[var(--color-ink-3)] uppercase tracking-wider",
        className,
      )}
    >
      {KIND_LABEL[kind]}
    </div>
  );
}
