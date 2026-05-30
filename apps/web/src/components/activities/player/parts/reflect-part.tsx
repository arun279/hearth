import { countWords, type PartProgressState, type WriteReflectionPart } from "@hearth/domain";
import type { VisibilityPreference } from "@hearth/domain/visibility";
import { Textarea } from "@hearth/ui";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  useSavePartProgress,
  useSetRecordVisibility,
} from "../../../../hooks/use-activity-record.ts";
import { useDebouncedCallback } from "../../../../hooks/use-debounced-callback.ts";
import { PartCompleteButton } from "../part-complete-button.tsx";
import { SaveIndicator, type SaveStatus } from "../save-indicator.tsx";
import { VisibilitySelector } from "../visibility-selector.tsx";

const AUTOSAVE_DELAY_MS = 800;
const SAVE_FAIL_TOAST = "reflection-save-failed";

/**
 * Reflection Part: a serif prompt over an autosaving textarea, with the
 * record-level Visibility selector beside it and an honor-system complete
 * control below. `minWords` is an advisory nudge — the meter turns green at the
 * threshold but never blocks; per the domain framing, an activity is an
 * invitation to participate, not a gate.
 */
export function ReflectPart({
  activityId,
  part,
  progress,
  recordId,
  visibility,
  canEdit,
  lockReason,
}: {
  readonly activityId: string;
  readonly part: WriteReflectionPart;
  readonly progress: PartProgressState | null;
  readonly recordId: string | null;
  readonly visibility: VisibilityPreference;
  readonly canEdit: boolean;
  readonly lockReason: string | null;
}) {
  const savedText = progress?.kind === "write_reflection" ? progress.text : "";
  const completed = progress?.kind === "write_reflection" ? progress.completed : false;
  const [text, setText] = useState(savedText);
  const save = useSavePartProgress(activityId);
  const visibilityMutation = useSetRecordVisibility(activityId);

  // Autosave reads the server-authoritative `completed` flag through a ref, so a
  // debounced text-save that fires *after* the participant flips completion can
  // never silently revert it — both writers target the same Part Progress row.
  const completedRef = useRef(completed);
  completedRef.current = completed;

  const persist = useDebouncedCallback((next: string) => {
    save.mutate(
      {
        partId: part.id,
        state: { kind: "write_reflection", completed: completedRef.current, text: next },
      },
      {
        onError: () => toast.error("Couldn't save your reflection.", { id: SAVE_FAIL_TOAST }),
      },
    );
  }, AUTOSAVE_DELAY_MS);

  const words = countWords(text);
  const status: SaveStatus = save.isPending
    ? "saving"
    : save.isError
      ? "error"
      : save.isSuccess
        ? "saved"
        : "idle";

  return (
    <div className="max-w-2xl space-y-4">
      <p className="font-serif text-[18px] text-[var(--color-ink-1)] leading-snug">{part.prompt}</p>

      <Textarea
        rows={8}
        aria-label="Your reflection"
        placeholder={part.placeholder ?? "Write your reflection…"}
        value={text}
        disabled={!canEdit}
        onChange={(e) => {
          setText(e.target.value);
          persist(e.target.value);
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--color-ink-2)]">
          {part.minWords !== undefined ? (
            <span className={words >= part.minWords ? "text-[var(--color-good)]" : undefined}>
              {words} / {part.minWords} words
            </span>
          ) : (
            `${words} ${words === 1 ? "word" : "words"}`
          )}
        </span>
        <SaveIndicator status={status} onRetry={() => persist(text)} />
      </div>

      <VisibilitySelector
        recordId={recordId}
        value={visibility}
        disabled={!canEdit || visibilityMutation.isPending}
        onChange={(next) => {
          if (recordId === null) return;
          visibilityMutation.mutate(
            { recordId, override: next === "default" ? null : next },
            { onError: () => toast.error("Couldn't update visibility.") },
          );
        }}
      />

      <div className="border-[var(--color-rule)] border-t pt-4">
        <PartCompleteButton
          completed={completed}
          disabled={!canEdit}
          pending={save.isPending}
          hint={lockReason ?? undefined}
          onToggle={() =>
            save.mutate(
              { partId: part.id, state: { kind: "write_reflection", completed: !completed, text } },
              { onError: () => toast.error("Couldn't update completion.") },
            )
          }
        />
      </div>
    </div>
  );
}
