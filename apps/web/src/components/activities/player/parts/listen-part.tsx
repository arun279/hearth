import type { ListenAudioPart } from "@hearth/domain";
import { FileWarning } from "lucide-react";
import { useRef } from "react";
import { usePlaybackSignals } from "../../../../hooks/use-playback-signals.ts";

type Props = {
  readonly activityId: string;
  readonly part: ListenAudioPart;
  readonly readUrl: string | null;
};

/**
 * Vanilla HTML5 audio Part renderer. No external player library —
 * native `<audio controls>` carries keyboard, screen-reader, and OS-
 * level scrubbing affordances for free, and the Part's authoring shape
 * already encodes the only customizations v1 needs (`startSeconds`,
 * `endSeconds`).
 *
 * Evidence-Signal cadence (debounced playback_position + last_played_at
 * on pause/ended/unmount) is shared with `<WatchPart>` via the
 * `usePlaybackSignals` hook — both elements expose the same media
 * event surface so the timing logic doesn't fork.
 */
export function ListenPart({ activityId, part, readUrl }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const signals = usePlaybackSignals({
    activityId,
    partId: part.id,
    mediaRef: audioRef,
    startSeconds: part.startSeconds,
    endSeconds: part.endSeconds,
  });

  if (readUrl === null) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-warn-border)] bg-[var(--color-warn-soft)] px-5 py-6 text-center text-[var(--color-warn)]">
        <FileWarning size={18} strokeWidth={1.5} aria-hidden="true" />
        <p className="font-medium text-[13px]">Audio isn't available right now.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] px-4 py-4">
      {part.title ? (
        <p className="font-medium text-[13px] text-[var(--color-ink)]">{part.title}</p>
      ) : null}
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={readUrl}
        onTimeUpdate={signals.onTimeUpdate}
        onLoadedMetadata={signals.onLoadedMetadata}
        onPause={signals.onPause}
        onEnded={signals.onEnded}
        className="w-full"
      >
        <track kind="captions" />
      </audio>
      {part.startSeconds !== undefined || part.endSeconds !== undefined ? (
        <p className="font-mono text-[10px] text-[var(--color-ink-2)] tabular-nums">
          Clip: {formatClip(part.startSeconds, part.endSeconds)}
        </p>
      ) : null}
    </div>
  );
}

function formatClip(start: number | undefined, end: number | undefined): string {
  const fmt = (s: number | undefined) =>
    s === undefined ? "—" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return `${fmt(start)} → ${fmt(end)}`;
}
