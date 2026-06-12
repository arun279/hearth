import {
  type ActivityAudience,
  type ActivityFlow,
  type ActivityPart,
  type ActivityPartKind,
  type ActivityWindow,
  type CompletionRule,
  type LearningActivity,
  type LibraryDisplayKind,
  MAX_LONG_TEXT_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_QUIZ_OPTION_TEXT,
  MAX_QUIZ_OPTIONS_PER_QUESTION,
  MAX_QUIZ_QUESTIONS,
  MAX_TITLE_LENGTH,
  type PostClosePolicy,
  type QuizPart,
  type QuizQuestion,
  type UserId,
} from "@hearth/domain";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  cn,
  Field,
  IconButton,
  Input,
  Modal,
  PartIcon,
  partKindLabel,
  RadioGroup,
  type RadioOption,
  Textarea,
} from "@hearth/ui";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ActivityComposerPayload, ActivityListItem } from "../../hooks/use-activities.ts";
import { useLibraryList } from "../../hooks/use-library.ts";
import { useTrackPeople } from "../../hooks/use-tracks.ts";
import { asUserMessage } from "../../lib/problem.ts";

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly trackId: string;
  /**
   * Track's parent group id — needed by the Library Item picker inside
   * the read/listen/watch Part bodies. Library Items are group-scoped,
   * not track-scoped.
   */
  readonly groupId: string;
  /** Existing same-track activities (for the cross-activity prereq picker). */
  readonly siblings: readonly ActivityListItem[];
  /** When set, the dialog renders in edit mode against this activity. */
  readonly activity: LearningActivity | null;
  readonly onSubmit: (payload: ActivityComposerPayload) => Promise<LearningActivity>;
  /**
   * Optional Delete button rendered to the LEFT of Cancel/Save in the
   * footer. Edit mode passes one in; create mode leaves it absent.
   * Keeping this as a slot lets the parent own the destructive
   * confirmation flow without the composer reaching for the deps that
   * trigger it.
   */
  readonly deleteSlot?: ReactNode;
};

/**
 * Identifies a Part-internal field that can gate a save, so the composer can
 * bind the error to that specific input rather than the whole Part. Today the
 * only field-bound Part gate is a quiz short-answer question's correct-answer
 * input (the alsoAccept-without-correctAnswer coherence refine).
 */
type PartFieldLocator = { readonly kind: "quiz-correct-answer"; readonly questionIndex: number };

/**
 * A submit-time validation failure, bound to the field that gates it so the
 * composer can scroll the field into view, outline it, and link an inline
 * message via `aria-describedby` (WCAG 3.3.1 / 3.3.3). A Part-level failure
 * carries the offending Part's index; when an inner field gates it, the
 * optional `field` locator narrows the binding to that input.
 */
type SubmitError =
  | { readonly target: "title"; readonly message: string }
  | { readonly target: "audience"; readonly message: string }
  | { readonly target: "parts"; readonly message: string }
  | { readonly target: "post-close"; readonly message: string }
  | {
      readonly target: "part";
      readonly partIndex: number;
      readonly field?: PartFieldLocator;
      readonly message: string;
    };

type SubmitErrorAnchor =
  | "title"
  | "audience"
  | "parts"
  | "post-close"
  | `part-${number}`
  | `part-${number}-quiz-correct-answer-${number}`;

function anchorKeyFor(error: SubmitError): SubmitErrorAnchor {
  if (error.target !== "part") return error.target;
  if (error.field?.kind === "quiz-correct-answer") {
    return `part-${error.partIndex}-quiz-correct-answer-${error.field.questionIndex}`;
  }
  return `part-${error.partIndex}`;
}

/** The inline message for a non-Part gate, or undefined when the active
 * error targets a different field. */
function errorFor(
  error: SubmitError | null,
  target: "title" | "audience" | "post-close",
): string | undefined {
  return error?.target === target ? error.message : undefined;
}

/**
 * Label text with a bold required asterisk and a "Required" pill, so the
 * requirement is discoverable before the user clicks Save rather than only
 * after the submit bounce (Nielsen #5 error prevention; WCAG 3.3.2). The
 * marks are `aria-hidden`; AT learns the requirement from the input's HTML
 * `required` attribute instead, keeping the field's accessible name stable.
 */
function RequiredLabel({ children }: { readonly children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>
        {children}
        <span aria-hidden="true" className="ml-0.5 font-bold text-[var(--color-danger)]">
          *
        </span>
      </span>
      <span
        aria-hidden="true"
        className="rounded-full bg-[var(--color-danger-soft)] px-1.5 py-px font-medium text-[10px] text-[var(--color-danger)] normal-case tracking-normal"
      >
        Required
      </span>
    </span>
  );
}

type Draft = {
  title: string;
  description: string;
  parts: ActivityPart[];
  hardEdges: Array<{ fromPartId: string; toPartId: string }>;
  audienceKind: ActivityAudience["kind"];
  /**
   * Selected userIds when `audienceKind === "subset"`. A Set keeps the
   * checkbox-toggle handlers cheap and prevents duplicate ids from
   * sneaking in if a roster row is rendered twice. The serializer
   * filters this against the visible roster so departed enrollees
   * cannot ride along into a save.
   */
  selectedUserIds: ReadonlySet<string>;
  opensAt: string;
  dueAt: string;
  closesAt: string;
  postClose: PostClosePolicy["kind"] | null;
  completionRule: CompletionRule["kind"];
  /**
   * Same-track activities the facilitator has chosen to require before
   * this one (`hard` cross-activity edges). Multi-select via checkbox
   * list — the API stores an array, so a single-pick UI would silently
   * drop existing edges on edit.
   */
  selectedPrereqIds: ReadonlySet<string>;
  /** Soft suggested-sequence picks ("after this, learners often go to…"). */
  selectedSuggestedIds: ReadonlySet<string>;
};

/**
 * Part kinds the composer offers. The full domain catalog (in
 * `ACTIVITY_PART_KINDS`) lists 7 kinds; `attend_session` is held back
 * because it needs the Sessions surface to pick a `studySessionId`
 * from — until then we hide it from the palette so no facilitator can
 * author an unsavable Part. The discriminated-union schema keeps that
 * variant intact for when the Sessions surface lands.
 */
const AUTHORABLE_PART_KINDS = [
  "read_library_item",
  "listen_audio",
  "watch_video",
  "write_reflection",
  "quiz",
  "embed",
] as const satisfies readonly ActivityPartKind[];

type AuthorablePartKind = (typeof AUTHORABLE_PART_KINDS)[number];

/**
 * TODO(m19): restructure as five-tab dialog (`Parts | Flow | Audience
 * | Window | Completion`) — the long-scroll shape works today with the
 * Modal primitive's sticky footer, but quiz authoring's per-question
 * density pushes the Parts section toward the point where tabs earn
 * their keep. M19 owns composer reorder/tab polish (it enables a
 * dnd-kit KeyboardSensor on the Activity Composer Parts list), so the
 * tab set is sized once there against the full section roster — with
 * M11 (the dependency that makes the Flow tab worth sizing) landed.
 *
 * TODO(m11): the Draft state carries `hardEdges` (the intra-Part
 * `flow.prereqs[]` projection) and the serializer round-trips them,
 * but no UI exposes wiring an edge between two Parts. The schema
 * supports it; M8 simply ships no Flow editor. M11 is the consumer of
 * `flow.prereqs[]`: `canMarkPartComplete` rejects `prereq_not_met`, and
 * the PartFooter Mark Complete control disables when prereqs are unmet
 * — without that consumer, a Flow editor would write data nothing
 * reads. Wire the editor as a sibling section / tab when M11 lands.
 *
 * Compose or edit a Learning Activity. The dialog mirrors the design
 * prototype: a single scrolled modal with discrete sections (Parts /
 * Audience / Window / Completion / Cross-activity dependencies). Arrow
 * buttons reorder Parts in-place; saving sends a structured payload to
 * the API which validates the same Zod schemas the SPA uses for
 * inline checks.
 *
 * Mobile rendering: the shared `<Modal size="lg">` collapses to
 * `w-full` below the 720px breakpoint and the form's two- and
 * three-column grids fall back to single-column at `sm`. On a 375px
 * viewport the composer renders as a full-bleed scrolled column —
 * functionally equivalent to a bottom-anchored sheet for an authoring
 * surface this complex (a sheet pattern reads as ergonomic only on
 * short forms; this composer is seven sections deep). The prototype
 * uses the same wide-dialog shape across viewport widths.
 *
 * Part `id`s are minted client-side at the moment a Part is added so
 * reorders within a session don't churn ids — M11's
 * `part_progress.partId` references are stable across edits.
 */
export function ActivityComposer({
  open,
  onClose,
  trackId,
  groupId,
  siblings,
  activity,
  onSubmit,
  deleteSlot,
}: Props) {
  const initial = useMemo(() => buildDraft(activity), [activity]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<SubmitError | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  // Each gating field registers a scroll anchor here so a submit error can
  // bring the offending field into view inside the modal's scrollable body
  // (a Save click from scrollTop=0 otherwise leaves the field off-screen,
  // giving the user no signal about what to fix). Per-Part anchors are keyed
  // by Part index since Parts are dynamic.
  const fieldAnchors = useRef(new Map<SubmitErrorAnchor, HTMLElement | null>());
  const registerAnchor = (key: SubmitErrorAnchor) => (el: HTMLElement | null) => {
    fieldAnchors.current.set(key, el);
  };
  useEffect(() => {
    if (!error) return;
    const anchor = fieldAnchors.current.get(anchorKeyFor(error));
    anchor?.scrollIntoView({ block: "center", behavior: "smooth" });
    anchor
      ?.querySelector<HTMLElement>("input, select, textarea, [tabindex]")
      ?.focus({ preventScroll: true });
  }, [error]);

  useEffect(() => {
    if (open) {
      setDraft(initial);
      setError(null);
      setDiscardConfirmOpen(false);
    }
  }, [open, initial]);

  // The submit handler is the only writer of `error`; any draft mutation
  // is a user-input event (open-reset clears `error` first, so the dep
  // firing on initial mount is a no-op). Clearing on draft change keeps
  // the field-bound error tied to its gating value: once the user has
  // edited past the named field, the message disappears.
  useEffect(() => {
    if (error !== null) setError(null);
  }, [draft]);

  // Dirty when the in-flight draft has diverged from the initial seed.
  // A reference equality check on `draft` vs. `initial` is too tight (any
  // setDraft call breaks identity), so compare the structural content via
  // JSON. ReadonlySet -> Array conversion happens once per re-render via
  // `serializeDraftForDirtyCheck` so the JSON is stable across reorders.
  const isDirty = useMemo(
    () =>
      JSON.stringify(serializeDraftForDirtyCheck(draft)) !==
      JSON.stringify(serializeDraftForDirtyCheck(initial)),
    [draft, initial],
  );

  const close = () => {
    if (submitting) return;
    if (isDirty) {
      // Esc / overlay click / Cancel all route through `close`. When
      // dirty, intercept and confirm before discarding minutes of
      // authoring work — Nielsen #3 "User control and freedom",
      // Shneiderman #6 "Easy reversal." Pristine composers still close
      // instantly so friction stays proportional to consequence.
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  };

  const confirmDiscard = () => {
    setDiscardConfirmOpen(false);
    onClose();
  };

  const addPart = (kind: AuthorablePartKind) => {
    setDraft((d) => ({ ...d, parts: [...d.parts, blankPart(kind)] }));
  };
  const removePart = (idx: number) =>
    setDraft((d) => ({
      ...d,
      parts: d.parts.filter((_, i) => i !== idx),
      hardEdges: d.hardEdges.filter(
        (e) => e.fromPartId !== d.parts[idx]?.id && e.toPartId !== d.parts[idx]?.id,
      ),
    }));
  const movePart = (idx: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = idx + dir;
      if (j < 0 || j >= d.parts.length) return d;
      const next = d.parts.slice();
      const tmp = next[idx];
      const other = next[j];
      if (!tmp || !other) return d;
      next[idx] = other;
      next[j] = tmp;
      return { ...d, parts: next };
    });
  const updatePart = (idx: number, patch: Partial<ActivityPart>) =>
    setDraft((d) => ({
      ...d,
      parts: d.parts.map((p, i) => (i === idx ? ({ ...p, ...patch } as ActivityPart) : p)),
    }));

  const submit = async () => {
    setError(null);
    if (draft.title.trim().length === 0) {
      setError({ target: "title", message: "Give the activity a title." });
      return;
    }
    if (draft.parts.length === 0) {
      setError({ target: "parts", message: "Add at least one Activity Part." });
      return;
    }
    const incompletePart = findIncompletePart(draft.parts);
    if (incompletePart) {
      setError({
        target: "part",
        partIndex: incompletePart.partIndex,
        field: incompletePart.field,
        message: incompletePart.message,
      });
      return;
    }
    if (draft.audienceKind === "subset" && draft.selectedUserIds.size === 0) {
      // Mirror of the server-side `audience_user_not_enrolled` check —
      // catching the empty-subset case at submit avoids a round trip
      // for a state the user can fix from the picker right above.
      setError({
        target: "audience",
        message: "Pick at least one participant or switch back to Everyone enrolled.",
      });
      return;
    }
    if (draft.closesAt.length > 0 && draft.postClose === null) {
      setError({
        target: "post-close",
        message: "Pick what happens at close — visible, locked, or hidden.",
      });
      return;
    }
    const payload: ActivityComposerPayload = serializeDraft(draft, trackId);
    setSubmitting(true);
    try {
      await onSubmit(payload);
      toast.success(activity ? "Activity updated." : "Activity created.");
      onClose();
    } catch (err) {
      // A server-side rejection isn't bound to a single field, so it
      // surfaces on the Parts section anchor (where most validation
      // failures originate) as a danger Callout.
      setError({ target: "parts", message: asUserMessage(err, "Couldn't save the activity.") });
    } finally {
      setSubmitting(false);
    }
  };

  const otherSiblings = siblings.filter((s) => s.id !== activity?.id);

  // The discard-confirm Modal is rendered as a SIBLING of the parent
  // composer Modal (not nested inside its body). Two stacked modals
  // share the same z-50 fixed-position layer; nesting the confirm
  // inside the parent's overflow-y-auto body would clip its
  // `position: fixed` to the parent panel's bounds, leaving Cancel /
  // Discard unclickable. The dialog-keyboard hook tracks topmost
  // panels independently, so Esc on the confirm closes it (not the
  // parent), and clicks on the parent's scrim are inerted while the
  // confirm is open.
  return (
    <>
      <Modal
        open={open}
        onClose={close}
        size="lg"
        title={activity ? "Edit activity" : "New activity"}
        description={
          activity
            ? "Reordering Parts is safe — completed Part Progress is preserved across edits."
            : "Compose an activity from one or more built-in Parts. Save to publish to the track."
        }
        footer={
          <>
            {deleteSlot ? (
              // Asymmetric footer per Shneiderman #5/#6: destructive
              // affordances stay distant from the primary "Save"
              // button. Pushing Delete to the leading edge avoids
              // muscle-memory mistakes while keeping the dialog single-row.
              <div className="mr-auto">{deleteSlot}</div>
            ) : null}
            <Button variant="secondary" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={submit}
              // Stays enabled even when the form is incomplete: clicking
              // surfaces the specific missing field via `setError(...)`
              // above. A silent disabled CTA reads as "the system is
              // broken" before "I forgot a field" — Nielsen #1 + #5.
              disabled={submitting}
            >
              {submitting ? "Saving…" : activity ? "Save changes" : "Create activity"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div ref={registerAnchor("title")}>
            <Field label={<RequiredLabel>Title</RequiredLabel>} error={errorFor(error, "title")}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={error?.target === "title"}
                  required
                  maxLength={MAX_TITLE_LENGTH}
                  placeholder="e.g., Greetings & introductions"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  disabled={submitting}
                />
              )}
            </Field>
          </div>

          <Field label="Description" hint="Optional — a sentence on what the activity is about.">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={2}
                maxLength={MAX_LONG_TEXT_LENGTH}
                placeholder="e.g., Read the primer, listen to the dialogue, write a short reflection."
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                disabled={submitting}
              />
            )}
          </Field>

          <PartsEditor
            groupId={groupId}
            parts={draft.parts}
            onAdd={addPart}
            onRemove={removePart}
            onMove={movePart}
            onUpdate={updatePart}
            disabled={submitting}
            error={error}
            registerAnchor={registerAnchor}
          />

          <AudienceFields
            trackId={trackId}
            audienceKind={draft.audienceKind}
            selectedUserIds={draft.selectedUserIds}
            onAudienceKindChange={(kind) => setDraft((d) => ({ ...d, audienceKind: kind }))}
            onToggleUser={(userId) =>
              setDraft((d) => {
                const next = new Set(d.selectedUserIds);
                if (next.has(userId)) {
                  next.delete(userId);
                } else {
                  next.add(userId);
                }
                return { ...d, selectedUserIds: next };
              })
            }
            disabled={submitting}
            error={errorFor(error, "audience")}
            registerAnchor={registerAnchor("audience")}
          />

          <WindowFields
            opensAt={draft.opensAt}
            dueAt={draft.dueAt}
            closesAt={draft.closesAt}
            postClose={draft.postClose}
            onChange={(w) => setDraft((d) => ({ ...d, ...w }))}
            disabled={submitting}
            error={errorFor(error, "post-close")}
            registerAnchor={registerAnchor("post-close")}
          />

          <Field
            label="Completion rule"
            hint="Honor-system is the v1 default. Auto-complete fires when every Part is marked done."
          >
            {({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-rule)] bg-[var(--color-bg)] px-3 text-[13px]"
                value={draft.completionRule}
                disabled={submitting}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    completionRule: e.target.value as CompletionRule["kind"],
                  }))
                }
              >
                <option value="manual_mark">Honor-system — learner marks complete</option>
                <option value="all_parts_complete">Auto — all Parts marked complete</option>
              </select>
            )}
          </Field>

          <CrossActivityFields
            siblings={otherSiblings}
            prereqIds={draft.selectedPrereqIds}
            suggestedIds={draft.selectedSuggestedIds}
            onTogglePrereq={(id) =>
              setDraft((d) => ({ ...d, selectedPrereqIds: toggleInSet(d.selectedPrereqIds, id) }))
            }
            onToggleSuggested={(id) =>
              setDraft((d) => ({
                ...d,
                selectedSuggestedIds: toggleInSet(d.selectedSuggestedIds, id),
              }))
            }
            disabled={submitting}
          />
        </div>
      </Modal>
      <Modal
        open={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        size="sm"
        tone="danger"
        title="Discard your changes?"
        description="The composer has unsaved edits. Discarding closes the dialog and throws them away — this can't be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiscardConfirmOpen(false)}>
              Keep editing
            </Button>
            <Button variant="danger" onClick={confirmDiscard}>
              Discard
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </>
  );
}

function PartsEditor({
  groupId,
  parts,
  onAdd,
  onRemove,
  onMove,
  onUpdate,
  disabled,
  error,
  registerAnchor,
}: {
  readonly groupId: string;
  readonly parts: readonly ActivityPart[];
  readonly onAdd: (kind: AuthorablePartKind) => void;
  readonly onRemove: (idx: number) => void;
  readonly onMove: (idx: number, dir: -1 | 1) => void;
  readonly onUpdate: (idx: number, patch: Partial<ActivityPart>) => void;
  readonly disabled: boolean;
  readonly error: SubmitError | null;
  readonly registerAnchor: (key: SubmitErrorAnchor) => (el: HTMLElement | null) => void;
}) {
  // "parts" carries both the empty-Parts gate and a server-side save
  // rejection (which isn't tied to a single field); both surface as a
  // danger Callout at the section head.
  const sectionError = error?.target === "parts" ? error.message : undefined;
  return (
    <div ref={registerAnchor("parts")}>
      <Field
        label="Activity Parts"
        hint="Reorder is safe — completed Part Progress is preserved across edits."
      >
        {() => (
          <>
            {sectionError ? (
              <Callout tone="danger" className="mb-2">
                {sectionError}
              </Callout>
            ) : null}
            <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-rule)]">
              {parts.length === 0 ? (
                <div className="px-3 py-4 text-[12px] text-[var(--color-ink-3)]">
                  No Parts yet. Add one from the palette below.
                </div>
              ) : (
                parts.map((part, i) => (
                  <PartRow
                    key={part.id}
                    groupId={groupId}
                    part={part}
                    index={i}
                    isFirst={i === 0}
                    isLast={i === parts.length - 1}
                    onRemove={() => onRemove(i)}
                    onMoveUp={() => onMove(i, -1)}
                    onMoveDown={() => onMove(i, 1)}
                    onUpdate={(patch) => onUpdate(i, patch)}
                    disabled={disabled}
                    partError={error?.target === "part" && error.partIndex === i ? error : null}
                    anchorRef={registerAnchor(`part-${i}`)}
                    registerAnchor={registerAnchor}
                  />
                ))
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {AUTHORABLE_PART_KINDS.map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onAdd(kind)}
                >
                  <Plus size={11} strokeWidth={1.75} aria-hidden="true" />
                  <PartIcon kind={kind} size={11} />
                  {partKindLabel(kind)}
                </Button>
              ))}
            </div>
          </>
        )}
      </Field>
    </div>
  );
}

function PartRow({
  groupId,
  part,
  index,
  isFirst,
  isLast,
  onRemove,
  onMoveUp,
  onMoveDown,
  onUpdate,
  disabled,
  partError,
  anchorRef,
  registerAnchor,
}: {
  readonly groupId: string;
  readonly part: ActivityPart;
  readonly index: number;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly onRemove: () => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onUpdate: (patch: Partial<ActivityPart>) => void;
  readonly disabled: boolean;
  readonly partError: Extract<SubmitError, { target: "part" }> | null;
  readonly anchorRef: (el: HTMLElement | null) => void;
  readonly registerAnchor: (key: SubmitErrorAnchor) => (el: HTMLElement | null) => void;
}) {
  // A field-bound error renders inline at the gating input (and outlines it);
  // a Part-scoped error with no field locator renders once at the row foot.
  const error = partError !== null;
  const fieldError = partError?.field ?? null;
  const rowMessage = partError && !partError.field ? partError.message : null;
  const errorId = rowMessage ? `part-${part.id}-error` : undefined;
  return (
    <div
      ref={anchorRef}
      className={cn(
        "space-y-2 border-[var(--color-rule)] border-b px-3 py-3 last:border-b-0",
        error && "bg-[var(--color-danger-soft)] outline outline-[var(--color-danger-border)]",
      )}
    >
      {/* The Part number, kind, and reorder/remove controls share one
       * header line. Folding them here (rather than fixed-width gutter +
       * controls columns flanking the body) frees the full row width for
       * the body, so quiz answer-key Inputs stay editable down to 320px.
       * The controls cluster wraps under the label at the narrowest widths
       * via `flex-wrap` rather than starving the body. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={cn(
            "font-mono text-[11px]",
            // ink-3 fails WCAG 1.4.3 on danger-soft; the error row uses
            // ink-2 (which passes) so the index stays legible when tinted.
            error ? "text-[var(--color-ink-2)]" : "text-[var(--color-ink-3)]",
          )}
        >
          {index + 1}
        </span>
        <PartIcon kind={part.kind} size={12} className="text-[var(--color-ink-2)]" />
        <Badge>{partKindLabel(part.kind)}</Badge>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {/*
           * TODO(m19): add a drag handle via `@dnd-kit/sortable` at
           * M19 polish. Keep the arrow buttons as the keyboard-
           * accessible fallback — drag handles alone fail Tab-only
           * users. Cost of arrow-only reorder scales as O(N) per move
           * (up to N-1 clicks to move an item across an N-Part list),
           * tolerable at the 3-4-Part case but rough at the schema's
           * MAX_PARTS_PER_ACTIVITY (50).
           */}
          <IconButton label="Move up" onClick={onMoveUp} disabled={disabled || isFirst}>
            <ArrowUp size={11} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
          <IconButton label="Move down" onClick={onMoveDown} disabled={disabled || isLast}>
            <ArrowDown size={11} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={`Remove Part ${index + 1}`}
            tone="danger"
            onClick={onRemove}
            disabled={disabled}
          >
            <X size={11} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <PartBody
        groupId={groupId}
        part={part}
        onUpdate={onUpdate}
        disabled={disabled}
        partIndex={index}
        fieldError={fieldError}
        fieldErrorMessage={partError?.field ? partError.message : null}
        registerAnchor={registerAnchor}
      />
      {rowMessage ? (
        <p id={errorId} role="alert" className="text-[12px] text-[var(--color-danger)]">
          {rowMessage}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Allowed display-kinds per Part kind — mirrors the server-side mime
 * gate in `assertPartLibraryRefMimeMatch`. Defining it here so the
 * SPA can pre-filter the picker rather than waiting for a 422.
 */
const PART_KIND_LIBRARY_FILTER: Partial<
  Record<ActivityPartKind, ReadonlyArray<LibraryDisplayKind>>
> = {
  read_library_item: ["pdf", "doc", "image", "other"],
  listen_audio: ["audio"],
  watch_video: ["video"],
};

function PartBody({
  groupId,
  part,
  onUpdate,
  disabled,
  partIndex,
  fieldError,
  fieldErrorMessage,
  registerAnchor,
}: {
  readonly groupId: string;
  readonly part: ActivityPart;
  readonly onUpdate: (patch: Partial<ActivityPart>) => void;
  readonly disabled: boolean;
  readonly partIndex: number;
  readonly fieldError: PartFieldLocator | null;
  readonly fieldErrorMessage: string | null;
  readonly registerAnchor: (key: SubmitErrorAnchor) => (el: HTMLElement | null) => void;
}) {
  switch (part.kind) {
    case "write_reflection":
      return (
        <Textarea
          rows={2}
          aria-label="Reflection prompt"
          placeholder="What did you notice about today's reading?"
          value={part.prompt}
          onChange={(e) => onUpdate({ prompt: e.target.value } as Partial<ActivityPart>)}
          disabled={disabled}
        />
      );
    case "embed":
      return <EmbedPartBody part={part} onUpdate={onUpdate} disabled={disabled} />;
    case "read_library_item":
    case "listen_audio":
    case "watch_video":
      return (
        <LibraryItemPickerBody
          groupId={groupId}
          part={part}
          onUpdate={onUpdate}
          disabled={disabled}
          allowedKinds={PART_KIND_LIBRARY_FILTER[part.kind] ?? []}
        />
      );
    case "attend_session":
      return (
        <p className="text-[11px] text-[var(--color-ink-3)]">
          Sessions ship in a follow-up milestone. Add this Part now and pick the session once the
          Sessions surface lands.
        </p>
      );
    case "quiz":
      return (
        <QuizPartBody
          part={part}
          onUpdate={onUpdate}
          disabled={disabled}
          partIndex={partIndex}
          fieldError={fieldError}
          fieldErrorMessage={fieldErrorMessage}
          registerAnchor={registerAnchor}
        />
      );
  }
}

/**
 * Embed Part body. Two interactive controls: a provider radio
 * (youtube / spotify / generic) so the player downstream knows which
 * iframe to mount, and the URL field. Everything else (start time,
 * title) is M19 polish.
 */
function EmbedPartBody({
  part,
  onUpdate,
  disabled,
}: {
  readonly part: Extract<ActivityPart, { kind: "embed" }>;
  readonly onUpdate: (patch: Partial<ActivityPart>) => void;
  readonly disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[11px] text-[var(--color-ink-2)]">
        {(["youtube", "spotify", "generic"] as const).map((provider) => (
          <label key={provider} className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name={`embed-provider-${part.id}`}
              value={provider}
              checked={part.provider === provider}
              disabled={disabled}
              onChange={() => onUpdate({ provider } as Partial<ActivityPart>)}
            />
            <span className="capitalize">{provider}</span>
          </label>
        ))}
      </div>
      <Input
        type="url"
        aria-label="Embed URL"
        placeholder="https://www.youtube.com/embed/…"
        value={part.url}
        onChange={(e) => onUpdate({ url: e.target.value } as Partial<ActivityPart>)}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * Quiz Part body. Authors an ordered list of questions, each either
 * multiple-choice or short-answer. Every mutation rebuilds the
 * `questions` array immutably and pushes it through the Part's
 * `onUpdate` so quiz edits flow through the same draft state the
 * dirty-check and serializer read.
 */
function QuizPartBody({
  part,
  onUpdate,
  disabled,
  partIndex,
  fieldError,
  fieldErrorMessage,
  registerAnchor,
}: {
  readonly part: Extract<ActivityPart, { kind: "quiz" }>;
  readonly onUpdate: (patch: Partial<ActivityPart>) => void;
  readonly disabled: boolean;
  readonly partIndex: number;
  readonly fieldError: PartFieldLocator | null;
  readonly fieldErrorMessage: string | null;
  readonly registerAnchor: (key: SubmitErrorAnchor) => (el: HTMLElement | null) => void;
}) {
  const setQuestions = (questions: QuizPart["questions"]) =>
    onUpdate({ questions } as Partial<ActivityPart>);
  const patchQuestion = (idx: number, next: QuizQuestion) =>
    setQuestions(part.questions.map((q, i) => (i === idx ? next : q)));
  const addQuestion = () => setQuestions([...part.questions, blankQuestion()]);
  const removeQuestion = (idx: number) => setQuestions(part.questions.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      {part.questions.map((question, i) => {
        const correctAnswerError =
          fieldError?.kind === "quiz-correct-answer" && fieldError.questionIndex === i
            ? fieldErrorMessage
            : null;
        return (
          <QuizQuestionEditor
            key={question.id}
            question={question}
            index={i}
            total={part.questions.length}
            onChange={(next) => patchQuestion(i, next)}
            onRemove={() => removeQuestion(i)}
            disabled={disabled}
            correctAnswerError={correctAnswerError}
            correctAnswerAnchor={registerAnchor(`part-${partIndex}-quiz-correct-answer-${i}`)}
          />
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || part.questions.length >= MAX_QUIZ_QUESTIONS}
        onClick={addQuestion}
      >
        <Plus size={11} strokeWidth={1.75} aria-hidden="true" />
        Add question
      </Button>
    </div>
  );
}

const QUIZ_SHAPE_OPTIONS: ReadonlyArray<RadioOption<"multiple_choice" | "short_answer">> = [
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "short_answer", label: "Short answer" },
];

function QuizQuestionEditor({
  question,
  index,
  total,
  onChange,
  onRemove,
  disabled,
  correctAnswerError,
  correctAnswerAnchor,
}: {
  readonly question: QuizQuestion;
  readonly index: number;
  readonly total: number;
  readonly onChange: (next: QuizQuestion) => void;
  readonly onRemove: () => void;
  readonly disabled: boolean;
  readonly correctAnswerError: string | null;
  readonly correctAnswerAnchor: (el: HTMLElement | null) => void;
}) {
  // Switching shape swaps the variant payload to a blank of the target
  // kind so no stale answer key rides along on the wire — an MC's
  // options + answerKeyIndex would be meaningless under short_answer
  // and vice versa. The short_answer seed leaves `correctAnswer`
  // undefined (ungraded by default).
  const setShape = (kind: "multiple_choice" | "short_answer") => {
    if (kind === question.shape.kind) return;
    onChange({
      ...question,
      shape:
        kind === "multiple_choice"
          ? { kind, options: ["", ""] }
          : { kind, alsoAccept: [], exactMatch: false },
    });
  };

  return (
    <div className="space-y-2.5 rounded-[var(--radius-sm)] border border-[var(--color-rule)] p-3">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 shrink-0 font-mono text-[11px] text-[var(--color-ink-3)]">
          Q{index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <Input
            aria-label={`Question ${index + 1} prompt`}
            placeholder="e.g., Which greeting is most formal?"
            maxLength={MAX_PROMPT_LENGTH}
            value={question.prompt}
            onChange={(e) => onChange({ ...question, prompt: e.target.value })}
            disabled={disabled}
          />
        </div>
        <IconButton
          label={`Remove question ${index + 1}`}
          tone="danger"
          onClick={onRemove}
          disabled={disabled || total <= 1}
        >
          <X size={11} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      </div>

      <RadioGroup
        legend={`Question ${index + 1} type`}
        legendHidden
        name={`quiz-shape-${question.id}`}
        value={question.shape.kind}
        onValueChange={setShape}
        options={QUIZ_SHAPE_OPTIONS}
        disabled={disabled}
        className="sm:flex-row sm:gap-2"
      />

      {question.shape.kind === "multiple_choice" ? (
        <QuizOptionsEditor
          questionId={question.id}
          questionIndex={index}
          options={question.shape.options}
          answerKeyIndex={question.shape.answerKeyIndex}
          onChange={(options, answerKeyIndex) =>
            onChange({
              ...question,
              shape: { kind: "multiple_choice", options, answerKeyIndex },
            })
          }
          disabled={disabled}
        />
      ) : (
        <ShortAnswerKeyEditor
          questionId={question.id}
          shape={question.shape}
          onChange={(shape) => onChange({ ...question, shape })}
          disabled={disabled}
          correctAnswerError={correctAnswerError}
          correctAnswerAnchor={correctAnswerAnchor}
        />
      )}

      <Field label="Explanation" hint="Optional — shown after the learner answers.">
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            rows={2}
            maxLength={MAX_PROMPT_LENGTH}
            placeholder="e.g., “Buenos días” is the formal daytime greeting."
            value={question.explainAfterAnswer ?? ""}
            onChange={(e) =>
              onChange({
                ...question,
                explainAfterAnswer: e.target.value.length > 0 ? e.target.value : undefined,
              })
            }
            disabled={disabled}
          />
        )}
      </Field>
    </div>
  );
}

/**
 * Multiple-choice options list. Each row pairs a "mark correct" radio
 * (single-select `answerKeyIndex` across the question's options) with
 * the option text. Removing an option below the marked index shifts the
 * key so it keeps pointing at the same option; removing the marked
 * option itself clears the key. Add stays enabled up to the schema cap;
 * remove disables only at the two-option minimum.
 */
function QuizOptionsEditor({
  questionId,
  questionIndex,
  options,
  answerKeyIndex,
  onChange,
  disabled,
}: {
  readonly questionId: string;
  readonly questionIndex: number;
  readonly options: readonly string[];
  readonly answerKeyIndex: number | undefined;
  readonly onChange: (options: string[], answerKeyIndex: number | undefined) => void;
  readonly disabled: boolean;
}) {
  const keys = useStableRowKeys(questionId, options.length);

  const setOption = (idx: number, value: string) =>
    onChange(
      options.map((o, i) => (i === idx ? value : o)),
      answerKeyIndex,
    );
  const addOption = () => {
    keys.grow();
    onChange([...options, ""], answerKeyIndex);
  };
  const removeOption = (idx: number) => {
    keys.removeAt(idx);
    const next = options.filter((_, i) => i !== idx);
    const nextKey =
      answerKeyIndex === undefined || answerKeyIndex === idx
        ? undefined
        : answerKeyIndex > idx
          ? answerKeyIndex - 1
          : answerKeyIndex;
    onChange(next, nextKey);
  };

  return (
    <div className="space-y-1.5">
      <fieldset className="space-y-1.5" disabled={disabled}>
        <legend className="mb-1 block font-medium text-[11px] text-[var(--color-ink-2)] uppercase tracking-wide">
          Options · select the correct answer
        </legend>
        {/* Mirror the short-answer "leave blank to leave ungraded" affordance:
            without a keyed option the question still saves, but the player
            can't auto-grade it — say so where the choice is made. */}
        <p className="text-[11px] text-[var(--color-ink-2)] normal-case tracking-normal">
          Mark one option correct to auto-grade this question. Leave none selected to leave it
          ungraded.
        </p>
        {options.map((option, i) => (
          <div key={keys.at(i)} className="flex items-center gap-2">
            <input
              type="radio"
              name={`quiz-answer-${questionId}`}
              aria-label={`Mark option ${i + 1} correct`}
              checked={answerKeyIndex === i}
              disabled={disabled}
              onChange={() => onChange([...options], i)}
              className="h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
            />
            <Input
              aria-label={`Question ${questionIndex + 1} option ${i + 1}`}
              placeholder={`Option ${i + 1}`}
              maxLength={MAX_QUIZ_OPTION_TEXT}
              value={option}
              onChange={(e) => setOption(i, e.target.value)}
              disabled={disabled}
            />
            <IconButton
              label={`Remove option ${i + 1}`}
              tone="danger"
              onClick={() => removeOption(i)}
              disabled={disabled || options.length <= 2}
            >
              <X size={11} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          </div>
        ))}
        {/* Native radios don't un-check on re-click, so without this the
            "leave none selected to leave it ungraded" affordance is reachable
            only before the first pick — an author who keys a correct option by
            mistake (or changes their mind) couldn't get back to ungraded short
            of deleting the question. Shown only once a key is set. */}
        {answerKeyIndex !== undefined ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange([...options], undefined)}
            className="font-medium text-[11px] text-[var(--color-ink-2)] underline hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-60"
          >
            Clear correct answer (leave ungraded)
          </button>
        ) : null}
      </fieldset>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || options.length >= MAX_QUIZ_OPTIONS_PER_QUESTION}
        onClick={addOption}
      >
        <Plus size={11} strokeWidth={1.75} aria-hidden="true" />
        Add option
      </Button>
    </div>
  );
}

/**
 * Stable React keys for a positional list whose items carry no unique
 * value of their own (option / accepted-answer text isn't unique). Seeds
 * one key per current item, then mutates the key list in lockstep with the
 * caller's add/remove so a row keeps its identity across a sibling removal
 * — focus and the input's internal state survive instead of the list
 * shifting up under the cursor. The seed count must match the rows the
 * caller renders on first mount.
 */
function useStableRowKeys(prefix: string, count: number) {
  const next = useRef(0);
  const mint = () => `${prefix}-row-${next.current++}`;
  const [ids, setIds] = useState<string[]>(() => Array.from({ length: count }, mint));
  return {
    at: (i: number) => ids[i],
    grow: () => setIds((prev) => [...prev, mint()]),
    removeAt: (idx: number) => setIds((prev) => prev.filter((_, i) => i !== idx)),
  };
}

type ShortAnswerShape = Extract<QuizQuestion["shape"], { kind: "short_answer" }>;

/**
 * Short-answer answer-key authoring. A facilitator types one "Correct
 * answer" plus an optional list of accepted alternates (same row vocabulary
 * as the multiple-choice options editor), and one "Match exactly" toggle.
 * Grading is normalized set-membership equality — no pattern, no engine —
 * so the in-context note states in plain language what will count as
 * correct. Leaving the correct answer blank leaves the question ungraded.
 */
function ShortAnswerKeyEditor({
  questionId,
  shape,
  onChange,
  disabled,
  correctAnswerError,
  correctAnswerAnchor,
}: {
  readonly questionId: string;
  readonly shape: ShortAnswerShape;
  readonly onChange: (shape: ShortAnswerShape) => void;
  readonly disabled: boolean;
  readonly correctAnswerError: string | null;
  readonly correctAnswerAnchor: (el: HTMLElement | null) => void;
}) {
  const accepted = shape.alsoAccept;
  const keys = useStableRowKeys(`${questionId}-accept`, accepted.length);

  const setCorrect = (value: string) =>
    onChange({ ...shape, correctAnswer: value.length > 0 ? value : undefined });
  const setAccepted = (idx: number, value: string) =>
    onChange({ ...shape, alsoAccept: accepted.map((a, i) => (i === idx ? value : a)) });
  const addAccepted = () => {
    keys.grow();
    onChange({ ...shape, alsoAccept: [...accepted, ""] });
  };
  const removeAccepted = (idx: number) => {
    keys.removeAt(idx);
    onChange({ ...shape, alsoAccept: accepted.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-2.5">
      <div ref={correctAnswerAnchor}>
        <Field
          label="Correct answer"
          hint="What a learner should type. Leave blank to leave this question ungraded."
          error={correctAnswerError ?? undefined}
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={correctAnswerError !== null}
              placeholder="e.g., sí"
              maxLength={MAX_QUIZ_OPTION_TEXT}
              value={shape.correctAnswer ?? ""}
              onChange={(e) => setCorrect(e.target.value)}
              disabled={disabled}
            />
          )}
        </Field>
      </div>

      <div className="space-y-1.5">
        <span className="block font-medium text-[11px] text-[var(--color-ink-2)] uppercase tracking-wide">
          Also accept
        </span>
        {accepted.map((value, i) => (
          <div key={keys.at(i)} className="flex items-center gap-2">
            <Input
              aria-label={`Accepted answer ${i + 1}`}
              placeholder={`Accepted answer ${i + 1}`}
              maxLength={MAX_QUIZ_OPTION_TEXT}
              value={value}
              onChange={(e) => setAccepted(i, e.target.value)}
              disabled={disabled}
            />
            <IconButton
              label={`Remove accepted answer ${i + 1}`}
              tone="danger"
              onClick={() => removeAccepted(i)}
              disabled={disabled}
            >
              <X size={11} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || accepted.length >= MAX_QUIZ_OPTIONS_PER_QUESTION}
          onClick={addAccepted}
        >
          <Plus size={11} strokeWidth={1.75} aria-hidden="true" />
          Add accepted answer
        </Button>
      </div>

      <div className="space-y-1">
        <label className="flex items-center gap-2 text-[12px] text-[var(--color-ink)]">
          <input
            type="checkbox"
            checked={shape.exactMatch}
            disabled={disabled}
            onChange={(e) => onChange({ ...shape, exactMatch: e.target.checked })}
            aria-describedby={`${questionId}-match-note`}
            className="h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
          />
          Match exactly (capitalization &amp; accents)
        </label>
        <p id={`${questionId}-match-note`} className="text-[11px] text-[var(--color-ink-2)]">
          {shape.exactMatch
            ? "Answers must match exactly, including capitalization and accents (sí ≠ si, Sí ≠ sí)."
            : "Answers match regardless of capitalization, surrounding spaces, or accents (sí = si)."}
        </p>
      </div>
    </div>
  );
}

/**
 * Library Item picker for the read / listen / watch Part kinds. Lists
 * the group's library items filtered to the part-kind-compatible
 * display kinds (per `assertPartLibraryRefMimeMatch`); retired items
 * remain selectable only if already attached (the soft-stop is
 * forward-only — preserving an existing reference is fine, attaching
 * a retired item to a new Part is not).
 */
function LibraryItemPickerBody({
  groupId,
  part,
  onUpdate,
  disabled,
  allowedKinds,
}: {
  readonly groupId: string;
  readonly part: Extract<
    ActivityPart,
    { kind: "read_library_item" | "listen_audio" | "watch_video" }
  >;
  readonly onUpdate: (patch: Partial<ActivityPart>) => void;
  readonly disabled: boolean;
  readonly allowedKinds: ReadonlyArray<LibraryDisplayKind>;
}) {
  const library = useLibraryList(groupId, true);
  const allowed = library.data?.entries.filter((e) => allowedKinds.includes(e.displayKind));

  if (library.isLoading) {
    return <p className="text-[11px] text-[var(--color-ink-3)]">Loading library…</p>;
  }
  if (library.isError) {
    return (
      <Callout tone="danger">
        <div className="flex items-center justify-between gap-2">
          <span>{asUserMessage(library.error, "Couldn't load the library — try again.")}</span>
          <Button size="sm" variant="secondary" onClick={() => library.refetch()}>
            Try again
          </Button>
        </div>
      </Callout>
    );
  }
  if (!allowed || allowed.length === 0) {
    return (
      <p className="text-[11px] text-[var(--color-ink-3)]">
        No matching Library Items in this group yet — upload one in the Library tab, then come back.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <select
        aria-label="Library Item"
        className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-rule)] bg-[var(--color-bg)] px-3 text-[13px]"
        value={part.libraryItemId}
        disabled={disabled}
        onChange={(e) => onUpdate({ libraryItemId: e.target.value } as Partial<ActivityPart>)}
      >
        <option value="">— pick a Library Item —</option>
        {allowed.map((entry) => {
          const retired = entry.item.retiredAt !== null;
          const isAttached = entry.item.id === part.libraryItemId;
          // Retired items are only listable when already attached so a
          // facilitator can keep an existing reference without forcing
          // them to break it. New attachments to retired items are
          // refused upstream by `canAttachLibraryItemToActivity`.
          if (retired && !isAttached) return null;
          return (
            <option key={entry.item.id} value={entry.item.id}>
              {entry.item.title}
              {retired ? " (retired)" : ""} · {entry.displayKind}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function WindowFields({
  opensAt,
  dueAt,
  closesAt,
  postClose,
  onChange,
  disabled,
  error,
  registerAnchor,
}: {
  readonly opensAt: string;
  readonly dueAt: string;
  readonly closesAt: string;
  readonly postClose: PostClosePolicy["kind"] | null;
  readonly onChange: (
    next: Partial<{
      opensAt: string;
      dueAt: string;
      closesAt: string;
      postClose: PostClosePolicy["kind"] | null;
    }>,
  ) => void;
  readonly disabled: boolean;
  readonly error?: string;
  readonly registerAnchor: (el: HTMLElement | null) => void;
}) {
  // `<input type="datetime-local">` returns a wall-clock string in the
  // browser's local zone with no offset; the saved ms-since-epoch
  // therefore depends on whoever opened this composer. Disclose the
  // resolved timezone so the author can confirm before saving.
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Opens">
          {({ id }) => (
            <Input
              id={id}
              type="datetime-local"
              value={opensAt}
              onChange={(e) => onChange({ opensAt: e.target.value })}
              disabled={disabled}
            />
          )}
        </Field>
        <Field label="Due">
          {({ id }) => (
            <Input
              id={id}
              type="datetime-local"
              value={dueAt}
              onChange={(e) => onChange({ dueAt: e.target.value })}
              disabled={disabled}
            />
          )}
        </Field>
        <Field label="Closes">
          {({ id }) => (
            <Input
              id={id}
              type="datetime-local"
              value={closesAt}
              onChange={(e) => {
                onChange({
                  closesAt: e.target.value,
                  // Clearing closesAt clears the post-close policy too
                  // so the saved row stays internally consistent (mirror
                  // of `assertWindowConsistent`). Setting closesAt does
                  // NOT auto-seed a policy — the picker below appears
                  // empty so the author makes an explicit choice rather
                  // than landing on a destructive lock-out default.
                  postClose: e.target.value.length === 0 ? null : postClose,
                });
              }}
              disabled={disabled}
            />
          )}
        </Field>
      </div>
      <p className="text-[11px] text-[var(--color-ink-3)]">
        Times are stored as instants and rendered in each viewer's own zone. You're picking in{" "}
        <span className="font-mono">{localZone}</span>.
      </p>
      {closesAt.length > 0 ? (
        <div ref={registerAnchor}>
          <Field
            label="Post-close policy"
            hint="What happens after the close time. Required when a close time is set."
            error={error}
          >
            {({ describedBy }) => (
              <PostCloseRadios
                value={postClose}
                describedBy={describedBy}
                invalid={error !== undefined}
                disabled={disabled}
                onChange={(next) => onChange({ postClose: next })}
              />
            )}
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Three mutually-exclusive post-close consequences. Radios (not a
 * `<select>`) so the consequence of each option is visible without a
 * recall step — Nielsen #6 "Recognition over recall." Mirrors the
 * Embed-provider radio pattern that already lives in this same dialog.
 */
const POST_CLOSE_OPTIONS: ReadonlyArray<{
  readonly value: PostClosePolicy["kind"];
  readonly label: string;
  readonly hint: string;
}> = [
  {
    value: "visible_completable",
    label: "Visible · still completable",
    hint: "Late completions still count toward the activity.",
  },
  {
    value: "visible_locked",
    label: "Visible · locked",
    hint: "Readable, but no further completions.",
  },
  {
    value: "hidden",
    label: "Hidden",
    hint: "Disappears from the track after close.",
  },
];

function PostCloseRadios({
  value,
  describedBy,
  invalid,
  disabled,
  onChange,
}: {
  readonly value: PostClosePolicy["kind"] | null;
  readonly describedBy?: string;
  readonly invalid?: boolean;
  readonly disabled: boolean;
  readonly onChange: (next: PostClosePolicy["kind"]) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-label="Post-close policy"
      className={cn(
        "space-y-1.5 rounded-[var(--radius-sm)]",
        invalid && "outline outline-[var(--color-danger-border)]",
      )}
    >
      {POST_CLOSE_OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-[var(--color-surface-2)]"
        >
          <input
            type="radio"
            name="post-close-policy"
            value={opt.value}
            checked={value === opt.value}
            disabled={disabled}
            onChange={() => onChange(opt.value)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-[var(--color-ink)]">{opt.label}</span>
            <span className="block text-[11px] text-[var(--color-ink-3)]">{opt.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * TODO(m11-m12): refresh the prereq + suggested-sequence helper copy
 * once Activity Records (M11) and Visibility (M12) make prereq
 * satisfaction observable to the learner. Today the copy is correct
 * for the static state ("Pick zero or more activities a learner
 * must complete first") because no completion signal exists yet;
 * once records track per-Part progress and visibility ties prereq
 * status to access, the copy gets richer (e.g., "blocks access
 * until the learner has marked all Parts of the prereq complete").
 * Re-evaluate when M11 lands — the truth-table gets more interesting.
 */
function CrossActivityFields({
  siblings,
  prereqIds,
  suggestedIds,
  onTogglePrereq,
  onToggleSuggested,
  disabled,
}: {
  readonly siblings: readonly ActivityListItem[];
  readonly prereqIds: ReadonlySet<string>;
  readonly suggestedIds: ReadonlySet<string>;
  readonly onTogglePrereq: (id: string) => void;
  readonly onToggleSuggested: (id: string) => void;
  readonly disabled: boolean;
}) {
  if (siblings.length === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field
        label="Prerequisites (block access)"
        hint="Hard gates. Pick zero or more activities a learner must complete first."
      >
        {() => (
          <SiblingChecklist
            siblings={siblings}
            selected={prereqIds}
            onToggle={onTogglePrereq}
            disabled={disabled}
            describe={(s) => s.title}
          />
        )}
      </Field>
      <Field
        label="Suggested next (non-blocking)"
        hint="Soft sequence — recommended order, not enforced."
      >
        {() => (
          <SiblingChecklist
            siblings={siblings}
            selected={suggestedIds}
            onToggle={onToggleSuggested}
            disabled={disabled}
            describe={(s) => `after this: ${s.title}`}
          />
        )}
      </Field>
    </div>
  );
}

function SiblingChecklist({
  siblings,
  selected,
  onToggle,
  disabled,
  describe,
}: {
  readonly siblings: readonly ActivityListItem[];
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly disabled: boolean;
  readonly describe: (s: ActivityListItem) => string;
}) {
  return (
    <div className="max-h-44 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-rule)] bg-[var(--color-bg)]">
      <ul className="divide-y divide-[var(--color-rule)]">
        {siblings.map((s) => {
          const checked = selected.has(s.id);
          return (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] hover:bg-[var(--color-surface-2)]">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(s.id)}
                />
                <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">
                  {describe(s)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AudienceFields({
  trackId,
  audienceKind,
  selectedUserIds,
  onAudienceKindChange,
  onToggleUser,
  disabled,
  error,
  registerAnchor,
}: {
  readonly trackId: string;
  readonly audienceKind: ActivityAudience["kind"];
  readonly selectedUserIds: ReadonlySet<string>;
  readonly onAudienceKindChange: (kind: ActivityAudience["kind"]) => void;
  readonly onToggleUser: (userId: string) => void;
  readonly disabled: boolean;
  readonly error?: string;
  readonly registerAnchor: (el: HTMLElement | null) => void;
}) {
  const people = useTrackPeople(trackId, true);
  // Only current enrollees are addressable — left enrollments stay
  // out of the picker so a soft-left user cannot ride along into a
  // saved subset audience.
  const enrollees = people.data?.entries ?? [];
  const isSubset = audienceKind === "subset";

  return (
    <div ref={registerAnchor}>
      <Field
        label="Audience"
        hint="Default reaches everyone enrolled. Narrow to a subset for one-off pairings; departed enrollees fall out automatically."
        error={error}
      >
        {({ id, describedBy }) => (
          <div className="space-y-3">
            <select
              id={id}
              aria-describedby={describedBy}
              className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-rule)] bg-[var(--color-bg)] px-3 text-[13px]"
              value={audienceKind}
              disabled={disabled}
              onChange={(e) => onAudienceKindChange(e.target.value as ActivityAudience["kind"])}
            >
              <option value="everyone_enrolled">Everyone enrolled (default)</option>
              <option value="subset">Selected participants</option>
            </select>

            {isSubset ? (
              <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-rule)]">
                {people.isLoading ? (
                  <div className="px-3 py-3 text-[12px] text-[var(--color-ink-3)]">
                    Loading roster…
                  </div>
                ) : people.isError ? (
                  <Callout tone="danger" className="m-2">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {asUserMessage(
                          people.error,
                          "Couldn't load the roster. Switch back to Everyone enrolled or retry.",
                        )}
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => people.refetch()}>
                        Try again
                      </Button>
                    </div>
                  </Callout>
                ) : enrollees.length === 0 ? (
                  <div className="px-3 py-3 text-[12px] text-[var(--color-ink-3)]">
                    No current enrollees yet — invite participants first, then narrow audience.
                  </div>
                ) : (
                  <ul className="divide-y divide-[var(--color-rule)]">
                    {enrollees.map((row) => {
                      const userId = row.enrollment.userId;
                      const checked = selectedUserIds.has(userId);
                      return (
                        <li key={userId}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--color-surface-2)]">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => onToggleUser(userId)}
                            />
                            <Avatar name={row.displayName} size={24} src={row.avatarUrl} />
                            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-ink)]">
                              {row.displayName}
                            </span>
                            {row.enrollment.role === "facilitator" ? (
                              <Badge>facilitator</Badge>
                            ) : null}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="border-[var(--color-rule)] border-t bg-[var(--color-surface)] px-3 py-2 text-[11px] text-[var(--color-ink-3)]">
                  {selectedUserIds.size === 0
                    ? "Pick at least one participant before saving."
                    : `${selectedUserIds.size} selected`}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Field>
    </div>
  );
}

/**
 * Mint a new Part id at the moment a Part is added to the composer.
 * Browser `crypto.randomUUID()` provides ~122 bits of entropy — well
 * past what we need for the per-activity uniqueness contract M11
 * relies on. Real cuid2 generation lives in the adapter (CI rule 7
 * gates `@paralleldrive/cuid2` to `adapters/cloudflare`); the SPA mints
 * URL-safe ids directly so reorders during a session don't churn ids.
 */
const newPartId = (): string => `p_${crypto.randomUUID().replace(/-/g, "")}`;

function blankPart(kind: AuthorablePartKind): ActivityPart {
  const id = newPartId();
  switch (kind) {
    case "write_reflection":
      return { kind: "write_reflection", id, prompt: "" };
    case "read_library_item":
      return { kind: "read_library_item", id, libraryItemId: "" };
    case "listen_audio":
      return { kind: "listen_audio", id, libraryItemId: "" };
    case "watch_video":
      return { kind: "watch_video", id, libraryItemId: "" };
    case "embed":
      return { kind: "embed", id, provider: "youtube", url: "https://" };
    case "quiz":
      return { kind: "quiz", id, questions: [blankQuestion()] };
  }
}

function blankQuestion(): QuizQuestion {
  return {
    id: newPartId(),
    prompt: "",
    shape: { kind: "multiple_choice", options: ["", ""] },
  };
}

function buildDraft(activity: LearningActivity | null): Draft {
  if (!activity) {
    return {
      title: "",
      description: "",
      parts: [],
      hardEdges: [],
      audienceKind: "everyone_enrolled",
      selectedUserIds: new Set(),
      opensAt: "",
      dueAt: "",
      closesAt: "",
      postClose: null,
      completionRule: "manual_mark",
      selectedPrereqIds: new Set(),
      selectedSuggestedIds: new Set(),
    };
  }
  return {
    title: activity.title,
    description: activity.description ?? "",
    parts: [...activity.parts],
    hardEdges: activity.flow.prereqs.filter((e) => e.kind === "hard"),
    audienceKind: activity.audience.kind,
    selectedUserIds:
      activity.audience.kind === "subset" ? new Set(activity.audience.userIds) : new Set(),
    opensAt: msToLocal(activity.window?.opensAt ?? null),
    dueAt: msToLocal(activity.window?.dueAt ?? null),
    closesAt: msToLocal(activity.window?.closesAt ?? null),
    postClose: activity.postClosePolicy?.kind ?? null,
    completionRule: activity.completionRule.kind,
    selectedPrereqIds: new Set(activity.prerequisiteActivityIds),
    selectedSuggestedIds: new Set(activity.suggestedNextActivityIds),
  };
}

function toggleInSet(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * JSON-friendly projection of a Draft used to detect dirty state.
 * `Set` is converted to a sorted array so the JSON is stable across
 * insertion order; the rest of the fields are already structurally
 * comparable. The output is opaque — only used as input to
 * `JSON.stringify` for an equality check.
 */
function serializeDraftForDirtyCheck(draft: Draft): unknown {
  return {
    title: draft.title,
    description: draft.description,
    parts: draft.parts,
    hardEdges: draft.hardEdges,
    audienceKind: draft.audienceKind,
    selectedUserIds: [...draft.selectedUserIds].sort(),
    opensAt: draft.opensAt,
    dueAt: draft.dueAt,
    closesAt: draft.closesAt,
    postClose: draft.postClose,
    completionRule: draft.completionRule,
    selectedPrereqIds: [...draft.selectedPrereqIds].sort(),
    selectedSuggestedIds: [...draft.selectedSuggestedIds].sort(),
  };
}

function msToLocal(ms: number | null): string {
  if (ms === null) return "";
  // `<input type="datetime-local">` wants a local-zone string with no
  // timezone suffix. The conversion below preserves the wall-clock
  // value the facilitator picked.
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function localToMs(local: string): number | null {
  if (local.length === 0) return null;
  const ms = new Date(local).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function serializeDraft(draft: Draft, trackId: string): ActivityComposerPayload {
  const opensAt = localToMs(draft.opensAt);
  const dueAt = localToMs(draft.dueAt);
  const closesAt = localToMs(draft.closesAt);
  const window: ActivityWindow | null =
    opensAt === null && dueAt === null && closesAt === null ? null : { opensAt, dueAt, closesAt };
  const postClose: PostClosePolicy | null =
    closesAt !== null && draft.postClose !== null ? { kind: draft.postClose } : null;
  const flow: ActivityFlow = { prereqs: draft.hardEdges.map((e) => ({ ...e, kind: "hard" })) };
  const audience: ActivityAudience =
    draft.audienceKind === "subset"
      ? {
          kind: "subset",
          // Branding to UserId at the boundary; the API route re-validates
          // the list against the track's current enrollments before any
          // adapter write, so there's no risk a stale id sneaks in here.
          userIds: Array.from(draft.selectedUserIds, (id) => id as UserId),
        }
      : { kind: "everyone_enrolled" };
  const parts = draft.parts.map(sanitizePartForWire);
  return {
    trackId,
    title: draft.title.trim(),
    description: draft.description.trim().length > 0 ? draft.description.trim() : null,
    parts,
    flow,
    audience,
    window,
    postClosePolicy: postClose,
    completionRule: { kind: draft.completionRule },
    libraryRefs: collectLibraryRefs(parts),
    prerequisiteActivityIds: Array.from(draft.selectedPrereqIds),
    suggestedNextActivityIds: Array.from(draft.selectedSuggestedIds),
  };
}

/**
 * Normalize a Part to what the server's Zod schema will accept, so an
 * optional-extra field left half-filled is silently dropped rather than
 * 400-ing on an opaque error. Today only short-answer quiz keys need it:
 * `acceptedAnswer` is `z.string().trim().min(1)` for both `correctAnswer`
 * and every `alsoAccept` entry (`packages/domain/src/parts/quiz.ts`), so a
 * whitespace-only correct answer must become `undefined` (ungraded) and a
 * blank "Add accepted answer" row must be dropped (it's an optional extra,
 * not a gate). The coherence refine — `alsoAccept` non-empty with no
 * `correctAnswer` — is caught earlier by `findIncompletePart`.
 */
export function sanitizePartForWire(part: ActivityPart): ActivityPart {
  if (part.kind !== "quiz") return part;
  return {
    ...part,
    questions: part.questions.map((q) => {
      if (q.shape.kind !== "short_answer") return q;
      const correctAnswer = q.shape.correctAnswer?.trim();
      return {
        ...q,
        shape: {
          ...q.shape,
          correctAnswer: correctAnswer && correctAnswer.length > 0 ? correctAnswer : undefined,
          alsoAccept: q.shape.alsoAccept.filter((a) => a.trim().length > 0),
        },
      };
    }),
  };
}

/**
 * Walks the draft's Parts and returns the index + a user-facing message
 * for the first unfilled required field, or `null` if everything is
 * authorable. Lets the composer refuse a save before the API round-trip
 * — server-side Zod still re-validates as defense in depth. Each branch
 * mirrors a `min(1)` / `.refine` constraint in the corresponding Part schema.
 */
export function findIncompletePart(parts: readonly ActivityPart[]): {
  readonly partIndex: number;
  readonly field?: PartFieldLocator;
  readonly message: string;
} | null {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const where = `Part ${i + 1} (${p.kind.replace(/_/g, " ")})`;
    const fail = (message: string, field?: PartFieldLocator) => ({ partIndex: i, field, message });
    if (
      (p.kind === "read_library_item" || p.kind === "listen_audio" || p.kind === "watch_video") &&
      p.libraryItemId.length === 0
    ) {
      return fail(`${where}: pick a Library Item.`);
    }
    if (p.kind === "write_reflection" && p.prompt.trim().length === 0) {
      return fail(`${where}: write a reflection prompt.`);
    }
    if (p.kind === "embed") {
      try {
        const u = new URL(p.url);
        if (u.protocol !== "https:") return fail(`${where}: embed URL must use https.`);
      } catch {
        return fail(`${where}: embed URL must be a valid https URL.`);
      }
    }
    if (p.kind === "quiz") {
      if (p.questions.length === 0) {
        return fail(`${where}: add at least one question.`);
      }
      for (let q = 0; q < p.questions.length; q++) {
        const question = p.questions[q];
        if (!question) continue;
        const at = `${where}, question ${q + 1}`;
        if (question.prompt.trim().length === 0) {
          return fail(`${at}: write a prompt.`);
        }
        if (question.shape.kind === "multiple_choice") {
          if (question.shape.options.length < 2) {
            return fail(`${at}: add at least two options.`);
          }
          if (question.shape.options.some((o) => o.trim().length === 0)) {
            return fail(`${at}: fill in every option or remove the empty ones.`);
          }
        }
        // Mirror of the short-answer coherence refine: an accept-list with
        // no primary answer can never grade. A whitespace-only correct
        // answer counts as no primary answer here — the server's
        // `acceptedAnswer` (`z.string().trim().min(1)`) would reject it, and
        // `sanitizePartForWire` drops it to `undefined` before the wire — so
        // the gate must trim too. Bind to the correct-answer input (not just
        // the Part) so the fix target is unambiguous, matching the title path.
        if (
          question.shape.kind === "short_answer" &&
          (question.shape.correctAnswer ?? "").trim().length === 0 &&
          question.shape.alsoAccept.some((a) => a.trim().length > 0)
        ) {
          return fail(
            `${at}: add a correct answer, or clear the accepted list to leave it ungraded.`,
            { kind: "quiz-correct-answer", questionIndex: q },
          );
        }
      }
    }
  }
  return null;
}

function collectLibraryRefs(
  parts: readonly ActivityPart[],
): ReadonlyArray<{ libraryItemId: string; pinnedRevisionId: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ libraryItemId: string; pinnedRevisionId: string | null }> = [];
  for (const p of parts) {
    if ("libraryItemId" in p && typeof p.libraryItemId === "string" && p.libraryItemId.length > 0) {
      if (!seen.has(p.libraryItemId)) {
        seen.add(p.libraryItemId);
        out.push({
          libraryItemId: p.libraryItemId,
          pinnedRevisionId: p.pinnedRevisionId ?? null,
        });
      }
    }
  }
  return out;
}
