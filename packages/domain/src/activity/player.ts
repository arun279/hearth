import type { ActivityAccessState, LearningActivity } from "./types.ts";

/**
 * Viewer's enrollment posture relative to the activity's parent track.
 * The Activity Player route uses this to gate per-Part affordances
 * (e.g., facilitators see the "Edit composer" link; non-enrolled group
 * admins see the activity as read-only). M11 layers per-record state
 * on top.
 */
export type ViewerEnrollmentStatus = "facilitator" | "participant" | "not_enrolled";

/**
 * Per-Part library resolution. Only Parts whose kind references a
 * Library Item (`read_library_item`, `listen_audio`, `watch_video`)
 * surface here — `embed` Parts carry their URL inline on the Part body,
 * and `write_reflection` / `quiz` / `attend_session` carry no library
 * dependency. The SPA renderer reads the matching entry by `partId`.
 *
 * `readUrlExpiresAt` is the instant the signed-GET URL stops working;
 * a future refresh path will refetch the player projection when a Part
 * mount approaches expiry. v1 just renders against the URL and lets the
 * browser surface a 403 on the rare TTL miss — the player refetches in
 * a subsequent milestone.
 */
export type ResolvedLibraryRef = {
  readonly partId: string;
  readonly libraryItemId: string;
  readonly revisionId: string;
  /** `true` when the activity pinned a specific revision; `false` when current was resolved. */
  readonly isPinned: boolean;
  readonly mimeType: string;
  readonly readUrl: string;
  readonly readUrlExpiresAt: Date;
};

export type ActivityPlayerViewer = {
  readonly enrollmentStatus: ViewerEnrollmentStatus;
};

/**
 * Wire shape returned by `GET /api/v1/activities/:id/player`. Shared
 * between `@hearth/core`'s use case (its return type), the API route's
 * response body, and `apps/web`'s React Query hook + components — one
 * source of truth, no shape drift across layers.
 */
export type ActivityPlayerProjection = {
  readonly activity: LearningActivity;
  readonly resolvedRefs: readonly ResolvedLibraryRef[];
  readonly accessState: ActivityAccessState;
  readonly viewer: ActivityPlayerViewer;
};
