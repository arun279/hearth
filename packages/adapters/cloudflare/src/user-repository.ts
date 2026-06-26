import { users } from "@hearth/db/schema";
import {
  type AttributionPreference,
  DomainError,
  type User,
  type UserId,
  type VisibilityPreference,
  visibilityPreferenceEnvelopeSchema,
} from "@hearth/domain";
import type { UserRepository } from "@hearth/ports";
import { eq } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";

/**
 * Read the per-user default visibility from the nullable JSON envelope on
 * `users.visibility_preference_json`. NULL means the user has never set a
 * default, which resolves to the canonical `default` preference; a present
 * but malformed envelope is a stored-invariant violation, surfaced as such
 * rather than silently coerced. Mirrors `parseVisibilityOverride` in
 * `activity-record-repository.ts` — both columns share one envelope schema.
 */
function parseVisibilityPreference(raw: string | null, userId: string): VisibilityPreference {
  if (raw === null) return "default";
  try {
    return visibilityPreferenceEnvelopeSchema.parse(JSON.parse(raw)).data.preference;
  } catch (err) {
    throw new DomainError(
      "INVARIANT_VIOLATION",
      `User ${userId} has invalid visibility_preference_json: ${(err as Error).message}`,
      "envelope_invalid",
    );
  }
}

export function createUserRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
): UserRepository {
  const toUser = (r: typeof users.$inferSelect): User => ({
    id: r.id as UserId,
    email: r.email,
    name: r.name,
    image: r.image,
    deactivatedAt: r.deactivatedAt,
    deletedAt: r.deletedAt,
    attributionPreference: r.attributionPreference as AttributionPreference,
    visibilityPreference: parseVisibilityPreference(r.visibilityPreferenceJson, r.id),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

  return {
    async byId(id) {
      const rows = await deps.db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0] ? toUser(rows[0]) : null;
    },
    async byEmail(email) {
      const rows = await deps.db
        .select()
        .from(users)
        .where(eq(users.email, email.trim().toLowerCase()))
        .limit(1);
      return rows[0] ? toUser(rows[0]) : null;
    },
    async deactivate(id, by) {
      await deps.gate.assertWritable();
      const now = new Date();
      await deps.db
        .update(users)
        .set({ deactivatedAt: now, deactivatedBy: by, updatedAt: now })
        .where(eq(users.id, id));
    },
    async reactivate(id) {
      await deps.gate.assertWritable();
      await deps.db
        .update(users)
        .set({ deactivatedAt: null, deactivatedBy: null, updatedAt: new Date() })
        .where(eq(users.id, id));
    },
    // TODO(m18): user deletion walks every aggregate (memberships,
    // enrollments, activity records, library items uploaded, sessions
    // created) to apply the chosen AttributionPreference. Implementation
    // lands with the User Lifecycle milestone; callers must not invoke
    // this method before.
    async deleteIdentity(_id, _attribution, _by) {
      throw new Error("Not implemented: user deletion requires cross-aggregate coordination");
    },
    async setAttributionPreference(id, pref) {
      await deps.gate.assertWritable();
      await deps.db
        .update(users)
        .set({ attributionPreference: pref, updatedAt: new Date() })
        .where(eq(users.id, id));
    },
  };
}
