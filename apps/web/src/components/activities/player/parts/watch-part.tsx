import type { WatchVideoPart } from "@hearth/domain";
import { AspectRatio } from "@hearth/ui/parts/aspect-ratio";
import { FileWarning } from "lucide-react";
import { useRef } from "react";
import { usePlaybackSignals } from "../../../../hooks/use-playback-signals.ts";

type Props = {
  readonly activityId: string;
  readonly part: WatchVideoPart;
  readonly readUrl: string | null;
};

/**
 * Vanilla HTML5 video Part renderer. Mirror of the audio Part, wrapped
 * in a fixed 16:9 frame so the video keeps its aspect ratio inside the
 * Activity Player layout. First-class provider embeds (YouTube,
 * Spotify) live under the `embed` Part kind — `watch_video` is for
 * Library Items whose current revision is a video MIME.
 *
 * Evidence-Signal cadence is the shared `usePlaybackSignals` hook (same
 * `playback_position` debounce + `last_played_at` cleanup as the audio
 * Part); see `apps/web/src/hooks/use-playback-signals.ts` for the
 * rationale.
 */
export function WatchPart({ activityId, part, readUrl }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const signals = usePlaybackSignals({
    activityId,
    partId: part.id,
    mediaRef: videoRef,
    startSeconds: part.startSeconds,
    endSeconds: part.endSeconds,
  });

  if (readUrl === null) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-warn-border)] bg-[var(--color-warn-soft)] px-5 py-6 text-center text-[var(--color-warn)]">
        <FileWarning size={18} strokeWidth={1.5} aria-hidden="true" />
        <p className="font-medium text-[13px]">Video isn't available right now.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <AspectRatio ratio={16 / 9}>
        <video
          ref={videoRef}
          controls
          preload="metadata"
          src={readUrl}
          onTimeUpdate={signals.onTimeUpdate}
          onLoadedMetadata={signals.onLoadedMetadata}
          onPause={signals.onPause}
          onEnded={signals.onEnded}
          className="bg-black"
        >
          <track kind="captions" />
        </video>
      </AspectRatio>
    </div>
  );
}
