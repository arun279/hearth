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

- [x] `Popover` — open/close, outside-click + Escape close (with `stopPropagation` so a parent dialog stays open), focus-into-panel on open and focus-restore-to-trigger on close, free Tab (not trapped), above/below repositioning.
- [x] `RadioGroup` — controlled selection round-trip + checked-mirror, disabled-fieldset suppresses the callback. (Tone/adornment/legend are pure prop→markup mappings; they stay at the SSR-string altitude, not in this DOM test.)
- [x] `Modal` / `dialog-keyboard` — focus trap (Tab/Shift+Tab wrap), Escape on the topmost of a stack only, `inert` on lower panels, focus restoration to the trigger + re-trap into the parent on nested-dialog close, scrim-button close.
- [x] `TabBar` — Arrow/Home/End keyboard nav with wrap, the `moveFocusOnNextChange` gate (keyboard nav moves DOM focus + rolls the roving tabindex; an external value change does not), click path does not arm the focus-move.
- [x] `Drawer` — divergent surface only (left/right edge anchoring, visible scrim + header close affordances, z-40-under-Modal-z-50 so a confirm Modal takes Escape). The shared `useDialogPanel` contract is covered once via `Modal` above.
- [x] `Avatar` — the `img.onError` → initials-fallback transition (the one stateful branch; hue/initials/static-src are unit/SSR).
- [ ] `SaveIndicator` — already covered by `packages/ui/test/save-indicator.test.tsx` (idle/saving/saved/error states + the retry affordance's focus ring + the `onRetry` handler wiring asserted by tree-walk). It is a pure stateless props→markup component with no internal state, fetch, or timers; a DOM test would only re-click an already-asserted handler binding, so it stays at the SSR-string altitude.

### Pending — feature components (`apps/web`)

- [x] `groups/create-group-dialog` + `groups/group-settings-dialog` — RHF + Zod resolver wiring; the empty-submit resolver-version tripwire, server-error→field binding, dirty-gate, prop re-hydration, archived read-only, archive-confirm error latch + retry, close-blocked-while-pending.
- [x] `groups/invite-dialog` — onChange submit gate, form→result toggle, copy success/fallback fork, emailApproved warning Callout, reset-on-reopen.
- [x] `groups/group-members-dialog` — query loading/empty/data fork, per-row capability gating, discriminated-union confirm copy/tone, role-change error latch + retry, close-blocked-while-pending.
- [x] `groups/leave-group-dialog` — case-insensitive + whitespace-normalized type-to-confirm gate (internal whitespace significant), attribution radio → mutateAsync payload, reset-on-reopen.
- [x] `groups/avatar-uploader` — client-side MIME rejection, post-resize size-cap rejection, success upload, upload-vs-remove pending gates, file-input reset.
- [x] `groups/invitations-panel` — query loading/empty/data fork, status→action-visibility mapping, copy success/fallback fork, revoke-confirm error latch + retry.
- [x] `library/upload-dialog` — the Reserving → Uploading → Finalizing stage machine, progress-percent math, cancel-only-during-uploading, abort-silent-reset vs latched-error, MIME/size rejection, quota block/warn fork, revision-mode field hiding, close-reset.
- [x] `library/library-item-detail` — query loading-vs-data fork, retire type-to-confirm success/close, retire error latch + retry, no-error-carry-over across reopen, archived/retired affordance gating, focus restore on sub-dialog close, Upload-revision opens the nested UploadDialog in revision mode. (The "retire flow" the upload-dialog entry referenced lives here, not in UploadDialog.)
- [ ] `library` search — debounce, "Load more" cursor exhaustion, and the `isError` vs empty branches.
- [x] `admin` tabs — `settings-tab` (query loading/error/data fork, hydrate-on-data, dirty-gate, server-error→name binding, isSubmitting button/input flip, empty-submit resolver tripwire), `operators-tab` (current-vs-revoked split, isSelf/onlyOneOperator revoke gating with reason-specific tooltip, grant sub-form server-error→email binding + reset-on-success, revoke confirm error latch + retry), `approved-emails-tab` (single-row Zod + server-error binding, the bulk-paste iterative loop — per-row format-skip / duplicate-mapping / mixed partial-success textarea-clear / all-fail textarea-retention, remove confirm error latch). The shared confirm dialog is seeded above.
- [ ] `tracks` dialogs and `activities` composer — the audience picker (subset roster) and the dirty-discard confirm guard.
- [x] `sign-in-screen` — raw-`fetch` OAuth handshake (pending latch + Better Auth request shape), failure→danger Callout→clear-on-retry, OK-but-missing-URL error, and the rejection/bootstrap admission Callouts co-rendering with the error.

## How to add coverage

1. Name the file `<component>.dom.test.tsx`, co-located with the component under `apps/web/src/**` (or `packages/ui/test/**` for primitives).
2. Mount via `renderWithProviders` (`apps/web/src/test/render.tsx`) or `renderPrimitive` (`packages/ui/src/test/render.tsx`); use `installFetchSpy` for components that call the global `fetch` directly.
3. Target the interaction branches e2e can't economically reach (race windows, no-op skips, error→retry transitions) — do not re-pin happy-path journeys.
4. Check the box here in the same PR.
