import type { VisibilityPreference } from "@hearth/domain/visibility";

/**
 * Canonical Visibility-Preference copy. The wire values stay
 * `default | track_only | private`; only the display labels live here.
 */
const OPTIONS: ReadonlyArray<{ readonly value: VisibilityPreference; readonly label: string }> = [
  { value: "default", label: "Track" },
  { value: "track_only", label: "Facilitators only" },
  { value: "private", label: "Just me" },
];

/**
 * Record-level Visibility selector shown beside the reflection — that is
 * where privacy matters most — but the stored override is the whole
 * Activity Record, never the individual Part. Takes `recordId` (not a
 * partId) as the explicit reminder of that scope.
 */
export function VisibilitySelector({
  recordId,
  value,
  onChange,
  disabled,
}: {
  readonly recordId: string | null;
  readonly value: VisibilityPreference;
  readonly onChange: (next: VisibilityPreference) => void;
  readonly disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled || recordId === null}>
      <legend className="text-[11px] text-[var(--color-ink-2)]">Visibility</legend>
      <div className="flex flex-wrap items-center gap-3">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-ink-1)]"
          >
            <input
              type="radio"
              name={`visibility-${recordId ?? "pending"}`}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      <p className="text-[11px] text-[var(--color-ink-3)]">
        Your facilitators always see your full work.
      </p>
    </fieldset>
  );
}
