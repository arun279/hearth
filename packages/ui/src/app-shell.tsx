import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Drawer } from "./drawer.tsx";
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
      {/* Skip-to-main bypass block (WCAG 2.4.1). `tabindex="-1"` on the
          target lets the link move focus to a non-focusable landmark. */}
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[60] focus-visible:rounded-[var(--radius-sm)] focus-visible:bg-[var(--color-accent)] focus-visible:px-3 focus-visible:py-1.5 focus-visible:font-medium focus-visible:text-[13px] focus-visible:text-[var(--color-accent-on)] focus-visible:shadow-lg"
      >
        Skip to main content
      </a>

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

      <div className="md:hidden">
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="navigation">
          {sidebar}
        </Drawer>
      </div>

      {/* Main content */}
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 focus-visible:outline-none">
        {children}
      </main>
    </div>
  );
}
