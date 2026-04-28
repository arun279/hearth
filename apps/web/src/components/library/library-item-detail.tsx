import type { LibraryItemId, LibraryRevisionId } from "@hearth/domain";
import { Badge, Button, Callout, cn, Modal, Skeleton } from "@hearth/ui";
import { Archive, Download, FileUp, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  type LibraryItemDetailPayload,
  libraryDownloadUrl,
  libraryRevisionDownloadUrl,
  useLibraryItem,
  useRetireLibraryItem,
} from "../../hooks/use-library.ts";
import { formatBytes, formatShortDate } from "../../lib/format.ts";
import { asUserMessage } from "../../lib/problem.ts";
import { KindBadge } from "./kind-badge.tsx";
import { UploadDialog } from "./upload-dialog.tsx";

type Props = {
  readonly groupId: string;
  readonly itemId: LibraryItemId;
  readonly open: boolean;
  readonly onClose: () => void;
};

/**
 * Modal-as-route detail view. Lists revisions (newest first, current
 * highlighted), stewards, and "Used in" activities. Steward affordances
 * (Add revision / Retire) are gated on the server-rendered caps.
 */
export function LibraryItemDetail({ groupId, itemId, open, onClose }: Props) {
  const query = useLibraryItem(itemId, open);
  const retire = useRetireLibraryItem(groupId, itemId);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [retireConfirmOpen, setRetireConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = query.data;

  const onRetire = async () => {
    setError(null);
    try {
      await retire.mutateAsync();
      toast.success("Item retired. Existing references keep working.");
      setRetireConfirmOpen(false);
    } catch (err) {
      setError(asUserMessage(err, "Couldn't retire."));
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={data?.detail.item.title ?? "Library item"}
        size="lg"
        footer={
          data ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              {data.caps.canRetire && data.detail.item.retiredAt === null ? (
                <Button
                  variant="secondary"
                  onClick={() => setRetireConfirmOpen(true)}
                  disabled={retire.isPending}
                >
                  <Archive size={12} aria-hidden /> Retire
                </Button>
              ) : null}
              {data.caps.canAddRevision ? (
                <Button onClick={() => setUploadOpen(true)}>
                  <FileUp size={12} aria-hidden /> Upload new revision
                </Button>
              ) : null}
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          )
        }
      >
        {query.isLoading || !data ? <DetailSkeleton /> : <DetailBody data={data} itemId={itemId} />}
        {error ? (
          <Callout tone="warn" title="Action failed">
            {error}
          </Callout>
        ) : null}
      </Modal>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        groupId={groupId}
        libraryItemId={itemId}
      />

      <Modal
        open={retireConfirmOpen}
        onClose={() => setRetireConfirmOpen(false)}
        title="Retire this item?"
        size="sm"
        tone="danger"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRetireConfirmOpen(false)}
              disabled={retire.isPending}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void onRetire()} disabled={retire.isPending}>
              {retire.isPending ? (
                <>
                  <Loader2 size={12} className="animate-spin" aria-hidden /> Retiring…
                </>
              ) : (
                "Retire"
              )}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[var(--color-ink-2)]">
          New activities won't be able to attach this item, but anything that already references it
          keeps reading the pinned revision. You can retire it again later or unretire by editing
          metadata after we ship that.
        </p>
      </Modal>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function DetailBody({
  data,
  itemId,
}: {
  readonly data: LibraryItemDetailPayload;
  readonly itemId: LibraryItemId;
}) {
  const { detail, displayKind } = data;
  const item = detail.item;
  const isRetired = item.retiredAt !== null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <KindBadge kind={displayKind} />
        <div className="min-w-0 flex-1">
          {item.description ? (
            <p className="text-[13px] text-[var(--color-ink-2)]">{item.description}</p>
          ) : (
            <p className="text-[12px] text-[var(--color-ink-3)] italic">No description.</p>
          )}
          {item.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.tags.map((t) => (
                <Badge key={t} tone="neutral">
                  {t}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <a
          href={libraryDownloadUrl(itemId)}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-1.5 self-start whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--color-rule)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[12px] text-[var(--color-ink-2)]",
            "hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
          )}
        >
          <Download size={12} aria-hidden /> Download current
        </a>
      </div>

      {isRetired ? (
        <Callout tone="warn" title="This item is retired">
          New activities can't attach it. Existing references keep their pinned revisions.
        </Callout>
      ) : null}

      <section aria-labelledby="revisions-heading">
        <h3
          id="revisions-heading"
          className="mb-2 font-medium text-[10px] text-[var(--color-ink-3)] uppercase tracking-wide"
        >
          Revisions
        </h3>
        <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-rule)]">
          {detail.revisions.length === 0 ? (
            <p className="p-3 text-[12px] text-[var(--color-ink-3)] italic">No revisions yet.</p>
          ) : (
            detail.revisions.map((r, i) => {
              const isCurrent = r.id === item.currentRevisionId;
              return (
                <div
                  key={r.id}
                  className={cn(
                    "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5",
                    i < detail.revisions.length - 1 && "border-b border-[var(--color-rule)]",
                    isCurrent && "bg-[var(--color-accent-soft)]",
                  )}
                >
                  <span
                    className={cn(
                      "w-10 shrink-0 font-mono text-[11px]",
                      isCurrent ? "text-[var(--color-accent)]" : "text-[var(--color-ink-3)]",
                    )}
                  >
                    r{r.revisionNumber}
                  </span>
                  <div className="min-w-0 flex-1 basis-[180px]">
                    <div className="text-[12px] text-[var(--color-ink-2)]">
                      {formatShortDate(r.uploadedAt)} · {formatBytes(r.sizeBytes)}
                    </div>
                    {r.originalFilename ? (
                      <div className="mt-0.5 truncate text-[11px] text-[var(--color-ink-3)]">
                        {r.originalFilename}
                      </div>
                    ) : null}
                  </div>
                  {isCurrent ? <Badge tone="accent">current</Badge> : null}
                  <a
                    href={libraryRevisionDownloadUrl(itemId, r.id as LibraryRevisionId)}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-[var(--color-ink-2)] hover:bg-[var(--color-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                    aria-label={`Download revision ${r.revisionNumber}`}
                  >
                    <Download size={11} aria-hidden /> Download
                  </a>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section aria-labelledby="stewards-heading">
        <h3
          id="stewards-heading"
          className="mb-2 font-medium text-[10px] text-[var(--color-ink-3)] uppercase tracking-wide"
        >
          Stewards
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-ink-2)]">
          <StewardChip kind="uploader" />
          {detail.stewards.map((s) => (
            <StewardChip key={s.id} kind="explicit" userId={s.userId} />
          ))}
          {detail.stewards.length === 0 ? (
            <span className="text-[11px] text-[var(--color-ink-3)] italic">
              The uploader is the only Steward.
            </span>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="usedin-heading">
        <h3
          id="usedin-heading"
          className="mb-2 font-medium text-[10px] text-[var(--color-ink-3)] uppercase tracking-wide"
        >
          Used in
        </h3>
        <p className="text-[12px] text-[var(--color-ink-2)]">
          {detail.usedInCount === 0
            ? "Not referenced by any activity yet."
            : `Referenced by ${detail.usedInCount} ${detail.usedInCount === 1 ? "activity" : "activities"}.`}
        </p>
      </section>
    </div>
  );
}

type StewardChipProps =
  | { readonly kind: "uploader" }
  | { readonly kind: "explicit"; readonly userId: string };

/**
 * Two shapes:
 *   - Uploader chip: "Uploader" label only — they're the implicit Steward,
 *     no row exists, no display name available, so the chip stays terse.
 *   - Explicit steward chip: monospace user-id rendered honestly as
 *     code-style text. Display names land when M18 wires the user surface
 *     into the library detail payload; until then we don't fake an avatar
 *     out of an opaque cuid2 because the result reads as a single letter
 *     ("u" for `u_local_…`) and looks broken.
 */
function StewardChip(props: StewardChipProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1",
        props.kind === "uploader"
          ? "border-[var(--color-accent-border)] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-rule)] bg-[var(--color-bg)]",
      )}
    >
      {props.kind === "uploader" ? (
        <span className="font-medium text-[11px] text-[var(--color-accent)] uppercase tracking-wide">
          Uploader
        </span>
      ) : (
        <>
          <span className="font-medium text-[10px] text-[var(--color-ink-3)] uppercase tracking-wide">
            Steward
          </span>
          <span
            className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 font-mono text-[10px] text-[var(--color-ink-2)]"
            title="User identifier — display names land in a follow-up milestone."
          >
            {props.userId}
          </span>
        </>
      )}
    </div>
  );
}
