import { type ReactNode, useEffect, useRef } from "react";
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
  /**
   * Stable ID prefix the consumer also uses to compose tab/panel IDs via
   * `tabIdFor(idPrefix, value)` and `panelIdFor(idPrefix)`. Required for the
   * ARIA tabs pattern (each tab `aria-controls`s the panel; the panel
   * `aria-labelledby`s the active tab) per the W3C ARIA Authoring Practices.
   */
  readonly idPrefix: string;
};

/** Stable tab DOM id. Pair with `panelIdFor` to wire the ARIA tabs pattern. */
export function tabIdFor(idPrefix: string, value: string): string {
  return `${idPrefix}-tab-${value}`;
}

/** Stable tabpanel DOM id. Used as `aria-controls` on every tab. */
export function panelIdFor(idPrefix: string): string {
  return `${idPrefix}-panel`;
}

/**
 * Underlined tab bar, keyboard-navigable, emits semantic `tablist` / `tab`
 * roles with full `aria-controls` wiring. The consumer renders the panel
 * separately with `id={panelIdFor(idPrefix)}` and
 * `aria-labelledby={tabIdFor(idPrefix, activeValue)}`.
 *
 * Keyboard model — automatic-activation per W3C ARIA Authoring Practices:
 * ArrowRight/ArrowLeft wrap, Home/End jump to the ends. Each navigation
 * also moves DOM focus to the newly-selected tab so focus and the visible
 * underline stay coincident for keyboard / screen-reader users. External
 * value changes (URL navigation, click) intentionally do NOT move focus.
 */
export function TabBar<Value extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
  idPrefix,
}: TabBarProps<Value>) {
  const panelId = panelIdFor(idPrefix);
  const tabRefs = useRef<Map<Value, HTMLButtonElement>>(new Map());
  // Only re-focus the selected tab when the change came from a keyboard
  // navigation inside this component — not when the value changed for an
  // external reason (route navigation, click bubbling). The flag is set
  // by the keydown handler and consumed by the effect below.
  const moveFocusOnNextChange = useRef(false);

  useEffect(() => {
    if (moveFocusOnNextChange.current) {
      tabRefs.current.get(value)?.focus();
      moveFocusOnNextChange.current = false;
    }
  }, [value]);

  const navigate = (nextValue: Value) => {
    moveFocusOnNextChange.current = true;
    onChange(nextValue);
  };

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
        return (
          <button
            key={item.value}
            ref={(node) => {
              if (node) tabRefs.current.set(item.value, node);
              else tabRefs.current.delete(item.value);
            }}
            id={tabIdFor(idPrefix, item.value)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => {
              const idx = items.findIndex((it) => it.value === value);
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = e.key === "ArrowRight" ? idx + 1 : idx - 1;
                const wrapped = (next + items.length) % items.length;
                const target = items[wrapped];
                if (target) navigate(target.value);
              } else if (e.key === "Home") {
                e.preventDefault();
                const target = items[0];
                if (target) navigate(target.value);
              } else if (e.key === "End") {
                e.preventDefault();
                const target = items[items.length - 1];
                if (target) navigate(target.value);
              }
            }}
            className={cn(
              "relative -mb-px inline-flex items-center gap-2 border-b-2 px-0.5 py-2 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
              active
                ? "border-[var(--color-ink)] font-medium text-[var(--color-ink)]"
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
