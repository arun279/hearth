import { type RefObject, useCallback, useEffect, useRef } from "react";
import { recordSignal } from "../lib/record-signal.ts";

/**
 * Shared Evidence-Signal cadence for the audio + video Part renderers.
 * Both elements expose the same time-update / loadedmetadata / pause
 * / ended surface, so the resume-signal collection is identical:
 *
 *   - `playback_position` debounced 5s during playback.
 *   - `last_played_at` fired on pause / ended / unmount.
 *   - `startSeconds` is applied once metadata loads.
 *   - `endSeconds` is enforced by pausing the element at the boundary
 *     (the HTML5 elements have no native end-clip property).
 *
 * The hook exposes the four event handlers + the loaded-metadata
 * handler; the Part renderer wires them to the underlying `<audio>` /
 * `<video>` element. Returning handlers (rather than driving the
 * element directly) keeps the renderer responsible for layout and
 * keeps this hook free of media-element-specific markup concerns.
 */

const POSITION_DEBOUNCE_MS = 5_000;

type Args = {
  readonly activityId: string;
  readonly partId: string;
  readonly mediaRef: RefObject<HTMLMediaElement | null>;
  readonly startSeconds?: number;
  readonly endSeconds?: number;
};

export function usePlaybackSignals({
  activityId,
  partId,
  mediaRef,
  startSeconds,
  endSeconds,
}: Args) {
  const positionRef = useRef<number>(startSeconds ?? 0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPosition = useCallback(() => {
    recordSignal({
      activityId,
      partId,
      signalType: "playback_position",
      value: positionRef.current,
    });
  }, [activityId, partId]);

  const onTimeUpdate = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    positionRef.current = el.currentTime;
    if (endSeconds !== undefined && el.currentTime >= endSeconds) {
      el.pause();
      el.currentTime = endSeconds;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(flushPosition, POSITION_DEBOUNCE_MS);
  }, [endSeconds, flushPosition, mediaRef]);

  const onLoadedMetadata = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (startSeconds !== undefined && Number.isFinite(startSeconds)) {
      el.currentTime = startSeconds;
    }
  }, [mediaRef, startSeconds]);

  const emitLastPlayed = useCallback(() => {
    recordSignal({
      activityId,
      partId,
      signalType: "last_played_at",
      value: Date.now(),
    });
  }, [activityId, partId]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      emitLastPlayed();
    };
  }, [emitLastPlayed]);

  return { onTimeUpdate, onLoadedMetadata, onPause: emitLastPlayed, onEnded: emitLastPlayed };
}
