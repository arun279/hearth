import { approvedEmails, instanceOperators, sessions, users } from "@hearth/db/schema";
import {
  type ApprovedEmail,
  DomainError,
  type InstanceOperator,
  type UserId,
} from "@hearth/domain";
import type {
  AddApprovedEmailResult,
  AddOperatorResult,
  ApprovedEmailPage,
  BootstrapOutcome,
  InstanceAccessPolicyRepository,
} from "@hearth/ports";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { CloudflareAdapterDeps } from "./deps.ts";

const normalize = (email: string) => email.trim().toLowerCase();

function toOperator(r: typeof instanceOperators.$inferSelect): InstanceOperator {
  return {
    userId: r.userId as UserId,
    grantedAt: r.grantedAt,
    grantedBy: r.grantedBy as UserId,
    revokedAt: r.revokedAt,
    revokedBy: r.revokedBy === null ? null : (r.revokedBy as UserId),
  };
}

function toApprovedEmail(r: typeof approvedEmails.$inferSelect): ApprovedEmail {
  return {
    email: r.email,
    addedBy: r.addedBy as UserId,
    addedAt: r.addedAt,
    note: r.note,
  };
}

/**
 * Base64url of `${addedAt_ms}:${email}`. Tie-break is lexicographic on email
 * because `addedAt` may collide for bulk inserts that share a transaction.
 */
function encodeCursor(row: Pick<ApprovedEmail, "email" | "addedAt">): string {
  const payload = `${row.addedAt.getTime()}:${row.email}`;
  // btoa is available in Workers and Node.
  return btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string): { addedAt: Date; email: string } | null {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded + "===".slice(0, (4 - (padded.length % 4)) % 4));
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    const ms = Number.parseInt(decoded.slice(0, idx), 10);
    if (!Number.isFinite(ms)) return null;
    return { addedAt: new Date(ms), email: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
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
      const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
      const decoded = opts?.cursor ? decodeCursor(opts.cursor) : null;
      // Keyset pagination: newest first by addedAt, tie-break by email.
      // `addedAt < cursor OR (addedAt = cursor AND email > cursorEmail)`
      const baseWhere = decoded
        ? or(
            sql`${approvedEmails.addedAt} < ${decoded.addedAt.getTime()}`,
            and(
              sql`${approvedEmails.addedAt} = ${decoded.addedAt.getTime()}`,
              sql`${approvedEmails.email} > ${decoded.email}`,
            ),
          )
        : undefined;

      const rows = await deps.db
        .select()
        .from(approvedEmails)
        .where(baseWhere)
        .orderBy(desc(approvedEmails.addedAt), asc(approvedEmails.email))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const entries = rows.slice(0, limit).map(toApprovedEmail);
      const last = entries[entries.length - 1];
      // `hasMore` implies entries.length === limit >= 1, so `last` is defined.
      const nextCursor = hasMore && last ? encodeCursor(last) : null;
      return { entries, nextCursor };
    },

    async addApprovedEmail(email, addedBy, note): Promise<AddApprovedEmailResult> {
      await deps.gate.assertWritable();
      const target = normalize(email);
      const existing = await deps.db
        .select()
        .from(approvedEmails)
        .where(eq(approvedEmails.email, target))
        .limit(1);
      if (existing[0]) {
        return { approvedEmail: toApprovedEmail(existing[0]), created: false };
      }
      const now = new Date();
      await deps.db
        .insert(approvedEmails)
        .values({ email: target, addedBy, addedAt: now, note: note ?? null });
      return {
        approvedEmail: { email: target, addedBy, addedAt: now, note: note ?? null },
        created: true,
      };
    },

    async removeApprovedEmail(email, _removedBy) {
      await deps.gate.assertWritable();
      const target = normalize(email);
      // Session cleanup belongs with revocation: deleting the approved email
      // without terminating live sessions would leave previously-admitted
      // users signed in. The pair of writes runs in a single D1 batch so a
      // partial failure leaves the DB consistent.
      await deps.db.batch([
        deps.db
          .delete(sessions)
          .where(
            inArray(
              sessions.userId,
              deps.db.select({ id: users.id }).from(users).where(eq(users.email, target)),
            ),
          ),
        deps.db.delete(approvedEmails).where(eq(approvedEmails.email, target)),
      ]);
    },

    async getApprovedEmail(email): Promise<ApprovedEmail | null> {
      const rows = await deps.db
        .select()
        .from(approvedEmails)
        .where(eq(approvedEmails.email, normalize(email)))
        .limit(1);
      const row = rows[0];
      return row ? toApprovedEmail(row) : null;
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
      const rows = await deps.db
        .select()
        .from(instanceOperators)
        .orderBy(desc(instanceOperators.grantedAt), asc(instanceOperators.userId));
      return rows.map(toOperator);
    },

    async addOperator(userId, grantedBy): Promise<AddOperatorResult> {
      await deps.gate.assertWritable();
      const now = new Date();
      const existing = await deps.db
        .select()
        .from(instanceOperators)
        .where(eq(instanceOperators.userId, userId))
        .limit(1);
      const prior = existing[0];
      // Already an active operator — nothing changes.
      if (prior && prior.revokedAt === null) {
        return { operator: toOperator(prior), created: false };
      }
      // New or previously-revoked: upsert clears revokedAt + revokedBy and
      // records the fresh grant metadata. `created: true` because the state
      // flipped to "active," even if the PK row pre-existed.
      await deps.db
        .insert(instanceOperators)
        .values({ userId, grantedAt: now, grantedBy, revokedAt: null, revokedBy: null })
        .onConflictDoUpdate({
          target: instanceOperators.userId,
          set: { grantedAt: now, grantedBy, revokedAt: null, revokedBy: null },
        });
      return {
        operator: { userId, grantedAt: now, grantedBy, revokedAt: null, revokedBy: null },
        created: true,
      };
    },

    async revokeOperator(userId, revokedBy) {
      await deps.gate.assertWritable();
      // Defense-in-depth atomicity: the orphan invariant is folded INTO the
      // UPDATE's WHERE clause so the count read and the row write happen as
      // one SQLite statement. Two concurrent revokes of distinct targets
      // both see count=2 in the use-case, but at the DB only one statement
      // observes count > 1 and matches a row; the other's subquery sees the
      // first's commit and matches zero. We then read back to distinguish
      // "row already revoked" from "guard refused" — both produce zero
      // affected rows, but only the latter is the orphan case.
      const now = new Date();
      const updated = await deps.db
        .update(instanceOperators)
        .set({ revokedAt: now, revokedBy })
        .where(
          and(
            eq(instanceOperators.userId, userId),
            isNull(instanceOperators.revokedAt),
            sql`(select count(*) from ${instanceOperators} where ${instanceOperators.revokedAt} is null) > 1`,
          ),
        )
        .returning({ userId: instanceOperators.userId });

      if (updated.length > 0) return;

      // Zero rows affected. If the target row is gone or already revoked,
      // the caller's intent is satisfied (idempotent no-op). Otherwise the
      // orphan guard refused.
      const target = await deps.db
        .select({ revokedAt: instanceOperators.revokedAt })
        .from(instanceOperators)
        .where(eq(instanceOperators.userId, userId))
        .limit(1);
      if (target.length === 0 || target[0]?.revokedAt !== null) return;
      throw new DomainError(
        "INVARIANT_VIOLATION",
        "An instance must keep at least one operator.",
        "would_orphan_operator",
      );
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
