import {
  ALLOWED_LIBRARY_MIME_TYPES,
  isAllowedLibraryMime,
  MAX_LIBRARY_ITEM_BYTES,
} from "@hearth/domain/library";
import { Button, Callout, Field, Input, Modal, Textarea } from "@hearth/ui";
import { Loader2, UploadCloud, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  isUploadAbortedError,
  type UploadController,
  type UploadProgress,
  useLibraryQuota,
  useUploadLibraryItem,
} from "../../hooks/use-library.ts";
import { formatBytes } from "../../lib/format.ts";
import { asUserMessage } from "../../lib/problem.ts";

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly groupId: string;
  /**
   * When set, the dialog uploads a NEW REVISION onto the named item.
   * Title / description / tags fields stay hidden in this mode — the
   * revision inherits the existing item's metadata until edited.
   */
  readonly libraryItemId?: string;
  /** Pre-filled title when uploading a fresh item; ignored on revisions. */
  readonly defaultTitle?: string;
};

const ACCEPT_ATTR = ALLOWED_LIBRARY_MIME_TYPES.join(",");

const STAGE_LABEL: Record<UploadProgress["stage"], string> = {
  idle: "Upload",
  reserving: "Preparing…",
  uploading: "Uploading…",
  finalizing: "Finalizing…",
};

const INITIAL_PROGRESS: UploadProgress = { stage: "idle", loaded: 0, total: 0 };

export function UploadDialog({ open, onClose, groupId, libraryItemId, defaultTitle }: Props) {
  const isNewItem = libraryItemId === undefined;
  const upload = useUploadLibraryItem(groupId);
  const quota = useLibraryQuota(groupId, open);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropzoneId = useId();
  const controllerRef = useRef<UploadController | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [description, setDescription] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [progress, setProgress] = useState<UploadProgress>(INITIAL_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Reset form when the dialog opens / closes so a stale file doesn't
  // get attached to the next upload.
  useEffect(() => {
    if (!open) {
      setFile(null);
      setTitle(defaultTitle ?? "");
      setDescription("");
      setTagsRaw("");
      setProgress(INITIAL_PROGRESS);
      setError(null);
      setDragOver(false);
      controllerRef.current = null;
    }
  }, [open, defaultTitle]);

  const handlePick = useCallback((picked: File | null) => {
    setError(null);
    if (!picked) {
      setFile(null);
      return;
    }
    if (!isAllowedLibraryMime(picked.type)) {
      setError(
        "That file type isn't supported. Try PDF, audio (mp3/m4a/ogg/wav), video (mp4/webm), images, or text/markdown.",
      );
      setFile(null);
      return;
    }
    if (picked.size > MAX_LIBRARY_ITEM_BYTES) {
      setError(
        `Files must be ${formatBytes(MAX_LIBRARY_ITEM_BYTES)} or smaller. This one is ${formatBytes(picked.size)}.`,
      );
      setFile(null);
      return;
    }
    setFile(picked);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setDragOver(false);
      handlePick(e.dataTransfer.files?.[0] ?? null);
    },
    [handlePick],
  );

  const submit = useCallback(async () => {
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    if (isNewItem && title.trim().length === 0) {
      setError("Give the item a title.");
      return;
    }
    setError(null);
    const tags = tagsRaw
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    try {
      await upload.mutateAsync({
        file,
        title: isNewItem ? title.trim() : "(unused)",
        description: isNewItem ? description.trim() || null : null,
        tags: isNewItem ? tags : [],
        ...(libraryItemId !== undefined ? { libraryItemId } : {}),
        onProgress: setProgress,
        onController: (controller) => {
          controllerRef.current = controller;
        },
      });
      toast.success(isNewItem ? "Library item uploaded." : "New revision uploaded.");
      onClose();
    } catch (err) {
      if (isUploadAbortedError(err)) {
        // The cron sweep handles the orphan; from the UI's POV this is
        // just a return-to-idle, no error banner.
        setProgress(INITIAL_PROGRESS);
        return;
      }
      setError(asUserMessage(err, "Upload failed."));
      setProgress(INITIAL_PROGRESS);
    } finally {
      controllerRef.current = null;
    }
  }, [file, isNewItem, title, description, tagsRaw, upload, libraryItemId, onClose]);

  const cancelUpload = useCallback(() => {
    controllerRef.current?.cancel();
  }, []);

  const stage = progress.stage;
  const busy = stage !== "idle";
  // Cancel is exposed only during the R2 PUT, which is the long-running
  // stage; reserve / finalize each complete in a sub-second D1 round-
  // trip and the dialog simply waits them out.
  const cancellable = stage === "uploading";

  const progressPercent =
    stage === "uploading" && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;

  // Pre-commit quota check. Blocking-state for files that would
  // exceed the killswitch trip; soft-warning state when the upload
  // would push the instance past 60% of its trip budget so the user
  // sees the trajectory before they fill up the bucket.
  const overQuota =
    file !== null && quota.data !== undefined && file.size > quota.data.availableBytes;
  const nearQuota =
    file !== null &&
    !overQuota &&
    quota.data !== undefined &&
    file.size > quota.data.availableBytes * 0.6;

  return (
    <Modal
      open={open}
      // While busy the user can only close via Cancel (which aborts the
      // PUT); ESC + scrim are inert so a stray keypress doesn't strand
      // the upload state.
      onClose={busy ? () => undefined : onClose}
      title={isNewItem ? "Upload to Library" : "Upload new revision"}
      description={
        isNewItem
          ? "Add a PDF, audio, video, image, or document the group can use across activities."
          : "The new revision becomes the default. Existing activities keep reading their pinned revisions."
      }
      size="md"
      footer={
        <>
          {cancellable ? (
            <Button variant="secondary" onClick={cancelUpload}>
              <X size={12} aria-hidden /> Cancel upload
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button onClick={() => void submit()} disabled={busy || !file || overQuota}>
            {busy ? (
              <>
                <Loader2 size={12} className="animate-spin" aria-hidden /> {STAGE_LABEL[stage]}
              </>
            ) : (
              <>
                <UploadCloud size={12} aria-hidden /> {STAGE_LABEL.idle}
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label
          htmlFor={dropzoneId}
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed px-4 py-8 text-center transition-colors ${
            dragOver
              ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
              : "border-[var(--color-rule)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-2)]"
          }`}
        >
          <UploadCloud size={20} aria-hidden className="text-[var(--color-ink-3)]" />
          <div className="font-medium text-[13px] text-[var(--color-ink)]">
            {file ? file.name : "Drag a file here, or click to choose"}
          </div>
          <div className="text-[11px] text-[var(--color-ink-3)]">
            {file
              ? `${formatBytes(file.size)} · ${file.type || "unknown type"}`
              : `Up to ${formatBytes(MAX_LIBRARY_ITEM_BYTES)}. PDF, audio, video, images, or docs.`}
          </div>
          {quota.data ? (
            <div className="text-[11px] text-[var(--color-ink-3)]">
              {formatBytes(quota.data.availableBytes)} free in this instance
            </div>
          ) : null}
          <input
            ref={inputRef}
            id={dropzoneId}
            type="file"
            accept={ACCEPT_ATTR}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              handlePick(picked);
              e.target.value = "";
            }}
          />
        </label>

        {progressPercent !== null ? (
          <div
            className="space-y-1"
            role="status"
            aria-live="polite"
            aria-label={`Uploading: ${progressPercent}% complete`}
          >
            <div className="flex items-baseline justify-between text-[11px] text-[var(--color-ink-3)]">
              <span>Uploading…</span>
              <span className="font-mono">
                {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]"
            >
              <div
                className="h-full bg-[var(--color-accent)] transition-[width] duration-150"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}

        {isNewItem ? (
          <>
            <Field label="Title">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Primer — Beginner Spanish"
                  maxLength={200}
                  disabled={busy}
                />
              )}
            </Field>
            <Field
              label="Description"
              hint="Shown on the item detail. Optional but useful when stewards rotate."
            >
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={4000}
                  disabled={busy}
                />
              )}
            </Field>
            <Field
              label="Tags"
              hint="Comma-separated. Lowercased and deduplicated — up to 16 tags."
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="spanish, grammar"
                  disabled={busy}
                />
              )}
            </Field>
          </>
        ) : null}

        {overQuota ? (
          <Callout tone="warn" title="This file would exceed the storage budget">
            The instance has only {formatBytes(quota.data?.availableBytes ?? 0)} free before the
            killswitch trips. Retire older items or pick a smaller file.
          </Callout>
        ) : null}
        {!overQuota && nearQuota ? (
          <Callout tone="warn" title="This upload uses most of the remaining storage">
            After this upload the instance will be near its budget — fine, but worth knowing.
          </Callout>
        ) : null}

        {error ? (
          <Callout tone="warn" title="Couldn't upload">
            {error}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}
