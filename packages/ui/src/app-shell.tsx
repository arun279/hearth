import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "./cn.ts";
import { IconButton } from "./icon-button.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

/**
 * Responsive app chrome — desktop sidebar at ≥md, mobile topbar + drawer below.
 * The content slot is kept deliberately simple so feature routes can compose
 * their own page layouts.
 */
export type AppShellProps = {
  readonly sidebar: ReactNode;
  readonly headerRight?: ReactNode;
  readonly mobileTitle?: ReactNode;
  readonly children: ReactNode;
};

export function AppShell({ sidebar, headerRight, mobileTitle, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-full min-h-screen flex-col bg-[var(--color-bg)] md:flex-row">
      {/* Mobile topbar */}
      <header className="flex h-12 items-center gap-2 border-[var(--color-rule)] border-b bg-[var(--color-surface)] px-3 md:hidden">
        <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)}>
          <Menu size={16} strokeWidth={1.5} />
        </IconButton>
        <div className="min-w-0 flex-1 truncate font-medium text-[13px] text-[var(--color-ink)]">
          {mobileTitle ?? "Hearth"}
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {headerRight}
        </div>
      </header>

      {/* Desktop sidebar */}
      <aside className="hidden w-[232px] shrink-0 flex-col border-[var(--color-rule)] border-r bg-[var(--color-surface)] px-2.5 py-3.5 md:flex">
        {sidebar}
      </aside>

      {/* Mobile drawer (overlays content, not a portal — keeps SSR-less SPA simple) */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
          onClick={() => setDrawerOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDrawerOpen(false);
          }}
        >
          {/* scrim — the parent div is the interactive dismiss target, not this */}
          <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
          <aside
            className={cn(
              "absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col",
              "border-[var(--color-rule)] border-r bg-[var(--color-surface)] px-2.5 py-3.5 shadow-xl",
            )}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {sidebar}
          </aside>
        </div>
      ) : null}

      {/* Main content */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
