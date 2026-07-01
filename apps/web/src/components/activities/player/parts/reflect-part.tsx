import { countWords, type PartProgressState, type WriteReflectionPart } from "@hearth/domain";
import { cn, SaveIndicator, type SaveStatus, Textarea } from "@hearth/ui";
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSaveReflection } from "../../../../hooks/use-activity-record.ts";
import { useDebouncedValue } from "../../../../hooks/use-debounced-value.ts";
import { api } from "../../../../lib/api-client.ts";
import { asUserMessage } from "../../../../lib/problem.ts";

type Props = {
  readonly activityId: string;
  readonly part: WriteReflectionPart;
  readonly partState: PartProgressState | null;
  readonly canParticipate: boolean;
};

/**
 * Collapse the mutation flags into the indicator's status. A pending mutation
 * OR unsaved edits read as "saving" so the pill stays honest between a
 * keystroke and the debounced flush; an error wins over everything so a
 * failed save is never masked by a stale success.
 */
export function deriveSaveStatus({
  isError,
  isPending,
  dirty,
  isSuccess,
}: {
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly dirty: boolean;
  readonly isSuccess: boolean;
}): SaveStatus {
  if (isError) return "error";
  if (isPending || dirty) return "saving";
  if (isSuccess) return "saved";
  return "idle";
}

/**
 * Word-count copy that doesn't lean on colour to convey met/not-met (WCAG
 * 1.4.1). With no minimum it's a plain count. Below the minimum it reads
 * "N of M words" — progress toward a soft target, not an over-budget limit.
 * At/above it reads "M+ words", which the caller pairs with a check icon so
 * the "met" state carries a non-colour cue. "M / N words" was the prior copy:
 * identical string in both states, so the only signal was hue.
 */
export function wordCountLabel(
  words: number,
  minWords: number | undefined,
): { readonly text: string; readonly met: boolean } {
  if (minWords === undefined) {
    return { text: `${words} ${words === 1 ? "word" : "words"}`, met: false };
  }
  const met = words >= minWords;
  return { text: met ? `${minWords}+ words` : `${words} of ${minWords} words`, met };
}

function Prompt({ prompt }: { readonly prompt: string }) {
  return (
    <p className="whitespace-pre-wrap text-[0.9375rem] text-[var(--color-ink)] leading-relaxed [font-family:var(--font-serif)]">
      {prompt}
    </p>
  );
}

export function ReflectPart({ activityId, part, partState, canParticipate }: Props) {
  const initialText = partState?.kind === "write_reflection" ? partState.text : "";

  if (!canParticipate) {
    return (
      <div className="flex flex-col gap-3">
        <Prompt prompt={part.prompt} />
        {initialText ? (
          <p className="whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[0.8125rem] text-[var(--color-ink)] leading-relaxed">
            {initialText}
          </p>
        ) : (
          <p className="text-[0.8125rem] text-[var(--color-ink-2)]">
            Only enrolled participants can write a reflection here.
          </p>
        )}
      </div>
    );
  }

  // `ReflectEditor` seeds local state from `initialText` once at mount, so the
  // seed must already be the persisted value on first render. Two mechanisms
  // guarantee that: PartViewport gates mounting on `record.loaded` (the editor
  // never renders before the record fetch resolves), and the player remounts
  // it via `key={part.id}` on every Part switch (so switching Parts re-seeds
  // from the new Part's state rather than carrying stale text).
  return <ReflectEditor activityId={activityId} part={part} initialText={initialText} />;
}

function ReflectEditor({
  activityId,
  part,
  initialText,
}: {
  readonly activityId: string;
  readonly part: WriteReflectionPart;
  readonly initialText: string;
}) {
  const [text, setText] = useState(initialText);
  const debounced = useDebouncedValue(text, 800);
  const save = useSaveReflection(activityId);
  // `mutate` is referentially stable across renders; the whole `save` object
  // is not. Depending on the stable function keeps the autosave effect firing
  // once per debounced change rather than re-firing on every render (which
  // would launch a storm of concurrent PUTs and never let the indicator
  // settle past "Saving…").
  const saveMutate = save.mutate;
  const lastSaved = useRef(initialText);
  const toastedFailure = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  // Both the debounced autosave's onSuccess and the keepalive flush advance
  // `lastSaved`. Folding them behind one writer keeps the advance monotonic:
  // a late onSuccess for older text can't pull `lastSaved` back behind a flush
  // that already persisted the newest text (which would strand the pill on
  // "Saving…" with no request in flight). A value still matching the live text
  // is current and always accepted; any other value is only accepted while
  // `lastSaved` is still at its seed, never as a regression from a flush.
  const markSaved = useCallback(
    (value: string) => {
      if (value === textRef.current || lastSaved.current === initialText) {
        lastSaved.current = value;
      }
    },
    [initialText],
  );

  // Single source of truth for the save side-effects: both the debounced
  // autosave and the retry affordance route through here so a successful retry
  // advances `lastSaved` (settling the pill past "Saving…") and clears the
  // one-shot toast latch. Failures keep a persistent indicator but only toast
  // once per failure burst (offline shouldn't spam).
  const persist = useCallback(
    (pending: string) => {
      saveMutate(
        { partId: part.id, text: pending },
        {
          onSuccess: () => {
            markSaved(pending);
            toastedFailure.current = false;
          },
          onError: (err) => {
            if (!toastedFailure.current) {
              toast.error(asUserMessage(err, "Couldn't save your reflection — we'll keep trying."));
              toastedFailure.current = true;
            }
          },
        },
      );
    },
    [saveMutate, part.id, markSaved],
  );

  // Debounced autosave: persist only after typing pauses, and never re-save
  // an unchanged value.
  useEffect(() => {
    if (debounced === lastSaved.current) return;
    persist(debounced);
  }, [debounced, persist]);

  // Last-ditch flush so a draft isn't lost when the tab is hidden (mobile
  // background) or the component unmounts mid-pause. `keepalive` lets the
  // request outlive the page; the next mount reads the persisted draft.
  // This fires even when a debounced save is in flight, by design: a normal
  // `fetch` is aborted on unload, so the keepalive PUT is the only durable
  // write there. The repeated PUT is idempotent (latest-wins upsert), and
  // the `textRef === lastSaved` guard skips it when nothing new is pending.
  useEffect(() => {
    const flush = () => {
      if (textRef.current === lastSaved.current) return;
      const body = JSON.stringify({ text: textRef.current });
      markSaved(textRef.current);
      // Raw keepalive `fetch` (not the react-query mutation) so the write
      // outlives an unload; `$url` resolves because the client base is
      // origin-anchored (see api-client.ts).
      const url = api.activities[":activityId"]["my-record"].parts[":partId"].reflection.$url({
        param: { activityId, partId: part.id },
      });
      // A failed last-ditch flush is intentionally non-fatal: the next mount
      // re-reads persisted state, so there's nothing to recover here.
      void fetch(url, {
        method: "PUT",
        credentials: "include",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body,
      }).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [activityId, part.id, markSaved]);

  const dirty = text !== lastSaved.current;
  const status = deriveSaveStatus({
    isError: save.isError,
    isPending: save.isPending,
    dirty,
    isSuccess: save.isSuccess,
  });

  const words = countWords(text);
  const count = wordCountLabel(words, part.minWords);

  return (
    <div className="flex flex-col gap-3">
      <Prompt prompt={part.prompt} />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={part.placeholder ?? "Write freely…"}
        aria-label="Your reflection"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[0.6875rem]",
              count.met ? "text-[var(--color-good)]" : "text-[var(--color-ink-2)]",
            )}
          >
            {count.met ? <Check size={12} strokeWidth={2.25} aria-hidden="true" /> : null}
            {count.text}
            {count.met ? <span className="sr-only"> — suggested minimum met</span> : null}
          </span>
          <SaveIndicator status={status} onRetry={() => persist(text)} />
        </div>
      </div>
    </div>
  );
}
