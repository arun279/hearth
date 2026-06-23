import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const GAP = 4;

type PanelPosition = { readonly top: number; readonly left: number };

/**
 * Lightweight non-modal popover: a trigger button plus a panel that opens
 * below it. Closes on Escape or an outside click and returns focus to the
 * trigger; opening moves focus to the first control inside the panel. Not a
 * modal dialog — Tab is not trapped, matching how a disclosure should behave
 * (Nielsen: user control + freedom). Hand-rolled to match the repo's
 * dependency-free primitive convention.
 *
 * The panel renders through a portal to `document.body` with `position: fixed`,
 * positioned from the trigger's viewport rect. That escapes any `overflow`
 * scroll ancestor (the Activity Player nests the trigger inside an
 * `overflow-y-auto` body whose bottom is the sticky footer) so the panel is
 * clipped only by the window, never by a shorter scroll container — every
 * option stays reachable however tall the surrounding chrome grows. Collision
 * detection flips the panel above the trigger when it would overflow the
 * window's bottom and more room sits above.
 */
export function Popover({ label, children, triggerClassName, align = "start" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const reposition = () => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const panelHeight = panel.offsetHeight;
    const panelWidth = panel.offsetWidth;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placeAbove = panelHeight > spaceBelow && spaceAbove > spaceBelow;
    const top = placeAbove ? rect.top - panelHeight - GAP : rect.bottom + GAP;
    const left = align === "end" ? rect.right - panelWidth : rect.left;
    setPosition({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    reposition();
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [open]);

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
    const onReposition = () => reposition();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  return (
    <>
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
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              style={{
                position: "fixed",
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                // Hidden for the first paint (before measure) so the panel
                // never flashes at 0,0; the layout effect sets coordinates
                // synchronously before the browser paints.
                visibility: position ? "visible" : "hidden",
                maxHeight: `calc(100dvh - ${2 * GAP}px)`,
              }}
              className={cn(
                "z-20 min-w-[15rem] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-3 shadow-lg",
              )}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
