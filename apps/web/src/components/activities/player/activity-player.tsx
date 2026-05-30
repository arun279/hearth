import {
  type ActivityPart,
  type ActivityPlayerProjection,
  arePartPrerequisitesMet,
  type PartProgress,
  type PartProgressState,
} from "@hearth/domain";
import { Button, Callout } from "@hearth/ui";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useActivityRecord, useSavePartProgress } from "../../../hooks/use-activity-record.ts";
import { formatRelative, formatShortDate } from "../../../lib/format.ts";
import { asUserMessage, errorStatus } from "../../../lib/problem.ts";
import { ActivityHeader } from "./activity-header.tsx";
import { FlowSidebar } from "./flow-sidebar.tsx";
import { PartFooter } from "./part-footer.tsx";
import { PartTabBar } from "./part-tab-bar.tsx";
import { type PartParticipation, PartViewport } from "./part-viewport.tsx";

const EMPTY_PROGRESS: readonly PartProgress[] = [];

type QueryShape = {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error?: unknown;
  readonly data?: ActivityPlayerProjection;
  readonly refetch: () => unknown;
};

type Props = {
  readonly query: QueryShape;
  readonly requestedPartId: string | null;
  readonly onChangeActivePartId: (partId: string | null) => void;
};

const FALLBACK_TOAST_KEY = "activity-player-bad-part";

/**
 * Top-level composition for the Activity Player route. Reads the
 * projection from React Query, picks the active Part from the
 * `?part=<id>` search param (falling back to the canonical first
 * Part), and renders sidebar / tab bar / viewport / footer.
 *
 * Active-Part state lives in the URL — the caller passes
 * `requestedPartId` and an `onChangeActivePartId` setter that writes
 * the search param. The component never holds local state for the
 * active Part; refresh and deep-links preserve position deterministically.
 *
 * A `?part=` value that doesn't match any Part id falls back to the
 * first Part with a one-line toast so the user understands their URL
 * was stale — silently rewriting would hide the drift.
 */
export function ActivityPlayer({ query, requestedPartId, onChangeActivePartId }: Props) {
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  return (
    <PlayerBody
      projection={query.data}
      requestedPartId={requestedPartId}
      onChangeActivePartId={onChangeActivePartId}
    />
  );
}

function PlayerBody({
  projection,
  requestedPartId,
  onChangeActivePartId,
}: {
  readonly projection: ActivityPlayerProjection;
  readonly requestedPartId: string | null;
  readonly onChangeActivePartId: (partId: string | null) => void;
}) {
  const { activity, resolvedRefs, accessState } = projection;
  const orderedPartIds = useMemo(
    () => orderPartIds(activity.parts, activity.flow.displayOrder),
    [activity.parts, activity.flow.displayOrder],
  );
  const partById = useMemo(() => new Map(activity.parts.map((p) => [p.id, p])), [activity.parts]);
  const refByPartId = useMemo(
    () => new Map(resolvedRefs.map((r) => [r.partId, r])),
    [resolvedRefs],
  );

  // The participant's own record: opening the activity starts-or-resumes it, so
  // every viewer who can see the activity has one. Skipped pre-open (nothing to
  // interact with yet). A failure here degrades the interactive Parts to a retry
  // surface while the passive Parts and chrome still render.
  const recordQuery = useActivityRecord(activity.id, accessState !== "pre_open");
  const partProgress = recordQuery.data?.partProgress ?? EMPTY_PROGRESS;
  const record = recordQuery.data?.record ?? null;
  const completedPartIds = useMemo(
    () => new Set<string>(partProgress.filter((p) => p.state.completed).map((p) => p.partId)),
    [partProgress],
  );
  const progressByPart = useMemo(
    () => new Map<string, PartProgressState>(partProgress.map((p) => [p.partId, p.state])),
    [partProgress],
  );
  const lockedPartIds = useMemo(
    () =>
      new Set(
        orderedPartIds.filter(
          (id) => !arePartPrerequisitesMet(activity.flow, id, completedPartIds),
        ),
      ),
    [orderedPartIds, activity.flow, completedPartIds],
  );
  const saveCompletion = useSavePartProgress(activity.id);

  const requestedExists = requestedPartId !== null && orderedPartIds.includes(requestedPartId);
  const activePartId = requestedExists ? (requestedPartId as string) : (orderedPartIds[0] ?? "");

  // If the URL named a Part id that doesn't exist on this activity,
  // surface a tiny toast and snap to the canonical first Part. The
  // toast is keyed so successive bad pings don't pile up.
  useEffect(() => {
    if (requestedPartId !== null && !requestedExists && activePartId !== "") {
      toast.message("Couldn't find that part — showing the first one instead.", {
        id: FALLBACK_TOAST_KEY,
      });
      onChangeActivePartId(activePartId);
    }
  }, [requestedExists, requestedPartId, activePartId, onChangeActivePartId]);

  const activePart = partById.get(activePartId);
  const activeIndex = orderedPartIds.indexOf(activePartId);

  // Window-gated states: render the chrome but replace the body with
  // an honest banner so the participant understands why they can't
  // interact yet / anymore. The banner names the actual `opensAt` /
  // `closesAt` instant in both absolute + relative form so the user
  // can plan — a generic "not open yet" leaves them guessing.
  if (accessState === "pre_open") {
    const opensAt = activity.window?.opensAt ?? null;
    const body =
      opensAt !== null
        ? `Opens ${formatRelative(new Date(opensAt))} · ${formatShortDate(new Date(opensAt))}.`
        : "Once the open instant arrives, the player surface will light up automatically.";
    return (
      <FullViewport>
        <ActivityHeader
          activity={activity}
          accessState={accessState}
          currentPartIndex={0}
          totalParts={orderedPartIds.length}
        />
        <div className="px-4 py-5 md:px-8 md:py-7">
          <AccessStateNotice tone="neutral" title="This activity isn't open yet" body={body} />
        </div>
      </FullViewport>
    );
  }

  const closesAt = activity.window?.closesAt ?? null;
  const lockedBody =
    accessState === "locked" && closesAt !== null
      ? `Closed ${formatRelative(new Date(closesAt))} · ${formatShortDate(new Date(closesAt))}. You can still view what's here, but completion is no longer being tracked.`
      : "The window has passed. You can still view what's here, but completion is no longer being tracked.";

  const prereqsMet = !lockedPartIds.has(activePartId);
  const participation: PartParticipation = {
    progress: progressByPart.get(activePartId) ?? null,
    recordId: record?.id ?? null,
    visibility: record?.visibilityOverride ?? "default",
    canEdit: accessState === "open" && prereqsMet && !recordQuery.isLoading && !recordQuery.isError,
    lockReason:
      accessState === "locked"
        ? "This activity is closed — completion is no longer tracked."
        : prereqsMet
          ? null
          : "Complete the earlier required parts first.",
    isLoading: recordQuery.isLoading,
    isError: recordQuery.isError,
    onRetry: () => void recordQuery.refetch(),
  };
  const onMarkComplete = (state: PartProgressState) =>
    saveCompletion.mutate(
      { partId: activePartId, state },
      { onError: () => toast.error("Couldn't update completion.") },
    );

  return (
    <FullViewport>
      <ActivityHeader
        activity={activity}
        accessState={accessState}
        currentPartIndex={Math.max(activeIndex, 0)}
        totalParts={orderedPartIds.length}
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <FlowSidebar
          parts={activity.parts}
          orderedPartIds={orderedPartIds}
          activePartId={activePartId}
          completedPartIds={completedPartIds}
          lockedPartIds={lockedPartIds}
          onSelectPart={onChangeActivePartId}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <PartTabBar
            parts={activity.parts}
            orderedPartIds={orderedPartIds}
            activePartId={activePartId}
            completedPartIds={completedPartIds}
            lockedPartIds={lockedPartIds}
            onSelectPart={onChangeActivePartId}
          />
          <div className="flex-1 px-4 py-5 md:px-8 md:py-7">
            {accessState === "locked" ? (
              <AccessStateNotice tone="warn" title="This activity is closed" body={lockedBody} />
            ) : null}
            {activePart ? (
              <div key={activePart.id}>
                <PartViewport
                  activityId={activity.id}
                  part={activePart}
                  resolvedRef={refByPartId.get(activePart.id) ?? null}
                  participation={participation}
                  onMarkComplete={onMarkComplete}
                  markCompletePending={saveCompletion.isPending}
                />
              </div>
            ) : (
              <p className="text-[13px] text-[var(--color-ink-2)]">
                This activity has no Parts yet.
              </p>
            )}
          </div>
          <PartFooter
            previousPartId={orderedPartIds[activeIndex - 1] ?? null}
            nextPartId={orderedPartIds[activeIndex + 1] ?? null}
            onNavigate={onChangeActivePartId}
          />
        </div>
      </div>
    </FullViewport>
  );
}

function FullViewport({ children }: { readonly children: React.ReactNode }) {
  return <div className="flex h-full min-h-0 flex-1 flex-col">{children}</div>;
}

function LoadingState() {
  return (
    <div className="flex h-full flex-1 items-center justify-center px-5 py-12 text-[13px] text-[var(--color-ink-2)]">
      Loading activity…
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  // The /player route returns 404 in three permanent cases: activity
  // doesn't exist, viewer isn't in the audience, post-close `hidden`.
  // Retry can never recover any of them, so the not-available branch
  // surfaces a calm message; recovery is the header's persistent
  // "Back to track" link (`ActivityShell`). 5xx / network errors stay
  // on the retry path; that's where retry is meaningful.
  const status = errorStatus(error);
  if (status === 404) {
    return (
      <div className="mx-auto max-w-xl px-5 py-12">
        <Callout tone="neutral" title="This activity isn't available">
          <p>
            It may have been removed, closed, or scoped to a different audience. The link may also
            be stale.
          </p>
        </Callout>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl px-5 py-12">
      <Callout tone="danger" title="Couldn't open this activity">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {asUserMessage(
              error,
              "We couldn't load this activity — check your connection and try again.",
            )}
          </span>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </Callout>
    </div>
  );
}

function AccessStateNotice({
  tone,
  title,
  body,
}: {
  readonly tone: "neutral" | "warn";
  readonly title: string;
  readonly body: string;
}) {
  return (
    <Callout tone={tone === "warn" ? "warn" : "neutral"} title={title}>
      <p>{body}</p>
    </Callout>
  );
}

/**
 * Topological-respecting Part order. If the activity carries an
 * explicit `displayOrder` (the composer always emits one), we trust
 * it; missing ids in the order fall to the canonical Part-array
 * sequence as a defensive backstop.
 */
function orderPartIds(
  parts: readonly ActivityPart[],
  displayOrder: readonly string[] | undefined,
): readonly string[] {
  if (!displayOrder || displayOrder.length === 0) return parts.map((p) => p.id);
  const known = new Set(parts.map((p) => p.id));
  const used = new Set<string>();
  const out: string[] = [];
  for (const id of displayOrder) {
    if (known.has(id) && !used.has(id)) {
      out.push(id);
      used.add(id);
    }
  }
  for (const p of parts) {
    if (!used.has(p.id)) out.push(p.id);
  }
  return out;
}
