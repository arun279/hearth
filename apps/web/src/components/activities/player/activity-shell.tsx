import type { MeContext } from "@hearth/domain";
import { Drawer, IconButton, ThemeToggle } from "@hearth/ui";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Sidebar } from "../../sidebar.tsx";

type Props = {
  readonly groupId: string;
  readonly trackId: string;
  /** Group / track names for the orientation breadcrumb; null until loaded. */
  readonly groupName: string | null;
  readonly trackName: string | null;
  /** Drives the mobile drawer's nav so global navigation is reachable at 390px. */
  readonly me: MeContext["data"] | null;
  readonly children: ReactNode;
};

/**
 * Full-viewport chrome for the Activity Player — a focus mode that keeps the
 * reading/writing surface front and centre. It deliberately does NOT mount the
 * persistent desktop nav sidebar so the activity owns the screen; orientation
 * and recoverability come from a thin top strip instead:
 *
 *   - a hamburger (below `md`) that opens the global nav in a Drawer, so the
 *     app is never a one-way island on mobile;
 *   - an orientation breadcrumb (Your groups / group / track) so the deepest
 *     screen still shows where it sits;
 *   - the standing "Back to track" focus-exit;
 *   - the theme toggle.
 *
 * The host is `h-dvh` (the dynamic viewport unit — `100vh` overflows behind
 * mobile browser chrome) so the column fills the visible area exactly; `<main>`
 * is a flex column whose body owns the single scroll region, which pins the
 * sticky footer to the true bottom.
 */
export function ActivityShell({ groupId, trackId, groupName, trackName, me, children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-bg)]">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[60] focus-visible:rounded-[var(--radius-sm)] focus-visible:bg-[var(--color-accent)] focus-visible:px-3 focus-visible:py-1.5 focus-visible:font-medium focus-visible:text-[13px] focus-visible:text-[var(--color-accent-on)] focus-visible:shadow-lg"
      >
        Skip to main content
      </a>

      <header className="flex h-12 shrink-0 items-center gap-2 border-[var(--color-rule)] border-b bg-[var(--color-surface)] px-3 md:px-5">
        <div className="md:hidden">
          <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)}>
            <Menu size={16} strokeWidth={1.5} />
          </IconButton>
        </div>
        <Link
          to="/g/$groupId/t/$trackId"
          params={{ groupId, trackId }}
          search={{}}
          className="inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[13px] text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="truncate">Back to track</span>
        </Link>
        <PlayerBreadcrumb
          groupId={groupId}
          trackId={trackId}
          groupName={groupName}
          trackName={trackName}
        />
        <div className="ms-auto shrink-0">
          <ThemeToggle />
        </div>
      </header>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label="navigation">
        <Sidebar me={me} />
      </Drawer>

      <main
        id="main"
        tabIndex={-1}
        className="flex min-h-0 min-w-0 flex-1 flex-col focus-visible:outline-none"
      >
        {children}
      </main>
    </div>
  );
}

/**
 * Orientation breadcrumb for the focus-mode shell: Your groups / group / track.
 * Hidden below `md` (the hamburger + "Back to track" carry orientation on the
 * narrow strip); the group/track names resolve from the cached track query, so
 * they fall back to nothing rather than flashing placeholder text.
 */
function PlayerBreadcrumb({
  groupId,
  trackId,
  groupName,
  trackName,
}: {
  readonly groupId: string;
  readonly trackId: string;
  readonly groupName: string | null;
  readonly trackName: string | null;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden min-w-0 items-center gap-2 text-[12px] text-[var(--color-ink-2)] md:flex"
    >
      <span aria-hidden="true">/</span>
      <Link to="/" search={{}} className="shrink-0 hover:text-[var(--color-ink)]">
        Your groups
      </Link>
      {groupName ? (
        <>
          <span aria-hidden="true">/</span>
          <Link
            to="/g/$groupId"
            params={{ groupId }}
            search={{}}
            className="truncate hover:text-[var(--color-ink)]"
          >
            {groupName}
          </Link>
        </>
      ) : null}
      {trackName ? (
        <>
          <span aria-hidden="true">/</span>
          <Link
            to="/g/$groupId/t/$trackId"
            params={{ groupId, trackId }}
            search={{}}
            className="truncate hover:text-[var(--color-ink)]"
          >
            {trackName}
          </Link>
        </>
      ) : null}
    </nav>
  );
}
