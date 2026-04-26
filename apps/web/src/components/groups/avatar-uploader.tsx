import type { StudyGroup, UserId } from "@hearth/domain";
import { Avatar, Button, Callout } from "@hearth/ui";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useRemoveAvatar, useUploadAvatar } from "../../hooks/use-avatar-upload.ts";
import { asUserMessage } from "../../lib/problem.ts";

type Props = {
  readonly group: StudyGroup;
  /** Current avatar URL (R2 key) — rendered through the public origin. */
  readonly currentAvatarUrl: string | null;
  /** Display name shown in the initials fallback. */
  readonly name: string;
  /** Public R2 origin from `R2_PUBLIC_ORIGIN`. Joined with the stored key. */
  readonly publicOrigin: string;
  /** Disable when the membership is no longer current. */
  readonly disabled?: boolean;
  /** UserId is rendered for sr-only test selection. */
  readonly userId: UserId;
};

const MAX_DIMENSION = 256;
const MAX_BYTES = 512 * 1024;
const ACCEPTED = "image/png,image/jpeg,image/webp";

/**
 * Avatar uploader. Pipeline:
 *   1. User picks a file via the hidden <input type="file">.
 *   2. We resize it client-side to ≤ 256×256 with `<canvas>` so the
 *      uploaded payload is always tiny (well under the 512 KB cap).
 *      Output mime stays the input mime where possible; we re-encode
 *      to image/jpeg for jpegs and image/png for everything else.
 *   3. The hook calls upload-request → R2 PUT → finalize.
 *   4. On success, the membership query refetches and the rendered
 *      avatar swaps in.
 *
 * Error UX: the hook's onError surfaces the server message; size /
 * MIME failures land in the toast so the user knows what to do.
 */
export function AvatarUploader({
  group,
  currentAvatarUrl,
  name,
  publicOrigin,
  disabled,
  userId,
}: Props) {
  const input = useRef<HTMLInputElement | null>(null);
  const upload = useUploadAvatar(group.id);
  const remove = useRemoveAvatar(group.id, userId);
  const [error, setError] = useState<string | null>(null);

  const hasAvatar = currentAvatarUrl !== null && currentAvatarUrl.length > 0;
  const renderedSrc = hasAvatar ? `${publicOrigin}/${currentAvatarUrl}` : null;
  const busy = upload.isPending || remove.isPending;

  const onPick = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setError(null);
      if (!ACCEPTED.split(",").includes(file.type)) {
        setError("Use a PNG, JPEG, or WebP image.");
        return;
      }
      try {
        const resized = await resize(file);
        if (resized.size > MAX_BYTES) {
          setError(`Image is ${(resized.size / 1024).toFixed(0)} KB after resize — try smaller.`);
          return;
        }
        await upload.mutateAsync(resized);
        toast.success("Avatar updated.");
      } catch (err) {
        const msg = asUserMessage(err, "Upload failed.");
        setError(msg);
      }
    },
    [upload],
  );

  const onRemove = useCallback(async () => {
    setError(null);
    try {
      await remove.mutateAsync();
      toast.success("Avatar removed.");
    } catch (err) {
      setError(asUserMessage(err, "Couldn't remove."));
    }
  }, [remove]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={name} src={renderedSrc} size={48} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-[var(--color-ink)]" data-user-id={userId}>
            Your avatar in {group.name}
          </div>
          <div className="text-[11px] text-[var(--color-ink-3)]">
            PNG, JPEG, or WebP. Auto-resized to 256×256.
          </div>
        </div>
        {hasAvatar ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void onRemove()}
            disabled={disabled || busy}
          >
            {remove.isPending ? (
              <>
                <Loader2 size={12} aria-hidden className="animate-spin" />
                Removing…
              </>
            ) : (
              <>
                <Trash2 size={12} aria-hidden /> Remove
              </>
            )}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => input.current?.click()}
          disabled={disabled || busy}
        >
          {upload.isPending ? (
            <>
              <Loader2 size={12} aria-hidden className="animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <ImagePlus size={12} aria-hidden /> Change
            </>
          )}
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED}
          className="sr-only"
          aria-label="Choose avatar image"
          // The visible "Change" Button forwards Enter/Space to this
          // input via `.click()`, so the input itself never needs to be
          // a Tab stop. Without `tabindex={-1}`, the sr-only input was
          // a ghost stop with no visible focus ring (WCAG 2.4.7).
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            void onPick(file);
            // Reset so picking the same file twice still fires onChange.
            e.target.value = "";
          }}
        />
      </div>
      {error ? (
        <Callout tone="warn" title="Avatar action failed">
          {error}
        </Callout>
      ) : null}
    </div>
  );
}

/**
 * Resize an image file to ≤ MAX_DIMENSION on either side using a
 * `<canvas>` 2D context. Returns a Blob in the same MIME family as the
 * input (jpeg→jpeg, png/webp→png/webp). Drops the size from "phone-shot
 * 4 MB" to "thumbnail under 100 KB" so the avatar PUT is always small.
 */
async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser does not support canvas 2D context.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const mime =
    file.type === "image/jpeg"
      ? "image/jpeg"
      : file.type === "image/webp"
        ? "image/webp"
        : "image/png";
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode image."));
      },
      mime,
      0.9,
    );
  });
}
