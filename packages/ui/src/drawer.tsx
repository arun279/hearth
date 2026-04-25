import { X } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";
import { cn } from "./cn.ts";
import { useDialogPanel } from "./dialog-keyboard.ts";
import { IconButton } from "./icon-button.tsx";

export type DrawerProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  /**
   * Accessible name for the drawer (announced as the dialog title). Required
   * even when no visible header is rendered, so screen readers don't open
   * an unnamed dialog.
   */
  readonly label: string;
  readonly children: ReactNode;
  readonly side?: "left" | "right";
  readonly className?: string;
  /** Visible header above the content. The X close button is always rendered. */
  readonly header?: ReactNode;
};

/**
 * Side-sheet dialog. Same a11y contract as `Modal` (focus trap, ESC,
 * stack-aware, restore focus on close) but renders as an edge-anchored
 * panel instead of a centered card. The dimmed scrim is a real
 * `<button aria-label="Close…">` so keyboard and screen-reader users have
 * a way out — the underlying defect on the bespoke mobile drawer was
 * exactly the lack of these affordances.
 */
export function Drawer({
  open,
  onClose,
  label,
  children,
  side = "left",
  className,
  header,
}: DrawerProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const labelId = useId();
  const { isTopmost } = useDialogPanel({ open, onEscape: onClose, panelRef });

  if (!open) return null;

  const sideClass =
    side === "left"
      ? "left-0 border-[var(--color-rule)] border-r"
      : "right-0 border-[var(--color-rule)] border-l";

  return (
    <div
      className="fixed inset-0 z-40"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      inert={isTopmost ? undefined : true}
    >
      <button
        type="button"
        aria-label={`Close ${label}`}
        className="absolute inset-0 cursor-default bg-[var(--color-scrim)]"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className={cn(
          "absolute inset-y-0 flex w-[280px] max-w-[85vw] flex-col",
          "bg-[var(--color-surface)] shadow-xl",
          sideClass,
          className,
        )}
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-[var(--color-rule)] border-b px-2.5">
          <div
            id={labelId}
            className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-ink-2)] uppercase tracking-wide"
          >
            {header ?? label}
          </div>
          <IconButton label={`Close ${label}`} onClick={onClose}>
            <X size={16} strokeWidth={1.5} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3.5">{children}</div>
      </aside>
    </div>
  );
}
