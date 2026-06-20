import type { PartHistory, PartHistoryReason, PartProgressState } from "@hearth/domain";
import { Badge, Button, Callout, Drawer, Modal } from "@hearth/ui";
import { useMyPartHistory } from "../../../hooks/use-activity-record.ts";
import { useMediaQuery } from "../../../hooks/use-media-query.ts";
import { formatRelative, formatShortDate } from "../../../lib/format.ts";
import { asUserMessage, errorStatus } from "../../../lib/problem.ts";

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly activityId: string;
  readonly partId: string;
  /** The Part's display label, for the drawer/dialog title. */
  readonly partLabel: string;
};

const REASON_LABEL: Record<PartHistoryReason, string> = {
  retry: "Retried",
  revision_bump: "Reopened by a new revision",
  facilitator_reset: "Reset by a facilitator",
};

/**
 * Read-only Part History viewer. Below `md` it renders as an edge Sheet
 * (`<Drawer>`); at `md` and up as a centred `<Modal>` dialog — both share the
 * same focus-trap / Escape / focus-restore a11y contract, so the structural
 * swap is purely about reach on a phone vs a desktop. Opened from a per-Part
 * history chip in the FlowSidebar / PartTabBar when the Part has prior attempts.
 *
 * Each entry shows when it was archived, why (humanized `reason`), and a
 * read-only snapshot of the value at that moment. The owner history route 404s
 * a viewer who has fallen out of the audience, so the error branch splits on
 * status: a 404 reads as "no longer available" with no retry; a 5xx keeps the
 * danger Callout + retry.
 */
export function PartHistoryDrawer({ open, onClose, activityId, partId, partLabel }: Props) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const title = `History — ${partLabel}`;

  const body = <PartHistoryBody open={open} activityId={activityId} partId={partId} />;

  if (isDesktop) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        description="Prior attempts on this part. Earlier work is preserved here whenever a part is retried, reopened by a new revision, or reset by a facilitator."
        size="md"
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        {body}
      </Modal>
    );
  }

  return (
    <Drawer open={open} onClose={onClose} label={title} side="right" header={title}>
      <p className="mb-3 text-[12px] text-[var(--color-ink-2)]">
        Prior attempts on this part, preserved whenever it's retried, reopened by a new revision, or
        reset by a facilitator.
      </p>
      {body}
    </Drawer>
  );
}

function PartHistoryBody({
  open,
  activityId,
  partId,
}: {
  readonly open: boolean;
  readonly activityId: string;
  readonly partId: string;
}) {
  const query = useMyPartHistory(activityId, partId, open);

  if (query.isLoading) {
    return <p className="text-[13px] text-[var(--color-ink-2)]">Loading history…</p>;
  }

  if (query.isError) {
    if (errorStatus(query.error) === 404) {
      return (
        <Callout tone="neutral" title="History isn't available">
          <p>This activity may have been scoped to a different audience, or the link is stale.</p>
        </Callout>
      );
    }
    return (
      <Callout tone="danger" title="Couldn't load history">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {asUserMessage(
              query.error,
              "We couldn't load this part's history — check your connection and try again.",
            )}
          </span>
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      </Callout>
    );
  }

  const entries = query.data ?? [];
  if (entries.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-ink-2)]">No prior attempts on this part yet.</p>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id}>
          <HistoryEntry entry={entry} />
        </li>
      ))}
    </ol>
  );
}

function HistoryEntry({ entry }: { readonly entry: PartHistory }) {
  return (
    <article className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-3">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={entry.reason === "facilitator_reset" ? "warn" : "neutral"}>
          {REASON_LABEL[entry.reason]}
        </Badge>
        <span className="text-[12px] text-[var(--color-ink-2)]">
          {recordedAtLabel(entry.recordedAt)}
        </span>
      </header>
      <SnapshotView snapshot={entry.snapshot} />
    </article>
  );
}

/**
 * "3 days ago · Jun 1, 2026" for recent attempts, collapsing to the bare date
 * once the entry is old enough that `formatRelative` has itself degraded to a
 * calendar date — without the collapse the two halves print the identical date
 * twice ("May 31, 2024 · May 31, 2024"), which reads as a rendering bug.
 */
function recordedAtLabel(recordedAt: PartHistory["recordedAt"]): string {
  const relative = formatRelative(recordedAt);
  const absolute = formatShortDate(recordedAt);
  return relative === absolute ? absolute : `${relative} · ${absolute}`;
}

/**
 * Read-only render of a `PartProgressState` snapshot. Each Part kind carries a
 * different value shape; the reflection's prose and the quiz's answer count are
 * the meaningful ones to a learner reviewing prior work. Passive kinds carry no
 * authored value, so the snapshot just states completion at the time.
 */
function SnapshotView({ snapshot }: { readonly snapshot: PartProgressState }) {
  const completedNote = snapshot.completed ? "Marked complete" : "Not marked complete";

  switch (snapshot.kind) {
    case "write_reflection":
      return (
        <div className="space-y-1">
          {snapshot.text.trim().length > 0 ? (
            <p className="whitespace-pre-wrap text-[13px] text-[var(--color-ink)]">
              {snapshot.text}
            </p>
          ) : (
            <p className="text-[13px] text-[var(--color-ink-3)] italic">No text was written.</p>
          )}
          <p className="text-[11px] text-[var(--color-ink-3)]">{completedNote}.</p>
        </div>
      );
    case "quiz": {
      const n = snapshot.answers.length;
      return (
        <p className="text-[13px] text-[var(--color-ink-2)]">
          {n === 0
            ? "No answers were submitted"
            : `${n} ${n === 1 ? "answer" : "answers"} submitted`}
          . {completedNote}.
        </p>
      );
    }
    default:
      return <p className="text-[13px] text-[var(--color-ink-2)]">{completedNote}.</p>;
  }
}
