import {
  CONTRIBUTION_MODE_COPY,
  type ContributionMode,
  type ContributionPolicyEnvelope,
  type LearningTrack,
  type PeerProgressVisibility,
  type TrackStatus,
} from "@hearth/domain";
import { Button, Field, Input, Modal, Textarea } from "@hearth/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  type TrackCaps,
  useSetPeerProgressVisibility,
  useUpdateTrackContributionPolicy,
  useUpdateTrackMetadata,
  useUpdateTrackStatus,
} from "../../hooks/use-tracks.ts";
import { asUserMessage } from "../../lib/problem.ts";
import { ConfirmActionDialog } from "../admin/confirm-action-dialog.tsx";

// jscpd:ignore-start
const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

const settingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(NAME_MAX, `Name must be ${NAME_MAX} characters or fewer.`),
  description: z
    .string()
    .trim()
    .max(DESCRIPTION_MAX, `Description must be ${DESCRIPTION_MAX} characters or fewer.`),
});

type SettingsForm = z.infer<typeof settingsSchema>;

type Props = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly track: LearningTrack;
  readonly groupId: string;
  readonly contributionPolicy: ContributionPolicyEnvelope;
  readonly caps: TrackCaps;
};
// jscpd:ignore-end

/**
 * Status options the user can stage from the dialog. Archive is intentionally
 * excluded — it's a terminal action that lives in the danger zone with its
 * own confirmation modal, so it cannot be applied as a side-effect of saving
 * other unrelated changes.
 */
const STAGEABLE_STATUSES: readonly Exclude<TrackStatus, "archived">[] = ["active", "paused"];

const STATUS_LABEL: Record<TrackStatus, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

const STATUS_HINT: Record<Exclude<TrackStatus, "archived">, string> = {
  active: "New activities and sessions can be added; everything is mutable.",
  paused: "Readable, but no new activities or sessions can be added until resumed.",
};

const CONTRIBUTION_MODES: readonly ContributionMode[] = [
  "direct",
  "optional_review",
  "required_review",
  "none",
];

const PEER_PROGRESS_OPTIONS: ReadonlyArray<{
  readonly value: PeerProgressVisibility;
  readonly label: string;
  readonly hint: string;
}> = [
  {
    value: "shared",
    label: "Shared",
    hint: "Everyone enrolled can see who has completed each activity.",
  },
  {
    value: "facilitator_only",
    label: "Facilitators only",
    hint: "Only facilitators see participants' progress; each participant still sees their own.",
  },
];

/**
 * Shared radio-card list for the dialog's three single-select settings
 * (status, contribution policy, peer progress). One markup source so the
 * fieldsets can't drift — and so a third near-identical block doesn't trip the
 * duplication gate.
 */
function RadioCardGroup<T extends string>({
  legend,
  hint,
  name,
  options,
  value,
  onChange,
  disabled,
}: {
  readonly legend: string;
  readonly hint?: string;
  readonly name: string;
  readonly options: ReadonlyArray<{
    readonly value: T;
    readonly label: string;
    readonly hint: string;
  }>;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium text-[0.75rem] text-[var(--color-ink)] uppercase tracking-wide">
        {legend}
      </legend>
      {hint ? <p className="text-[0.75rem] text-[var(--color-ink-2)]">{hint}</p> : null}
      <div className="space-y-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] px-1 py-1 hover:bg-[var(--color-surface)]"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              disabled={disabled}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-[0.8125rem] text-[var(--color-ink)]">
                {option.label}
              </div>
              <div className="text-[0.75rem] text-[var(--color-ink-2)]">{option.hint}</div>
            </div>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Track-settings modal. Four sections — metadata, status, contribution policy,
 * danger-zone archive — and a single Save button that commits whatever
 * dirtied. Mirrors `GroupSettingsDialog` so reviewers recognize the shape;
 * the M5 facilitator-management section will land inside this same shell.
 *
 * Save semantics: every staged change (name/description, active⇄paused,
 * contribution policy) is fired in sequence on Save. Each mutation is
 * independent at the API boundary — if one fails, the earlier ones already
 * committed but the dialog stays open with the failure surfaced via toast,
 * so the user can retry rather than re-enter every field. The status
 * transitions only cover active⇄paused; archive remains a separate
 * confirm-and-fire flow because it's terminal.
 */
export function TrackSettingsDialog({
  open,
  onClose,
  track,
  groupId,
  contributionPolicy,
  caps,
}: Props) {
  const updateMetadata = useUpdateTrackMetadata(groupId, track.id);
  const updateStatus = useUpdateTrackStatus(groupId, track.id);
  const updatePolicy = useUpdateTrackContributionPolicy(groupId, track.id);
  const updatePeerProgress = useSetPeerProgressVisibility(groupId, track.id);

  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [pendingPolicy, setPendingPolicy] = useState<ContributionMode>(
    contributionPolicy.data.mode,
  );
  const [pendingPeerProgress, setPendingPeerProgress] = useState<PeerProgressVisibility>(
    track.peerProgressVisibility,
  );
  // Staged status — only mutates between "active" and "paused" via the
  // radios; archived is unreachable from this state because the dialog is
  // read-only when the track is already archived.
  const initialStageableStatus: Exclude<TrackStatus, "archived"> =
    track.status === "archived" ? "active" : track.status;
  const [pendingStatus, setPendingStatus] =
    useState<Exclude<TrackStatus, "archived">>(initialStageableStatus);

  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { name: track.name, description: track.description ?? "" },
    mode: "onTouched",
  });

  // Re-hydrate every staged piece whenever the source track or the dialog
  // re-opens — without this, a server-side change made in another tab
  // shows up as "your local edit reverted" the next time the dialog opens.
  useEffect(() => {
    if (open) {
      form.reset({ name: track.name, description: track.description ?? "" });
      setPendingPolicy(contributionPolicy.data.mode);
      setPendingStatus(track.status === "archived" ? "active" : track.status);
      setPendingPeerProgress(track.peerProgressVisibility);
    }
  }, [
    open,
    track.name,
    track.description,
    track.status,
    track.peerProgressVisibility,
    contributionPolicy.data.mode,
    form,
  ]);

  const isBusy =
    form.formState.isSubmitting ||
    updateStatus.isPending ||
    updatePolicy.isPending ||
    updatePeerProgress.isPending;

  const close = () => {
    if (isBusy) return;
    onClose();
  };

  // jscpd:ignore-start
  const nameError = form.formState.errors.name?.message;
  const descError = form.formState.errors.description?.message;
  const nameValue = form.watch("name");
  const archived = track.status === "archived";
  // jscpd:ignore-end

  // Track which non-form fields differ from server state so Save can fire
  // exactly the mutations that matter (avoids no-op writes that would still
  // hit the rate limiter).
  const statusDirty = !archived && pendingStatus !== track.status;
  const policyDirty = !archived && pendingPolicy !== contributionPolicy.data.mode;
  const peerProgressDirty = !archived && pendingPeerProgress !== track.peerProgressVisibility;
  const formDirty = form.formState.isDirty;
  const dirty = formDirty || statusDirty || policyDirty || peerProgressDirty;

  const submitDisabled =
    !dirty || form.formState.isSubmitting || nameValue.trim().length === 0 || !caps.canEditMetadata;

  const onSubmit = form.handleSubmit(async ({ name, description }) => {
    // Fire mutations sequentially. The order is metadata → status → policy
    // because metadata edits are the most common path (one round trip on
    // the typical edit). If status or policy fails after metadata commits,
    // the dialog keeps the failed selection staged so a retry hits only
    // the failing endpoint.
    try {
      if (formDirty) {
        const trimmed = description.trim();
        await updateMetadata.mutateAsync({
          ...(name !== track.name ? { name } : {}),
          ...(trimmed !== (track.description ?? "")
            ? { description: trimmed.length > 0 ? trimmed : null }
            : {}),
        });
      }
      if (statusDirty) {
        // active → paused = pause; paused → active = resume.
        const action = pendingStatus === "paused" ? "pause" : "resume";
        await updateStatus.mutateAsync(action);
      }
      if (policyDirty) {
        await updatePolicy.mutateAsync({ v: 1, data: { mode: pendingPolicy } });
      }
      if (peerProgressDirty) {
        await updatePeerProgress.mutateAsync(pendingPeerProgress);
      }
      toast.success("Track updated.");
      onClose();
    } catch (err) {
      // Surface the failure on the form's name field if it was the
      // metadata write that failed; otherwise toast — there's no field to
      // attach a status/policy error to. A subsequent Save retries.
      const message = asUserMessage(err, "Update failed.");
      if (formDirty && updateMetadata.isError) {
        form.setError("name", { type: "server", message });
      } else {
        toast.error(message);
      }
    }
  });

  const policyDisabled = !caps.canEditContributionPolicy || isBusy;
  const statusDisabled = !(caps.canPause || caps.canResume) || isBusy;

  return (
    <>
      <Modal
        open={open}
        size="md"
        title="Track settings"
        description={
          archived
            ? "This track is archived — read-only. Archive is terminal; there is no unarchive."
            : "Edit the track's name, status, how participants contribute new activities, and who can see progress."
        }
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={isBusy}>
              Close
            </Button>
            {caps.canEditMetadata ? (
              <Button
                type="submit"
                variant="primary"
                form="track-settings-form"
                disabled={submitDisabled}
              >
                {isBusy ? "Saving…" : "Save changes"}
              </Button>
            ) : null}
          </>
        }
      >
        {/* jscpd:ignore-start */}
        <form id="track-settings-form" className="space-y-4" noValidate onSubmit={onSubmit}>
          <Field label="Name" error={nameError}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-required
                maxLength={NAME_MAX}
                invalid={nameError !== undefined}
                disabled={!caps.canEditMetadata || form.formState.isSubmitting}
                {...form.register("name")}
              />
            )}
          </Field>
          <Field label="Description" error={descError}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                rows={3}
                maxLength={DESCRIPTION_MAX}
                invalid={descError !== undefined}
                disabled={!caps.canEditMetadata || form.formState.isSubmitting}
                {...form.register("description")}
              />
            )}
          </Field>
        </form>
        {/* jscpd:ignore-end */}

        {!archived ? (
          <RadioCardGroup
            legend="Status"
            name="track-status"
            options={STAGEABLE_STATUSES.map((status) => ({
              value: status,
              label: STATUS_LABEL[status],
              hint: STATUS_HINT[status],
            }))}
            value={pendingStatus}
            onChange={setPendingStatus}
            disabled={statusDisabled}
          />
        ) : null}

        {!archived ? (
          <RadioCardGroup
            legend="Contribution policy"
            hint="Decides what happens when a non-facilitator publishes an activity."
            name="contribution-policy"
            options={CONTRIBUTION_MODES.map((mode) => ({
              value: mode,
              label: CONTRIBUTION_MODE_COPY[mode].label,
              hint: CONTRIBUTION_MODE_COPY[mode].hint,
            }))}
            value={pendingPolicy}
            onChange={setPendingPolicy}
            disabled={policyDisabled}
          />
        ) : null}

        {!archived ? (
          <RadioCardGroup
            legend="Peer progress visibility"
            hint="Controls whether enrollees can see each other's completion progress. Detailed responses always stay private to their author."
            name="peer-progress-visibility"
            options={PEER_PROGRESS_OPTIONS}
            value={pendingPeerProgress}
            onChange={setPendingPeerProgress}
            // Same authority as the contribution policy (Group Admin / Track
            // Facilitator), so it rides the same capability rather than a
            // second near-identical cap on the wire.
            disabled={policyDisabled}
          />
        ) : null}

        {!archived && caps.canArchive ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-soft)] p-3">
            <div className="font-medium text-[0.75rem] text-[var(--color-ink)] uppercase tracking-wide">
              Danger zone
            </div>
            <p className="mt-1 text-[0.75rem] text-[var(--color-ink-2)]">
              Archiving freezes the track for good. History stays readable; nothing new can be added
              or changed.
            </p>
            <Button
              className="mt-2"
              variant="danger"
              size="sm"
              onClick={() => setConfirmingArchive(true)}
              disabled={updateStatus.isPending}
            >
              Archive track
            </Button>
          </div>
        ) : null}
      </Modal>

      <ConfirmActionDialog
        tone="destructive"
        open={confirmingArchive}
        title="Archive this Learning Track?"
        description={
          <>
            You are about to permanently archive <strong>{track.name}</strong>. Activities,
            sessions, and library items stay readable but can no longer be edited or added to. This
            is terminal — there is no unarchive.
          </>
        }
        confirmationPhrase="archive"
        confirmLabel="Archive track"
        pending={updateStatus.isPending}
        // `updateStatus` is shared with the inline pause/resume save, so its
        // `isError` can't cleanly attribute a failure to the archive action;
        // a failed archive surfaces via the catch's toast below.
        onClose={() => setConfirmingArchive(false)}
        onConfirm={async () => {
          try {
            await updateStatus.mutateAsync("archive");
            toast.success("Track archived.");
            setConfirmingArchive(false);
            onClose();
          } catch (err) {
            toast.error(asUserMessage(err, "Archive failed."));
          }
        }}
      />
    </>
  );
}
