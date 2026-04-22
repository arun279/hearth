import { users } from "@hearth/db/schema";
import type { AttributionPreference, User, UserId } from "@hearth/domain";
import type { UserRepository } from "@hearth/ports";
import { eq } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";

export function createUserRepository(deps: Pick<CloudflareAdapterDeps, "db">): UserRepository {
  const toUser = (r: typeof users.$inferSelect): User => ({
    id: r.id as UserId,
    email: r.email,
    name: r.name,
    image: r.image,
    deactivatedAt: r.deactivatedAt,
    deletedAt: r.deletedAt,
    attributionPreference: r.attributionPreference as AttributionPreference,
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
      const now = new Date();
      await deps.db
        .update(users)
        .set({ deactivatedAt: now, deactivatedBy: by, updatedAt: now })
        .where(eq(users.id, id));
    },
    async reactivate(id) {
      await deps.db
        .update(users)
        .set({ deactivatedAt: null, deactivatedBy: null, updatedAt: new Date() })
        .where(eq(users.id, id));
    },
    // TODO(scaffolding): user deletion walks every aggregate (memberships,
    // enrollments, activity records, library items uploaded, sessions created)
    // to apply the chosen AttributionPreference. Implement when a user-deletion
    // path is exercised; currently callers must not invoke this method.
    async deleteIdentity(_id, _attribution, _by) {
      throw new Error("Not implemented: user deletion requires cross-aggregate coordination");
    },
    async setAttributionPreference(id, pref) {
      await deps.db
        .update(users)
        .set({ attributionPreference: pref, updatedAt: new Date() })
        .where(eq(users.id, id));
    },
  };
}
