import {
  countWords,
  type PartProgressState,
  type VisibilityPreference,
  type WriteReflectionPart,
} from "@hearth/domain";
import { cn, SaveIndicator, type SaveStatus, Textarea } from "@hearth/ui";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSaveReflection } from "../../../../hooks/use-activity-record.ts";
import { useDebouncedValue } from "../../../../hooks/use-debounced-value.ts";
import { asUserMessage } from "../../../../lib/problem.ts";
import { VisibilitySelector } from "../visibility-selector.tsx";

type Props = {
  readonly activityId: string;
  readonly part: WriteReflectionPart;
  readonly partState: PartProgressState | null;
  readonly canParticipate: boolean;
  readonly visibilityOverride: VisibilityPreference | null;
};

function Prompt({ prompt }: { readonly prompt: string }) {
  return (
    <p className="whitespace-pre-wrap text-[15px] text-[var(--color-ink)] leading-relaxed [font-family:var(--font-serif)]">
      {prompt}
    </p>
  );
}

export function ReflectPart({
  activityId,
  part,
  partState,
  canParticipate,
  visibilityOverride,
}: Props) {
  const initialText = partState?.kind === "write_reflection" ? partState.text : "";

  if (!canParticipate) {
    return (
      <div className="flex flex-col gap-3">
        <Prompt prompt={part.prompt} />
        {initialText ? (
          <p className="whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[13px] text-[var(--color-ink)] leading-relaxed">
            {initialText}
          </p>
        ) : (
          <p className="text-[13px] text-[var(--color-ink-2)]">
            Only enrolled participants can write a reflection here.
          </p>
        )}
      </div>
    );
  }

  // Keyed on the resolved record state at the call site, so this mounts with
  // the correct initial text and `useState` initialization is sound.
  return (
    <ReflectEditor
      activityId={activityId}
      part={part}
      initialText={initialText}
      visibilityOverride={visibilityOverride}
    />
  );
}

function ReflectEditor({
  activityId,
  part,
  initialText,
  visibilityOverride,
}: {
  readonly activityId: string;
  readonly part: WriteReflectionPart;
  readonly initialText: string;
  readonly visibilityOverride: VisibilityPreference | null;
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

  // Debounced autosave: persist only after typing pauses, and never re-save
  // an unchanged value. Failures keep a persistent indicator but only toast
  // once per failure burst (offline shouldn't spam).
  useEffect(() => {
    if (debounced === lastSaved.current) return;
    const pending = debounced;
    saveMutate(
      { partId: part.id, text: pending },
      {
        onSuccess: () => {
          lastSaved.current = pending;
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
  }, [debounced, part.id, saveMutate]);

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
      lastSaved.current = textRef.current;
      void fetch(`/api/v1/activities/${activityId}/my-record/parts/${part.id}/reflection`, {
        method: "PUT",
        credentials: "include",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body,
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [activityId, part.id]);

  const dirty = text !== lastSaved.current;
  const status: SaveStatus = save.isError
    ? "error"
    : save.isPending || dirty
      ? "saving"
      : save.isSuccess
        ? "saved"
        : "idle";

  const words = countWords(text);
  const meetsMin = part.minWords === undefined || words >= part.minWords;

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
              "text-[11px]",
              part.minWords !== undefined && meetsMin
                ? "text-[var(--color-good)]"
                : "text-[var(--color-ink-2)]",
            )}
          >
            {part.minWords !== undefined
              ? `${words} / ${part.minWords} words`
              : `${words} ${words === 1 ? "word" : "words"}`}
          </span>
          <SaveIndicator status={status} onRetry={() => save.mutate({ partId: part.id, text })} />
        </div>
        <VisibilitySelector activityId={activityId} value={visibilityOverride} />
      </div>
    </div>
  );
}
