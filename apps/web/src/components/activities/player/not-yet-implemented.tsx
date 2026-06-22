import { PartIcon, partKindLabel } from "@hearth/ui";

type Props = {
  readonly kind: string;
};

/**
 * Placeholder for Part kinds whose player surfaces ship in a later
 * milestone (write_reflection / quiz in the next interactive-rendering
 * milestone; attend_session in the sessions integration). Renders an
 * honest "coming soon" state — never a blank canvas, never a broken
 * shape that looks like a bug.
 *
 * The participant still navigates to and away from this Part normally;
 * the Activity Flow doesn't gate on it (a future milestone wires hard
 * prerequisites once Part completion exists).
 */
export function NotYetImplemented({ kind }: Props) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center text-[var(--color-ink-2)]">
      <PartIcon kind={kind} size={22} className="text-[var(--color-ink-2)]" />
      <p className="font-medium text-[0.875rem]">
        {partKindLabel(kind)} Part — coming in a later milestone.
      </p>
      <p className="max-w-md text-[0.75rem] text-[var(--color-ink-2)]">
        The player chrome you see here is final. The interactive surface for this Part kind ships in
        an upcoming release alongside Activity Records.
      </p>
    </div>
  );
}
