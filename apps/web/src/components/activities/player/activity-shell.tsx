import { ThemeToggle } from "@hearth/ui";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  readonly groupId: string;
  readonly trackId: string;
  readonly children: ReactNode;
};

/**
 * Full-viewport chrome for the Activity Player. Deliberately does NOT
 * wrap content in the standard `AppShell` (no sidebar / mobile tab bar
 * / top breadcrumb chrome) so the reading surface gets the full screen.
 * The only persistent affordance is a tight top strip: back-to-track
 * link + theme toggle. Everything else is the activity itself.
 *
 * The back link reads "Back to track" rather than the track's actual
 * name because the player projection deliberately doesn't carry the
 * parent-track payload — adding one round-trip to render a four-word
 * label trades real round-trip budget for a marginal recall cue, and
 * the parent breadcrumb already lives one route up.
 *
 * Matches the calm-design intent — the player is a reading mode, not a
 * dashboard. Breadcrumbs and global navigation drop out so the activity
 * is the only thing the eye lands on.
 */
export function ActivityShell({ groupId, trackId, children }: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[60] focus-visible:rounded-[var(--radius-sm)] focus-visible:bg-[var(--color-accent)] focus-visible:px-3 focus-visible:py-1.5 focus-visible:font-medium focus-visible:text-[13px] focus-visible:text-[var(--color-accent-on)] focus-visible:shadow-lg"
      >
        Skip to main content
      </a>

      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-[var(--color-rule)] border-b bg-[var(--color-surface)] px-3 md:px-5">
        <Link
          to="/g/$groupId/t/$trackId"
          params={{ groupId, trackId }}
          search={{}}
          className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-[var(--radius-sm)] px-2 py-1 text-[13px] text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="truncate">Back to track</span>
        </Link>
        <ThemeToggle />
      </header>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 focus-visible:outline-none">
        {children}
      </main>
    </div>
  );
}
