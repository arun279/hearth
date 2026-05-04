import { type ReactNode, useId, useRef } from "react";
import { cn } from "./cn.ts";
import { useDialogPanel } from "./dialog-keyboard.ts";

export type ModalProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly size?: "sm" | "md" | "lg";
  /** Set when the dialog is the body of a destructive confirmation — shifts framing. */
  readonly tone?: "neutral" | "danger";
};

const SIZE: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-[440px]",
  md: "max-w-[520px]",
  lg: "max-w-[720px]",
};

/**
 * Accessible modal: role="dialog", aria-modal, focus trap, Escape to close,
 * restore focus on close, and stack-aware so a confirm dialog opened over
 * an existing modal inerts the lower panel and steals ESC.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  tone = "neutral",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const { isTopmost } = useDialogPanel({ open, onEscape: onClose, panelRef });

  if (!open) return null;

  // Outer container is a viewport-anchored flexbox so the panel can
  // size itself relative to viewport height. The panel is a flex
  // column whose body region (`flex-1 min-h-0 overflow-y-auto`)
  // absorbs the scroll — keeping header + footer visible at the
  // panel's edges. Without this, a tall body pushed the footer below
  // the fold and the primary actions ("Cancel"/"Save") became
  // unreachable without scrolling. Sticky-footer pattern per
  // Nielsen #1 "Visibility of system status": primary actions stay
  // visible regardless of scroll position.
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center px-4 py-10 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      inert={isTopmost ? undefined : true}
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="fixed inset-0 cursor-default bg-[var(--color-scrim)]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn(
          "relative flex max-h-full w-full flex-col rounded-[var(--radius-lg)] border bg-[var(--color-bg)] shadow-lg",
          tone === "danger" ? "border-[var(--color-danger-border)]" : "border-[var(--color-rule)]",
          SIZE[size],
        )}
      >
        <div className="space-y-1 border-[var(--color-rule)] border-b px-5 py-4">
          {/*
           * `tabIndex={-1}` lets the dialog hook park initial focus on the
           * heading on open. Without it, an async-loading body (skeleton
           * with no focusables) hands first focus to the footer's Close
           * button — which means a neighbouring destructive button like
           * "Retire" becomes the *second* Tab a keyboard user hits.
           * WCAG 2.4.3 "Focus Order" / Shneiderman #7. The heading is the
           * intent-level entry point of every dialog and a safer focus
           * anchor than whatever happens to render first.
           */}
          <h2
            id={titleId}
            tabIndex={-1}
            className="font-serif text-[20px] text-[var(--color-ink)] leading-tight outline-none"
          >
            {title}
          </h2>
          {description ? (
            <p id={descId} className="text-[13px] text-[var(--color-ink-2)]">
              {description}
            </p>
          ) : null}
        </div>
        {children !== undefined && children !== null && children !== false ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-[13px]">
            {children}
          </div>
        ) : null}
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-[var(--color-rule)] border-t px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
