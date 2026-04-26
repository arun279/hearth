import type { GroupMembership } from "./group.ts";
import type { UserId } from "./ids.ts";
import type { TrackEnrollment } from "./track.ts";

/**
 * Minimal user projection returned to the SPA. Deliberately omits lifecycle
 * fields so deactivated-state leaks cannot happen from this endpoint.
 */
export type MeContextUser = {
  readonly id: UserId;
  readonly email: string;
  readonly name: string | null;
  readonly image: string | null;
};

export type MeContextInstance = {
  readonly name: string;
  /**
   * True iff zero active instance operators exist. The SPA surfaces a
   * bootstrap hint on the sign-in landing when this is true so the first
   * configured operator knows what to expect.
   */
  readonly needsBootstrap: boolean;
  /**
   * Public read origin for R2-stored assets (avatars in M3, library
   * objects in M5). Either the bucket's `pub-…r2.dev` dev URL or a
   * custom domain. Server-controlled config, surfaced here so the SPA
   * doesn't need a parallel build-time env var that can drift from the
   * worker's truth — see `docs/dev-runbook.md` § "R2 bucket setup".
   */
  readonly r2PublicOrigin: string;
};

/**
 * Versioned envelope so future field additions remain backwards-compatible
 * with clients that were bundled against an earlier shape. Anything inside
 * `data` can be extended additively; a structural break would bump `v`.
 */
export type MeContext = {
  readonly v: 1;
  readonly data: {
    readonly user: MeContextUser | null;
    readonly instance: MeContextInstance;
    readonly isOperator: boolean;
    readonly memberships: readonly GroupMembership[];
    readonly enrollments: readonly TrackEnrollment[];
  };
};
