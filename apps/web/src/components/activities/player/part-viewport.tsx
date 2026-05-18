import type { ActivityPart, ResolvedLibraryRef } from "@hearth/domain";
import { lazy, Suspense } from "react";
import { NotYetImplemented } from "./not-yet-implemented.tsx";
import { EmbedPart } from "./parts/embed-part.tsx";
import { ListenPart } from "./parts/listen-part.tsx";
import { WatchPart } from "./parts/watch-part.tsx";

/**
 * The PDF renderer (`<ReadPart>`) is loaded behind `React.lazy` so that
 * `react-pdf` + `pdfjs-dist` (~1 MB of code + a Web Worker bundle)
 * never enter the entry-chunk graph. The bundle-budget gate asserts
 * the lazy boundary stays intact — a non-lazy `import` of react-pdf
 * anywhere upstream would break that invariant.
 */
const ReadPart = lazy(() => import("./parts/read-part.tsx"));

type Props = {
  readonly activityId: string;
  readonly part: ActivityPart;
  readonly resolvedRef: ResolvedLibraryRef | null;
};

/**
 * Switches on the Part's discriminator to mount the renderer for the
 * active Part. Wrapped in `key={part.id}` at the caller level so
 * transitioning between Parts mounts a fresh component tree — no
 * stale form state, no carried-over media element, no leaked
 * `timeupdate` listeners pointing at the previous Part.
 *
 * `ReadPart` is lazy-loaded; everything else is statically imported.
 * The Suspense fallback is intentionally tiny — most PDFs load in
 * under a second, and a chunky placeholder competes with the surface
 * a participant is about to read.
 */
export function PartViewport({ activityId, part, resolvedRef }: Props) {
  switch (part.kind) {
    case "read_library_item":
      return (
        <Suspense
          fallback={
            <div className="flex h-32 items-center text-[12px] text-[var(--color-ink-2)]">
              Loading reader…
            </div>
          }
        >
          <ReadPart
            activityId={activityId}
            part={part}
            readUrl={resolvedRef?.readUrl ?? null}
            mimeType={resolvedRef?.mimeType ?? null}
          />
        </Suspense>
      );
    case "listen_audio":
      return (
        <ListenPart activityId={activityId} part={part} readUrl={resolvedRef?.readUrl ?? null} />
      );
    case "watch_video":
      return (
        <WatchPart activityId={activityId} part={part} readUrl={resolvedRef?.readUrl ?? null} />
      );
    case "embed":
      return <EmbedPart activityId={activityId} part={part} />;
    case "write_reflection":
    case "quiz":
    case "attend_session":
      return <NotYetImplemented kind={part.kind} />;
    default: {
      const exhaustive: never = part;
      void exhaustive;
      return <NotYetImplemented kind={(part as { kind: string }).kind} />;
    }
  }
}
