import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "./cn.ts";

export type PopoverProps = {
  /** Trigger button content (e.g. "Visibility: Track"). */
  readonly label: ReactNode;
  readonly children: ReactNode;
  readonly triggerClassName?: string;
  /** Which edge the panel aligns to. */
  readonly align?: "start" | "end";
};

const FOCUSABLE =
  'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Lightweight non-modal popover: a trigger button plus a panel that opens
 * below it. Closes on Escape or an outside click and returns focus to the
 * trigger; opening moves focus to the first control inside the panel. Not a
 * modal dialog — Tab is not trapped, matching how a disclosure should behave
 * (Nielsen: user control + freedom). Hand-rolled to match the repo's
 * dependency-free primitive convention.
 */
export function Popover({ label, children, triggerClassName, align = "start" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    const reposition = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setPlaceAbove(panel.offsetHeight > spaceBelow && spaceAbove > spaceBelow);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    reposition();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {label}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className={cn(
            "absolute z-20 min-w-[15rem] rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-3 shadow-lg",
            placeAbove ? "bottom-full mb-1" : "top-full mt-1",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
