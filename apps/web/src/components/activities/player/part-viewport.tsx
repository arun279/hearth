import type { ActivityPart, PartProgressState, ResolvedLibraryRef } from "@hearth/domain";
import type { VisibilityPreference } from "@hearth/domain/visibility";
import { Button, Callout } from "@hearth/ui";
import { lazy, type ReactNode, Suspense } from "react";
import { NotYetImplemented } from "./not-yet-implemented.tsx";
import { PartCompleteButton } from "./part-complete-button.tsx";
import { EmbedPart } from "./parts/embed-part.tsx";
import { ListenPart } from "./parts/listen-part.tsx";
import { QuizPart } from "./parts/quiz-part.tsx";
import { ReflectPart } from "./parts/reflect-part.tsx";
import { WatchPart } from "./parts/watch-part.tsx";

/**
 * The participant's own state for the active Part, threaded from the record
 * query so the interactive Parts can autosave / submit, render the per-record
 * Visibility selector, and so every Part kind can offer its honor-system
 * complete control. `lockReason` is the human explanation when `canEdit` is
 * false (window closed, or a hard prerequisite Part still incomplete).
 */
export type PartParticipation = {
  readonly progress: PartProgressState | null;
  readonly recordId: string | null;
  readonly visibility: VisibilityPreference;
  readonly canEdit: boolean;
  readonly lockReason: string | null;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
};

/**
 * The PDF renderer (`<ReadPart>`) is loaded behind `React.lazy` so that
 * `react-pdf` + `pdfjs-dist` (~1 MB of code + a Web Worker bundle) never enter
 * the entry-chunk graph. The bundle-budget gate asserts the lazy boundary
 * stays intact — a non-lazy `import` of react-pdf anywhere upstream breaks it.
 */
const ReadPart = lazy(() => import("./parts/read-part.tsx"));

type Props = {
  readonly activityId: string;
  readonly part: ActivityPart;
  readonly resolvedRef: ResolvedLibraryRef | null;
  readonly participation: PartParticipation;
  readonly onMarkComplete: (state: PartProgressState) => void;
  readonly markCompletePending: boolean;
};

/**
 * Switches on the Part's discriminator to mount the renderer for the active
 * Part. Wrapped in `key={part.id}` at the caller so transitioning between Parts
 * mounts a fresh tree — no stale form state, no carried-over media element.
 *
 * The two interactive kinds depend on the participant's record, so they wait
 * for it: a slim placeholder while it loads, a retry surface on failure (the
 * activity itself already rendered — this is only the per-record overlay).
 * Passive kinds render their body immediately and carry the honor-system
 * complete control beneath it.
 */
export function PartViewport({
  activityId,
  part,
  resolvedRef,
  participation,
  onMarkComplete,
  markCompletePending,
}: Props) {
  switch (part.kind) {
    case "read_library_item":
      return (
        <PassivePart
          participation={participation}
          pending={markCompletePending}
          onToggleComplete={(completed) => onMarkComplete({ kind: "read_library_item", completed })}
        >
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
        </PassivePart>
      );
    case "listen_audio":
      return (
        <PassivePart
          participation={participation}
          pending={markCompletePending}
          onToggleComplete={(completed) => onMarkComplete({ kind: "listen_audio", completed })}
        >
          <ListenPart activityId={activityId} part={part} readUrl={resolvedRef?.readUrl ?? null} />
        </PassivePart>
      );
    case "watch_video":
      return (
        <PassivePart
          participation={participation}
          pending={markCompletePending}
          onToggleComplete={(completed) => onMarkComplete({ kind: "watch_video", completed })}
        >
          <WatchPart activityId={activityId} part={part} readUrl={resolvedRef?.readUrl ?? null} />
        </PassivePart>
      );
    case "embed":
      return (
        <PassivePart
          participation={participation}
          pending={markCompletePending}
          onToggleComplete={(completed) => onMarkComplete({ kind: "embed", completed })}
        >
          <EmbedPart activityId={activityId} part={part} />
        </PassivePart>
      );
    case "write_reflection":
      if (participation.isLoading) return <PartProgressLoading />;
      if (participation.isError) return <PartProgressError onRetry={participation.onRetry} />;
      return (
        <ReflectPart
          activityId={activityId}
          part={part}
          progress={participation.progress}
          recordId={participation.recordId}
          visibility={participation.visibility}
          canEdit={participation.canEdit}
          lockReason={participation.lockReason}
        />
      );
    case "quiz":
      if (participation.isLoading) return <PartProgressLoading />;
      if (participation.isError) return <PartProgressError onRetry={participation.onRetry} />;
      return (
        <QuizPart
          activityId={activityId}
          part={part}
          progress={participation.progress}
          canEdit={participation.canEdit}
          lockReason={participation.lockReason}
        />
      );
    case "attend_session":
      return <NotYetImplemented kind={part.kind} />;
    default:
      // Exhaustiveness assertion via `satisfies never` — adding a new
      // `ActivityPart` variant without a case above becomes a typecheck error.
      part satisfies never;
      return <NotYetImplemented kind={(part as { kind: string }).kind} />;
  }
}

/**
 * Wraps a passive Part's body with its honor-system completion row. Passive
 * Parts hold no editable content, so completion is a `{ kind, completed }` flip
 * the caller builds with the narrowed kind. While the record loads the toggle
 * is disabled; on failure it offers a retry rather than a misleading control.
 */
function PassivePart({
  participation,
  pending,
  onToggleComplete,
  children,
}: {
  readonly participation: PartParticipation;
  readonly pending: boolean;
  readonly onToggleComplete: (completed: boolean) => void;
  readonly children: ReactNode;
}) {
  const completed = participation.progress?.completed ?? false;
  return (
    <div className="space-y-5">
      {children}
      <div className="border-[var(--color-rule)] border-t pt-4">
        {participation.isError ? (
          <ProgressRetry onRetry={participation.onRetry} />
        ) : (
          <PartCompleteButton
            completed={completed}
            disabled={!participation.canEdit}
            pending={pending}
            hint={participation.lockReason ?? undefined}
            onToggle={() => onToggleComplete(!completed)}
          />
        )}
      </div>
    </div>
  );
}

function PartProgressLoading() {
  return (
    <div className="flex h-24 items-center text-[12px] text-[var(--color-ink-2)]">
      Loading your progress…
    </div>
  );
}

function PartProgressError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="max-w-xl">
      <Callout tone="danger" title="Couldn't load your progress">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Your saved work for this part couldn't be reached. Nothing is lost — try again.
          </span>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </Callout>
    </div>
  );
}

function ProgressRetry({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-[var(--color-ink-2)]">
      <span>Couldn't load completion.</span>
      <button type="button" onClick={onRetry} className="underline underline-offset-2">
        Retry
      </button>
    </div>
  );
}
