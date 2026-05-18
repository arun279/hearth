import type { EmbedPart as EmbedPartT } from "@hearth/domain";
import { AspectRatio } from "@hearth/ui/parts/aspect-ratio";
import { Link2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { recordSignal } from "../../../../lib/record-signal.ts";

type Props = {
  readonly activityId: string;
  readonly part: EmbedPartT;
};

/**
 * Provider-aware iframe renderer for the Embed Part kind. Three
 * providers:
 *
 *   - `youtube` — `https://www.youtube.com/embed/<id>?start=<s>` inside
 *     a 16:9 frame. `allow="encrypted-media; picture-in-picture"` keeps
 *     drm-protected videos and PiP working.
 *   - `spotify` — `https://open.spotify.com/embed/...` at the
 *     provider's recommended height. Spotify's iframe handles its own
 *     aspect; we let it choose.
 *   - `generic` — arbitrary https URL inside a 16:9 frame with a tight
 *     sandbox (`allow-scripts allow-same-origin allow-popups
 *     allow-forms`). The sandbox is the minimum surface needed for
 *     useful third-party content while denying top-level navigation
 *     and unrestricted permissions.
 *
 * Emits a single `viewed_at` signal on mount (no second-by-second
 * tracking — the iframe surface doesn't expose playback timing
 * reliably across providers, and richer playback signals can layer in
 * via the YouTube / Spotify iframe APIs in a follow-up milestone).
 */
export function EmbedPart({ activityId, part }: Props) {
  useEffect(() => {
    recordSignal({
      activityId,
      partId: part.id,
      signalType: "viewed_at",
      value: Date.now(),
    });
  }, [activityId, part.id]);

  const src = useMemo(() => buildEmbedSrc(part), [part]);

  if (src === null) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-warn-border)] bg-[var(--color-warn-soft)] px-5 py-6 text-center text-[var(--color-warn)]">
        <p className="font-medium text-[13px]">This embed URL doesn't match the provider.</p>
      </div>
    );
  }

  const ratio = part.provider === "spotify" ? 1 : 16 / 9;
  const sandbox =
    part.provider === "generic"
      ? "allow-scripts allow-same-origin allow-popups allow-forms"
      : undefined;
  const allow = part.provider === "youtube" ? "encrypted-media; picture-in-picture" : undefined;

  return (
    <div className="flex flex-col gap-3">
      {part.title ? (
        <p className="font-medium text-[13px] text-[var(--color-ink)]">{part.title}</p>
      ) : null}
      <AspectRatio ratio={ratio}>
        <iframe
          src={src}
          title={part.title ?? "Embedded content"}
          {...(allow ? { allow } : {})}
          {...(sandbox ? { sandbox } : {})}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          className="border-0"
        />
      </AspectRatio>
      <a
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 self-start text-[11px] text-[var(--color-ink-2)] hover:text-[var(--color-accent)]"
      >
        <Link2 size={11} strokeWidth={1.5} aria-hidden="true" />
        Open in a new tab
      </a>
    </div>
  );
}

/**
 * Translate the per-Part `url` into a provider-canonical embed src.
 * YouTube and Spotify mangle their watch URLs into embed URLs; the
 * facilitator pastes a normal share link and the player normalises it
 * here. Returns null when the URL doesn't match the declared provider
 * (the composer-side validation usually catches this; the runtime
 * check is defense in depth against a hand-edited authoring payload).
 *
 * Exported for direct unit-testing of the provider switch — the React
 * component's render path is exercised separately, but the URL math
 * is the part most likely to regress from a stray share-link shape.
 */
export function buildEmbedSrc(part: EmbedPartT): string | null {
  try {
    const url = new URL(part.url);
    const start = part.startSeconds !== undefined ? Math.max(0, Math.floor(part.startSeconds)) : 0;
    if (part.provider === "youtube") {
      const id = extractYouTubeId(url);
      if (!id) return null;
      const params = new URLSearchParams();
      if (start > 0) params.set("start", String(start));
      const qs = params.toString();
      return `https://www.youtube.com/embed/${id}${qs ? `?${qs}` : ""}`;
    }
    if (part.provider === "spotify") {
      // Spotify share URLs already include a path like `/track/<id>` or
      // `/episode/<id>`. The canonical embed URL inserts `/embed` after
      // the origin and keeps the rest of the path.
      if (url.hostname !== "open.spotify.com") return null;
      return `https://open.spotify.com/embed${url.pathname}`;
    }
    // `generic` — the facilitator owns the URL shape. The composer
    // validates that it's an absolute https URL; we trust that here.
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractYouTubeId(url: URL): string | null {
  // youtu.be/<id>
  if (url.hostname === "youtu.be") return url.pathname.slice(1) || null;
  // youtube.com/watch?v=<id>
  if (url.hostname.endsWith("youtube.com")) {
    const v = url.searchParams.get("v");
    if (v) return v;
    // youtube.com/embed/<id>
    const match = url.pathname.match(/^\/embed\/([^/]+)/);
    if (match) return match[1] ?? null;
    // youtube.com/shorts/<id>
    const shorts = url.pathname.match(/^\/shorts\/([^/]+)/);
    if (shorts) return shorts[1] ?? null;
  }
  return null;
}
