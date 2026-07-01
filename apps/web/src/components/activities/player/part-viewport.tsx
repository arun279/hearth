import type { ActivityPart, PartProgressState, ResolvedLibraryRef } from "@hearth/domain";
import { lazy, Suspense } from "react";
import { NotYetImplemented } from "./not-yet-implemented.tsx";
import { EmbedPart } from "./parts/embed-part.tsx";
import { ListenPart } from "./parts/listen-part.tsx";
import { QuizPart } from "./parts/quiz-part.tsx";
import { ReflectPart } from "./parts/reflect-part.tsx";
import { WatchPart } from "./parts/watch-part.tsx";

/**
 * The PDF renderer (`<ReadPart>`) is loaded behind `React.lazy` so that
 * `react-pdf` + `pdfjs-dist` (~1 MB of code + a Web Worker bundle)
 * never enter the entry-chunk graph. The bundle-budget gate asserts
 * the lazy boundary stays intact — a non-lazy `import` of react-pdf
 * anywhere upstream would break that invariant.
 */
const ReadPart = lazy(() => import("./parts/read-part.tsx"));

/**
 * The participant's own state for the active Part, plus whether they may
 * edit it. `canParticipate` already folds in the window state (a closed
 * activity renders the interactive Parts read-only); `loaded` gates the
 * first render so the interactive components mount with their initial value
 * known rather than flashing empty then hydrating.
 */
type RecordContext = {
  readonly loaded: boolean;
  readonly canParticipate: boolean;
  readonly partState: PartProgressState | null;
};

type Props = {
  readonly activityId: string;
  readonly part: ActivityPart;
  readonly resolvedRef: ResolvedLibraryRef | null;
  readonly record: RecordContext;
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
export function PartViewport({ activityId, part, resolvedRef, record }: Props) {
  switch (part.kind) {
    case "read_library_item":
      return (
        <Suspense
          fallback={
            <div className="flex h-32 items-center text-[0.75rem] text-[var(--color-ink-2)]">
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
      return record.loaded ? (
        <ReflectPart
          activityId={activityId}
          part={part}
          partState={record.partState}
          canParticipate={record.canParticipate}
        />
      ) : (
        <PartLoading />
      );
    case "quiz":
      return record.loaded ? (
        <QuizPart
          activityId={activityId}
          part={part}
          partState={record.partState}
          canParticipate={record.canParticipate}
        />
      ) : (
        <PartLoading />
      );
    case "attend_session":
      return <NotYetImplemented kind={part.kind} />;
    default:
      // Exhaustiveness assertion via `satisfies never` — adding a new
      // `ActivityPart` variant without a case above becomes a typecheck
      // error here. No local binding so no `noUnusedLocals` suppression.
      part satisfies never;
      return <NotYetImplemented kind={(part as { kind: string }).kind} />;
  }
}

function PartLoading() {
  return (
    <div className="flex h-24 items-center text-[0.75rem] text-[var(--color-ink-2)]">
      Loading your work…
    </div>
  );
}
