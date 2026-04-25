import { type ReactNode, useId } from "react";
import { cn } from "./cn.ts";

export type TabItem<Value extends string> = {
  readonly value: Value;
  readonly label: ReactNode;
  readonly badge?: ReactNode;
};

export type TabBarProps<Value extends string> = {
  readonly items: readonly TabItem<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  readonly ariaLabel: string;
  readonly className?: string;
};

/**
 * Underlined tab bar, keyboard-navigable, emits semantic `tablist` / `tab`
 * roles. The consumer owns which panel is visible so we don't prescribe a
 * content slot — pair this with a plain `<div role="tabpanel">` in the
 * parent.
 */
export function TabBar<Value extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: TabBarProps<Value>) {
  const idBase = useId();
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex items-center gap-5 border-[var(--color-rule)] border-b text-[13px]",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        const id = `${idBase}-${item.value}`;
        return (
          <button
            key={item.value}
            id={id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const idx = items.findIndex((it) => it.value === value);
                const next = e.key === "ArrowRight" ? idx + 1 : idx - 1;
                const wrapped = (next + items.length) % items.length;
                const target = items[wrapped];
                if (target) onChange(target.value);
              }
            }}
            className={cn(
              "relative -mb-px inline-flex items-center gap-2 border-b-2 px-0.5 py-2 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
              active
                ? "border-[var(--color-ink)] text-[var(--color-ink)] font-medium"
                : "border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]",
            )}
          >
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
