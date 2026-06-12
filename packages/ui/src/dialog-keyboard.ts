import { type RefObject, useEffect, useRef, useState } from "react";

type Entry = {
  readonly onEscapeRef: { current: () => void };
  readonly panelRef: RefObject<HTMLElement | null>;
};

const stack: Entry[] = [];
const subscribers = new Set<() => void>();
let installed = false;

function notify(): void {
  for (const cb of subscribers) cb();
}

function ensureInstalled(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const top = stack[stack.length - 1];
    if (!top) return;
    e.preventDefault();
    top.onEscapeRef.current();
  });
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Run `fn` after React has flushed the pending re-render, so a parent panel's
 * `inert` attribute (removed when this dialog leaves the stack) is gone before
 * we focus into it. React commits DOM mutations before the next paint, so a
 * single `requestAnimationFrame` lands after the `inert` removal; focusing an
 * element inside a still-inert subtree is otherwise a no-op that drops focus
 * to <body>.
 */
function restoreFocusAfterFlush(fn: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    fn();
    return;
  }
  requestAnimationFrame(fn);
}

/**
 * Stack-aware keyboard contract for a dialog: while open, the dialog joins
 * a process-wide stack and only the topmost entry responds to ESC; the
 * panel traps Tab; opening focuses the first focusable inside the panel
 * and closing restores focus to the element that triggered the open.
 *
 * Returns `isTopmost` so the consumer can mark its panel `inert` while a
 * higher dialog is open — that's how a confirm-over-settings stack stays
 * visually present without becoming interactive behind the confirm.
 *
 * MUST be the only path a dialog uses to bind ESC. Bespoke ESC listeners
 * race with the stack and will close the parent dialog when ESC is meant
 * for the child. The `no-bespoke-dialog-role` convention check enforces
 * that `role="dialog"` only appears under `packages/ui/src/`, so the only
 * way to surface a dialog is through a primitive that wires this hook.
 */
export function useDialogPanel({
  open,
  onEscape,
  panelRef,
}: {
  readonly open: boolean;
  readonly onEscape: () => void;
  readonly panelRef: RefObject<HTMLElement | null>;
}): { readonly isTopmost: boolean } {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  const [isTopmost, setIsTopmost] = useState(true);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    ensureInstalled();
    triggerRef.current = document.activeElement;

    const entry: Entry = { onEscapeRef, panelRef };
    stack.push(entry);

    const sub = () => setIsTopmost(stack[stack.length - 1] === entry);
    sub();
    subscribers.add(sub);
    notify();

    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      if (stack[stack.length - 1] !== entry) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onTab);

    // Initial focus lands on the dialog's heading (h2 with `tabIndex=-1`)
    // rather than the first focusable in the panel. Reasons:
    //   1. WCAG 2.4.3 — focus order should follow visual reading order;
    //      the heading is the intent-level entry point.
    //   2. Stability — when the body renders a loading skeleton with no
    //      focusables, "first focusable" falls through to the footer,
    //      which can put a destructive action (Retire, Delete) directly
    //      under the keyboard cursor as the second Tab.
    //   3. Screen readers announce the heading text via aria-labelledby,
    //      so focusing it gives the user immediate context on the
    //      dialog's purpose.
    // Tab from the heading lands on the first interactive element in
    // the body, which is the natural reading-order start.
    const heading = panelRef.current?.querySelector<HTMLElement>("h2[tabindex='-1']");
    const fallback = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (heading ?? fallback)?.focus();

    return () => {
      document.removeEventListener("keydown", onTab);
      subscribers.delete(sub);
      const idx = stack.indexOf(entry);
      if (idx >= 0) stack.splice(idx, 1);
      notify();

      // Restore focus to the opener. `notify()` schedules the parent panel's
      // `setIsTopmost(true)`, which removes its `inert` attribute — but that
      // re-render is flushed *after* this synchronous cleanup. Focusing the
      // trigger now (while it may still sit inside an inert subtree) is a
      // no-op that drops focus to <body> and lets Tab escape behind the
      // still-open parent. Defer past the flush so the trigger is focusable.
      const trigger = triggerRef.current;
      const parent = stack[stack.length - 1];
      restoreFocusAfterFlush(() => {
        if (trigger instanceof HTMLElement && trigger.isConnected) {
          trigger.focus();
          if (document.activeElement === trigger) return;
        }
        // Trigger gone (or still unfocusable) but a parent dialog remains:
        // re-trap into it rather than leaving focus on <body> behind the
        // open modal. WCAG 2.1.2 — focus must not leak out of a live dialog.
        const heading =
          parent?.panelRef.current?.querySelector<HTMLElement>("h2[tabindex='-1']") ??
          parent?.panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        heading?.focus();
      });
    };
  }, [open, panelRef]);

  return { isTopmost };
}
