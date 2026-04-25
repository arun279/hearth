import {
  addApprovedEmail,
  assignInstanceOperator,
  removeApprovedEmail,
  renameInstance,
  revokeInstanceOperator,
} from "@hearth/core";
import { DomainError, type UserId } from "@hearth/domain";
import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../bindings.ts";
import { getUserId, sessionAuthMiddleware } from "../middleware/session-auth.ts";
import { mapUnknown, problemFromZodError, problemResponse } from "../problem.ts";

/**
 * Email schema. The Zod `z.email()` primitive is more permissive than we
 * want (it accepts addresses like `user@localhost`), so we compose it with
 * a dotted-domain check. The adapter canonicalizes with `.trim().toLowerCase()`
 * — we run the same normalisation here so validation matches what will be
 * stored and looked up.
 */
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .pipe(z.email())
  .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: "Email must include a domain." });

const instanceNameField = z.string().trim().min(1).max(80);
const noteField = z.string().trim().max(500);

const patchSettingsBody = z.object({
  name: instanceNameField,
});

const addEmailBody = z.object({
  email: emailField,
  note: noteField.optional(),
});

const addOperatorBody = z.object({ email: emailField });

const listEmailsQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const listOperatorsQuery = z.object({
  includeRevoked: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

/**
 * Parses the request body as JSON. We intentionally handle the parse error
 * here rather than letting Hono's default 400 propagate — the RFC 7807
 * envelope keeps SPA error handling uniform.
 */
async function readJson(c: {
  req: { json(): Promise<unknown> };
}): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

function invalidJsonProblem() {
  return {
    type: "about:blank#invalid_json",
    title: "invalid json",
    status: 400,
    detail: "Request body must be valid JSON.",
    code: "invalid_json",
  } as const;
}

/**
 * Throws a 403 DomainError unless the user has an active operator row.
 * Used to gate read endpoints that expose PII (approved-email roster,
 * operator roster); write endpoints run the same check inside the
 * use-case via the domain policy layer.
 */
async function assertActiveOperator(
  policy: { getOperator(id: UserId): Promise<{ revokedAt: Date | null } | null> },
  userId: UserId,
  detail: string,
): Promise<void> {
  const operator = await policy.getOperator(userId);
  if (!operator || operator.revokedAt !== null) {
    throw new DomainError("FORBIDDEN", detail, "not_instance_operator");
  }
}

export const instanceRoutes = new Hono<AppBindings>()
  // Everything in this router requires an authenticated session.
  .use("*", sessionAuthMiddleware())

  // ── Settings ──────────────────────────────────────────────────────────
  .get("/settings", async (c) => {
    try {
      const row = await c.var.ports.settings.get();
      if (!row) {
        // The migration seeds the singleton; a missing row means the DB was
        // restored from a backup pre-dating the seed. Treat as 404 so the
        // operator can diagnose rather than silently falling back to
        // "Hearth" here.
        return problemResponse(c, {
          type: "about:blank#settings_missing",
          title: "instance settings missing",
          status: 404,
          detail: "Instance settings row was not found. Run migrations to restore the seed.",
          code: "settings_missing",
        });
      }
      return c.json(row);
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  })
  .patch("/settings", async (c) => {
    const raw = await readJson(c);
    if (!raw.ok) return problemResponse(c, invalidJsonProblem());
    const parsed = patchSettingsBody.safeParse(raw.body);
    if (!parsed.success) return problemResponse(c, problemFromZodError(parsed.error));

    try {
      const row = await renameInstance(
        { actor: getUserId(c), name: parsed.data.name },
        {
          users: c.var.ports.users,
          policy: c.var.ports.policy,
          settings: c.var.ports.settings,
        },
      );
      return c.json(row);
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  })

  // ── Approved Email roster ─────────────────────────────────────────────
  .get("/approved-emails", async (c) => {
    const query = listEmailsQuery.safeParse(c.req.query());
    if (!query.success) return problemResponse(c, problemFromZodError(query.error));
    try {
      // Gate on operator read so a curious participant can't enumerate the
      // allowlist — the column contains PII.
      await assertActiveOperator(
        c.var.ports.policy,
        getUserId(c),
        "Only an Instance Operator may view the Approved Email list.",
      );
      const page = await c.var.ports.policy.listApprovedEmails(query.data);
      return c.json(page);
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  })
  .post("/approved-emails", async (c) => {
    const raw = await readJson(c);
    if (!raw.ok) return problemResponse(c, invalidJsonProblem());
    const parsed = addEmailBody.safeParse(raw.body);
    if (!parsed.success) return problemResponse(c, problemFromZodError(parsed.error));
    try {
      const row = await addApprovedEmail(
        { actor: getUserId(c), ...parsed.data },
        { users: c.var.ports.users, policy: c.var.ports.policy },
      );
      return c.json(row, 201);
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  })
  .delete("/approved-emails/:email", async (c) => {
    const email = decodeURIComponent(c.req.param("email"));
    // Re-validate the path-encoded email so a malformed URL is a 400, not
    // a silent write against garbage input.
    const parsed = emailField.safeParse(email);
    if (!parsed.success) return problemResponse(c, problemFromZodError(parsed.error));
    try {
      await removeApprovedEmail(
        { actor: getUserId(c), email: parsed.data },
        { users: c.var.ports.users, policy: c.var.ports.policy },
      );
      return c.body(null, 204);
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  })

  // ── Operator roster ───────────────────────────────────────────────────
  .get("/operators", async (c) => {
    const query = listOperatorsQuery.safeParse(c.req.query());
    if (!query.success) return problemResponse(c, problemFromZodError(query.error));
    try {
      await assertActiveOperator(
        c.var.ports.policy,
        getUserId(c),
        "Only an Instance Operator may view the operator roster.",
      );
      const rows = await c.var.ports.policy.listOperators();
      const filtered = query.data.includeRevoked ? rows : rows.filter((r) => r.revokedAt === null);
      return c.json({ entries: filtered });
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  })
  .post("/operators", async (c) => {
    const raw = await readJson(c);
    if (!raw.ok) return problemResponse(c, invalidJsonProblem());
    const parsed = addOperatorBody.safeParse(raw.body);
    if (!parsed.success) return problemResponse(c, problemFromZodError(parsed.error));

    try {
      // Operator gate runs BEFORE the email→user lookup so a non-operator
      // probing existence sees the same 403 not_instance_operator regardless
      // of whether the email maps to a user. The use-case re-checks the
      // policy as a defense-in-depth invariant.
      await assertActiveOperator(
        c.var.ports.policy,
        getUserId(c),
        "Only an Instance Operator may grant the operator role.",
      );
      const user = await c.var.ports.users.byEmail(parsed.data.email);
      if (!user) {
        throw new DomainError(
          "INVARIANT_VIOLATION",
          "No signed-in user has this email yet. Approve the email first; they'll appear here after they sign in.",
          "user_not_found",
        );
      }

      const result = await assignInstanceOperator(
        { actor: getUserId(c), target: user.id },
        { users: c.var.ports.users, policy: c.var.ports.policy },
      );
      // 201 when a new operator row landed (or a revoked row was reactivated);
      // 200 when the target was already an active operator and nothing changed.
      return c.json(result.operator, result.created ? 201 : 200);
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  })
  .delete("/operators/:userId", async (c) => {
    const target = c.req.param("userId");
    if (!target || target.length < 1 || target.length > 64) {
      return problemResponse(c, {
        type: "about:blank#invalid_user_id",
        title: "invalid user id",
        status: 400,
        detail: "The userId path parameter is missing or malformed.",
        code: "invalid_user_id",
      });
    }
    try {
      await revokeInstanceOperator(
        { actor: getUserId(c), target: target as UserId },
        { users: c.var.ports.users, policy: c.var.ports.policy },
      );
      return c.body(null, 204);
    } catch (err) {
      return problemResponse(c, mapUnknown(err));
    }
  });
