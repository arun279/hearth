# Component (DOM) test backlog

The SPA's happy-dom component-test layer (`*.dom.test.tsx`, routed to the `dom` vitest project) is the altitude for stateful UI behaviour — user events, async transitions, focus, fetch-driven state, timers/debounce, visibility/unmount effects. The test-altitude rule in `AGENTS.md` makes a DOM test the default for any new interactive component; this list is the **retroactive** backlog of already-shipped components that warrant DOM coverage, in priority order.

The M10 interactive Parts are seeded (see below). Everything under "Pending" is tracked work — pick from the top. New interactive components do not go here: they ship with their DOM test in the same PR.

## Priority order

Highest leverage first. Primitives lead because every feature composes them, so one covered primitive protects many call sites.

### Seeded (done)

- [x] `activities/player/parts/reflect-part` — autosave debounce transitions, retry-calls-persist, monotonic `lastSaved`, visibilitychange/unmount keepalive flush + no-pending-change skip.
- [x] `activities/player/parts/quiz-part` — `ScoreSummary` `gradeable === 0` branch, short-answer submit round-trip, verdict-clears-on-edit.
- [x] `activities/activity-composer` — add-accept-row (blank row dropped), Match-exactly note swap, submit-error field binding (aria-invalid / aria-describedby / focus).
- [x] `activities/player/visibility-selector` — popover radios select a scope, "Use my default" clear round-trip, in-panel SaveIndicator settling.
- [x] `admin/confirm-action-dialog` — session-scoped error latch (suppress → confirm→fail→Callout → reopen suppressed), focus restoration on nested close.

### Pending — primitives (`packages/ui`)

Cover the interaction-bearing primitives with `renderPrimitive`.

- [ ] `Popover` — open/close, outside-click + Escape close, focus-into-panel on open and focus-restore-to-trigger on close, above/below repositioning.
- [ ] `RadioGroup` — selection round-trip, disabled state, the result-tone (graded) option rendering with its non-colour adornment.
- [ ] `Modal` / `dialog-keyboard` — focus trap (Tab/Shift+Tab wrap), Escape on the topmost of a stack only, `inert` on lower panels, focus restoration across a nested-dialog close.
- [ ] `SaveIndicator` — idle renders nothing; saving/saved/error states; the error state's retry affordance.

### Pending — feature components (`apps/web`)

- [ ] `groups/create-group-dialog` + `groups/group-settings-dialog` — RHF + Zod resolver wiring; the empty-submit assertion (the resolver-version tripwire) is e2e-only today and belongs at this altitude.
- [ ] `library/upload-dialog` — the Reserving → Uploading → Finalizing state machine and the retire flow.
- [ ] `library` search — debounce, "Load more" cursor exhaustion, and the `isError` vs empty branches.
- [ ] `admin` tabs — operator/approved-email list mutations and their error/confirm surfaces (the shared confirm dialog is seeded above).
- [ ] `tracks` dialogs and `activities` composer — the audience picker (subset roster) and the dirty-discard confirm guard.

## How to add coverage

1. Name the file `<component>.dom.test.tsx`, co-located with the component under `apps/web/src/**` (or `packages/ui/test/**` for primitives).
2. Mount via `renderWithProviders` (`apps/web/src/test/render.tsx`) or `renderPrimitive` (`packages/ui/src/test/render.tsx`); use `installFetchSpy` for components that call the global `fetch` directly.
3. Target the interaction branches e2e can't economically reach (race windows, no-op skips, error→retry transitions) — do not re-pin happy-path journeys.
4. Check the box here in the same PR.
