import { approvedEmails, instanceOperators } from "@hearth/db/schema";
import type { ApprovedEmail, InstanceOperator, UserId } from "@hearth/domain";
import type {
  ApprovedEmailPage,
  BootstrapOutcome,
  InstanceAccessPolicyRepository,
} from "@hearth/ports";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";

const normalize = (email: string) => email.trim().toLowerCase();

function toOperator(r: typeof instanceOperators.$inferSelect): InstanceOperator {
  return {
    userId: r.userId as UserId,
    grantedAt: r.grantedAt,
    grantedBy: r.grantedBy as UserId,
    revokedAt: r.revokedAt,
  };
}

export function createInstanceAccessPolicyRepository(
  deps: Pick<CloudflareAdapterDeps, "db" | "gate">,
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
      await deps.gate.assertWritable();
      const target = normalize(email);
      const now = new Date();
      await deps.db
        .insert(approvedEmails)
        .values({ email: target, addedBy, addedAt: now, note: note ?? null })
        .onConflictDoNothing();
      return { email: target, addedBy, addedAt: now, note: note ?? null };
    },
    async removeApprovedEmail(email, _removedBy) {
      await deps.gate.assertWritable();
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

    async getOperator(userId) {
      const rows = await deps.db
        .select()
        .from(instanceOperators)
        .where(eq(instanceOperators.userId, userId))
        .limit(1);
      return rows[0] ? toOperator(rows[0]) : null;
    },
    async isOperator(userId) {
      const rows = await deps.db
        .select({ n: sql<number>`1` })
        .from(instanceOperators)
        .where(and(eq(instanceOperators.userId, userId), isNull(instanceOperators.revokedAt)))
        .limit(1);
      return rows.length > 0;
    },
    async listOperators() {
      const rows = await deps.db.select().from(instanceOperators);
      return rows.map(toOperator);
    },
    async addOperator(userId, grantedBy): Promise<InstanceOperator> {
      await deps.gate.assertWritable();
      const now = new Date();
      await deps.db
        .insert(instanceOperators)
        .values({ userId, grantedAt: now, grantedBy, revokedAt: null })
        .onConflictDoUpdate({
          target: instanceOperators.userId,
          set: { grantedAt: now, grantedBy, revokedAt: null },
        });
      return { userId, grantedAt: now, grantedBy, revokedAt: null };
    },
    async revokeOperator(userId, _revokedBy) {
      await deps.gate.assertWritable();
      const now = new Date();
      await deps.db
        .update(instanceOperators)
        .set({ revokedAt: now })
        .where(eq(instanceOperators.userId, userId));
    },
    async countActiveOperators() {
      const rows = await deps.db
        .select({ n: sql<number>`count(*)` })
        .from(instanceOperators)
        .where(isNull(instanceOperators.revokedAt));
      return Number(rows[0]?.n ?? 0);
    },

    async bootstrapIfNeeded({
      candidateEmail,
      bootstrapEmail,
      candidateUserId,
    }): Promise<BootstrapOutcome> {
      // Deliberately does NOT call gate.assertWritable — this path runs
      // during the first sign-in of an instance that has no operator yet,
      // which is exactly when the killswitch default of "normal" is in
      // effect. If an operator has already configured read_only or
      // disabled, the bootstrap conditions (zero operators) cannot hold.
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
