import {
  ALLOWED_LIBRARY_MIME_TYPES,
  isAllowedLibraryMime,
  MAX_LIBRARY_ITEM_BYTES,
} from "@hearth/domain/library";
import { Button, Callout, Field, Input, Modal, Textarea } from "@hearth/ui";
import { Loader2, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useUploadLibraryItem } from "../../hooks/use-library.ts";
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

type Stage = "idle" | "reserving" | "uploading" | "finalizing";

export function UploadDialog({ open, onClose, groupId, libraryItemId, defaultTitle }: Props) {
  const isNewItem = libraryItemId === undefined;
  const upload = useUploadLibraryItem(groupId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropzoneId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [description, setDescription] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
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
      setStage("idle");
      setError(null);
      setDragOver(false);
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

    setStage("reserving");
    try {
      // The mutation bundles request → R2 PUT → finalize. Stage updates
      // are coarse — the SPA shows three labels rather than a pixel
      // progress bar so the user knows roughly where they are without
      // misleading precision (R2's PUT doesn't expose progress through
      // the fetch API).
      setStage("uploading");
      await upload.mutateAsync({
        file,
        title: isNewItem ? title.trim() : "(unused)",
        description: isNewItem ? description.trim() || null : null,
        tags: isNewItem ? tags : [],
        ...(libraryItemId !== undefined ? { libraryItemId } : {}),
      });
      setStage("finalizing");
      toast.success(isNewItem ? "Library item uploaded." : "New revision uploaded.");
      onClose();
    } catch (err) {
      setError(asUserMessage(err, "Upload failed."));
      setStage("idle");
    }
  }, [file, isNewItem, title, description, tagsRaw, upload, libraryItemId, onClose]);

  const busy = stage !== "idle";
  const stageLabel: Record<Stage, string> = {
    idle: "Upload",
    reserving: "Reserving…",
    uploading: "Uploading…",
    finalizing: "Finalizing…",
  };

  return (
    <Modal
      open={open}
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
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !file}>
            {busy ? (
              <>
                <Loader2 size={12} className="animate-spin" aria-hidden /> {stageLabel[stage]}
              </>
            ) : (
              <>
                <UploadCloud size={12} aria-hidden /> {stageLabel.idle}
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

        {error ? (
          <Callout tone="warn" title="Couldn't upload">
            {error}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}
