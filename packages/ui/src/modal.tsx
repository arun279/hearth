import { type ReactNode, useCallback, useEffect, useId, useRef } from "react";
import { cn } from "./cn.ts";

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
 * restore focus on close. Keeps the tree simple by rendering inline (no
 * portal); the backdrop `inset-0` + high z-index prevents bleed-through on
 * the SPA's single-column layout. Good enough for v1; a full dialog primitive
 * from shadcn vendoring lands when the surface grows beyond this milestone.
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
  const triggerRef = useRef<Element | null>(null);
  const titleId = useId();
  const descId = useId();

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    document.addEventListener("keydown", handleKey);
    // Focus the first focusable element in the panel on open.
    const target = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    target?.focus();
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, [open, handleKey]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="fixed inset-0 cursor-default bg-black/35"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn(
          "relative w-full rounded-[var(--radius-lg)] border bg-[var(--color-bg)] shadow-lg",
          tone === "danger" ? "border-[var(--color-danger-border)]" : "border-[var(--color-rule)]",
          SIZE[size],
        )}
      >
        <div className="space-y-1 border-[var(--color-rule)] border-b px-5 py-4">
          <h2 id={titleId} className="font-serif text-[20px] leading-tight text-[var(--color-ink)]">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="text-[13px] text-[var(--color-ink-2)]">
              {description}
            </p>
          ) : null}
        </div>
        <div className="space-y-4 px-5 py-4 text-[13px]">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-[var(--color-rule)] border-t px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
