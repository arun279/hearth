import { approvedEmails, instanceOperators } from "@hearth/db/schema";
import type { ApprovedEmail, UserId } from "@hearth/domain";
import type {
  ApprovedEmailPage,
  BootstrapOutcome,
  InstanceAccessPolicyRepository,
} from "@hearth/ports";
import { eq, isNull, sql } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";

const normalize = (email: string) => email.trim().toLowerCase();

export function createInstanceAccessPolicyRepository(
  deps: Pick<CloudflareAdapterDeps, "db">,
): InstanceAccessPolicyRepository {
  return {
    async isEmailApproved(email) {
      const target = normalize(email);
      const rows = await deps.db
        .select({ n: sql<number>`1` })
        .from(approvedEmails)
        .where(eq(approvedEmails.email, target))
        .limit(1);
      return rows.length > 0;
    },
    async listApprovedEmails(opts): Promise<ApprovedEmailPage> {
      const limit = Math.min(opts?.limit ?? 50, 200);
      const rows = await deps.db.select().from(approvedEmails).limit(limit);
      return {
        entries: rows.map((r) => ({
          email: r.email,
          addedBy: r.addedBy as UserId,
          addedAt: r.addedAt,
          note: r.note,
        })),
        nextCursor: null,
      };
    },
    async addApprovedEmail(email, addedBy, note): Promise<ApprovedEmail> {
      const target = normalize(email);
      const now = new Date();
      await deps.db
        .insert(approvedEmails)
        .values({ email: target, addedBy, addedAt: now, note: note ?? null })
        .onConflictDoNothing();
      return { email: target, addedBy, addedAt: now, note: note ?? null };
    },
    async removeApprovedEmail(email, _removedBy) {
      await deps.db.delete(approvedEmails).where(eq(approvedEmails.email, normalize(email)));
    },
    async getApprovedEmail(email): Promise<ApprovedEmail | null> {
      const rows = await deps.db
        .select()
        .from(approvedEmails)
        .where(eq(approvedEmails.email, normalize(email)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        email: row.email,
        addedBy: row.addedBy as UserId,
        addedAt: row.addedAt,
        note: row.note,
      };
    },

    async bootstrapIfNeeded({
      candidateEmail,
      bootstrapEmail,
      candidateUserId,
    }): Promise<BootstrapOutcome> {
      const candidate = normalize(candidateEmail);
      const bootstrap = normalize(bootstrapEmail);
      if (!bootstrap || candidate !== bootstrap) {
        return { kind: "not_eligible" };
      }

      const existing = await deps.db
        .select({ n: sql<number>`1` })
        .from(instanceOperators)
        .where(isNull(instanceOperators.revokedAt))
        .limit(1);
      if (existing.length > 0) {
        return { kind: "not_needed" };
      }

      const now = new Date();
      // Idempotent: concurrent bootstrap races resolve via the unique PKs.
      // Drizzle-D1 batch gives single-request atomicity without requiring
      // the full .transaction() API (not available in all D1 adapter versions).
      await deps.db.batch([
        deps.db
          .insert(approvedEmails)
          .values({
            email: candidate,
            addedBy: candidateUserId,
            addedAt: now,
            note: "Bootstrap operator auto-seed",
          })
          .onConflictDoNothing(),
        deps.db
          .insert(instanceOperators)
          .values({
            userId: candidateUserId,
            grantedAt: now,
            grantedBy: candidateUserId,
            revokedAt: null,
          })
          .onConflictDoNothing(),
      ]);

      return { kind: "seeded", operatorUserId: candidateUserId };
    },
  };
}
