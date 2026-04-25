import type {
  ApprovedEmail,
  InstanceOperator,
  InstanceSettings,
  User,
  UserId,
} from "@hearth/domain";
import type {
  AddApprovedEmailResult,
  AddOperatorResult,
  InstanceAccessPolicyRepository,
  InstanceSettingsRepository,
  KillswitchGate,
  SystemFlagRepository,
  UserRepository,
} from "@hearth/ports";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../src/bindings.ts";
import { createApiRouter } from "../src/index.ts";

type Ports = AppBindings["Variables"]["ports"];

function throwingProxy<T extends object>(label: string): T {
  return new Proxy({} as T, {
    get(_, key) {
      if (typeof key === "symbol") return undefined;
      return () => {
        throw new Error(`unexpected call: ${label}.${String(key)}`);
      };
    },
  });
}

function buildPorts(overrides: Partial<Ports>): Ports {
  return {
    policy: throwingProxy<InstanceAccessPolicyRepository>("policy"),
    settings: throwingProxy<InstanceSettingsRepository>("settings"),
    users: throwingProxy<UserRepository>("users"),
    groups: throwingProxy<Ports["groups"]>("groups"),
    tracks: throwingProxy<Ports["tracks"]>("tracks"),
    libraryItems: throwingProxy<Ports["libraryItems"]>("libraryItems"),
    activities: throwingProxy<Ports["activities"]>("activities"),
    records: throwingProxy<Ports["records"]>("records"),
    sessions: throwingProxy<Ports["sessions"]>("sessions"),
    storage: throwingProxy<Ports["storage"]>("storage"),
    flags: throwingProxy<SystemFlagRepository>("flags"),
    clock: { now: () => new Date("2026-04-22T00:00:00.000Z") },
    ids: { generate: () => "id_test" },
    ...overrides,
  };
}

function harness(opts: {
  userId: string | null;
  ports: Partial<Ports>;
  killswitchMode?: "normal" | "read_only" | "disabled";
}) {
  const mode = opts.killswitchMode ?? "normal";
  const gate: KillswitchGate = {
    getMode: async () => mode,
    assertWritable: async () => {
      if (mode !== "normal") throw new Error(`killswitch: ${mode}`);
    },
    invalidate: () => {},
  };
  const app = new Hono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("userId", opts.userId);
    c.set("auth", { handler: async () => new Response(null) });
    c.set("gate", gate);
    c.set("adminToken", "a".repeat(64));
    c.set("writeLimiter", { limit: async () => ({ success: true }) });
    c.set("authLimiter", { limit: async () => ({ success: true }) });
    c.set("ports", buildPorts(opts.ports));
    await next();
  });
  app.route("/api/v1", createApiRouter());
  return app;
}

const now = new Date("2026-04-22T00:00:00.000Z");
const opId = "u_op" as UserId;
const anotherId = "u_other" as UserId;

const actorUser: User = {
  id: opId,
  email: "op@example.com",
  name: "Op",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

const actorOp: InstanceOperator = {
  userId: opId,
  grantedAt: now,
  grantedBy: opId,
  revokedAt: null,
  revokedBy: null,
};

function baseOperatorPolicy(overrides: Partial<InstanceAccessPolicyRepository> = {}) {
  return {
    ...throwingProxy<InstanceAccessPolicyRepository>("policy"),
    getOperator: vi.fn(async (id: UserId) => (id === opId ? actorOp : null)),
    isOperator: vi.fn(async () => true),
    countActiveOperators: vi.fn(async () => 2),
    ...overrides,
  } as InstanceAccessPolicyRepository;
}

function baseUsers(overrides: Partial<UserRepository> = {}): UserRepository {
  return {
    byId: vi.fn(async (id) => (id === opId ? actorUser : null)),
    byEmail: vi.fn(async () => null),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
    ...overrides,
  };
}

const settings: InstanceSettings = {
  name: "Tuesday Night Learners",
  updatedAt: now,
  updatedBy: opId,
};

describe("GET /api/v1/instance/settings", () => {
  it("200s the singleton for any signed-in user", async () => {
    const app = harness({
      userId: opId,
      ports: {
        settings: { get: async () => settings, update: vi.fn() },
      },
    });
    const res = await app.request("/api/v1/instance/settings");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Tuesday Night Learners");
  });

  it("401s when unauthenticated", async () => {
    const app = harness({ userId: null, ports: {} });
    const res = await app.request("/api/v1/instance/settings");
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("problem+json");
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unauthenticated");
  });

  it("404s with settings_missing when the singleton row is absent", async () => {
    const app = harness({
      userId: opId,
      ports: { settings: { get: async () => null, update: vi.fn() } },
    });
    const res = await app.request("/api/v1/instance/settings");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("settings_missing");
  });

  it("maps adapter throws on GET into a problem+json envelope", async () => {
    const app = harness({
      userId: opId,
      ports: {
        settings: {
          get: async () => {
            throw new Error("d1 unreachable");
          },
          update: vi.fn(),
        },
      },
    });
    const res = await app.request("/api/v1/instance/settings");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("problem+json");
  });
});

describe("PATCH /api/v1/instance/settings", () => {
  it("renames and echoes the row to the operator", async () => {
    const update = vi.fn(async () => settings);
    const app = harness({
      userId: opId,
      ports: {
        settings: { get: async () => null, update },
        policy: baseOperatorPolicy(),
        users: baseUsers(),
      },
    });
    const res = await app.request("/api/v1/instance/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Tuesday Night Learners" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Tuesday Night Learners");
    expect(update).toHaveBeenCalledWith({ name: "Tuesday Night Learners" }, opId);
  });

  it("422s when the name is empty", async () => {
    const app = harness({
      userId: opId,
      ports: {
        settings: { get: async () => null, update: vi.fn() },
        policy: baseOperatorPolicy(),
        users: baseUsers(),
      },
    });
    const res = await app.request("/api/v1/instance/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    // Zod validation fires before the use case; the API emits a 400
    // validation envelope distinct from the 422 invariant violation that
    // the use case would throw on boundary cases the schema couldn't catch.
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("403s with not_instance_operator when a non-operator tries to rename", async () => {
    const app = harness({
      userId: anotherId,
      ports: {
        settings: { get: async () => null, update: vi.fn() },
        policy: {
          ...throwingProxy<InstanceAccessPolicyRepository>("policy"),
          getOperator: vi.fn(async () => null),
        } as InstanceAccessPolicyRepository,
        users: baseUsers({
          byId: vi.fn(async () => ({ ...actorUser, id: anotherId, email: "x@y.com" })),
        }),
      },
    });
    const res = await app.request("/api/v1/instance/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Whatever" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; policy?: { code: string } };
    expect(body.policy?.code).toBe("not_instance_operator");
  });

  it("400s on malformed JSON", async () => {
    const app = harness({
      userId: opId,
      ports: {
        settings: { get: async () => null, update: vi.fn() },
        policy: baseOperatorPolicy(),
        users: baseUsers(),
      },
    });
    const res = await app.request("/api/v1/instance/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_json");
  });
});

describe("approved emails", () => {
  it("POST 201s a fresh row", async () => {
    const row: ApprovedEmail = {
      email: "new@example.com",
      addedBy: opId,
      addedAt: now,
      note: null,
    };
    const add = vi.fn(
      async (): Promise<AddApprovedEmailResult> => ({ approvedEmail: row, created: true }),
    );
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({ addApprovedEmail: add }),
        users: baseUsers(),
      },
    });
    const res = await app.request("/api/v1/instance/approved-emails", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "New@Example.COM" }),
    });
    expect(res.status).toBe(201);
    expect(add).toHaveBeenCalledWith("new@example.com", opId, undefined);
  });

  it("POST 409s a duplicate", async () => {
    const row: ApprovedEmail = {
      email: "dup@example.com",
      addedBy: opId,
      addedAt: now,
      note: null,
    };
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({
          addApprovedEmail: vi.fn(async () => ({ approvedEmail: row, created: false })),
        }),
        users: baseUsers(),
      },
    });
    const res = await app.request("/api/v1/instance/approved-emails", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "dup@example.com" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("already_exists");
  });

  it("GET lists, gated on operator", async () => {
    const page = { entries: [], nextCursor: null };
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({ listApprovedEmails: vi.fn(async () => page) }),
      },
    });
    const res = await app.request("/api/v1/instance/approved-emails");
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof page;
    expect(body).toEqual(page);
  });

  it("GET 403s a non-operator", async () => {
    const app = harness({
      userId: anotherId,
      ports: {
        policy: {
          ...throwingProxy<InstanceAccessPolicyRepository>("policy"),
          getOperator: vi.fn(async () => null),
        } as InstanceAccessPolicyRepository,
      },
    });
    const res = await app.request("/api/v1/instance/approved-emails");
    expect(res.status).toBe(403);
  });

  it("DELETE 204s and canonicalizes path casing", async () => {
    const remove = vi.fn();
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({ removeApprovedEmail: remove }),
        users: baseUsers(),
      },
    });
    const res = await app.request(
      `/api/v1/instance/approved-emails/${encodeURIComponent("Guest@Example.COM")}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(204);
    expect(remove).toHaveBeenCalledWith("guest@example.com", opId);
  });

  it("DELETE 400s on a malformed email path param", async () => {
    const app = harness({
      userId: opId,
      ports: { policy: baseOperatorPolicy(), users: baseUsers() },
    });
    const res = await app.request(
      `/api/v1/instance/approved-emails/${encodeURIComponent("not-an-email")}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(400);
  });

  it("DELETE maps adapter throws into a problem+json envelope", async () => {
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({
          removeApprovedEmail: vi.fn(async () => {
            throw new Error("d1 down");
          }),
        }),
        users: baseUsers(),
      },
    });
    const res = await app.request(
      `/api/v1/instance/approved-emails/${encodeURIComponent("guest@example.com")}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("problem+json");
  });
});

describe("operators", () => {
  const targetUser: User = {
    ...actorUser,
    id: anotherId,
    email: "target@example.com",
    name: "Target",
  };

  it("POST with a body missing email 400s validation", async () => {
    const app = harness({
      userId: opId,
      ports: { policy: baseOperatorPolicy(), users: baseUsers() },
    });
    const res = await app.request("/api/v1/instance/operators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "u_x" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("POST 200s when the target was already an active operator (idempotent)", async () => {
    const add = vi.fn(
      async (): Promise<AddOperatorResult> => ({
        operator: {
          userId: anotherId,
          grantedAt: now,
          grantedBy: opId,
          revokedAt: null,
          revokedBy: null,
        },
        created: false,
      }),
    );
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({ addOperator: add }),
        users: baseUsers({
          byId: vi.fn(async (id) =>
            id === opId ? actorUser : id === anotherId ? targetUser : null,
          ),
          byEmail: vi.fn(async () => targetUser),
        }),
      },
    });
    const res = await app.request("/api/v1/instance/operators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "target@example.com" }),
    });
    expect(res.status).toBe(200);
  });

  it("POST 201s when the email resolves to a user and the operator row is created", async () => {
    const add = vi.fn(
      async (): Promise<AddOperatorResult> => ({
        operator: {
          userId: anotherId,
          grantedAt: now,
          grantedBy: opId,
          revokedAt: null,
          revokedBy: null,
        },
        created: true,
      }),
    );
    const byEmail = vi.fn(async () => targetUser);
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({ addOperator: add }),
        users: baseUsers({
          byId: vi.fn(async (id) =>
            id === opId ? actorUser : id === anotherId ? targetUser : null,
          ),
          byEmail,
        }),
      },
    });
    const res = await app.request("/api/v1/instance/operators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "target@example.com" }),
    });
    expect(res.status).toBe(201);
    expect(byEmail).toHaveBeenCalledWith("target@example.com");
  });

  it("POST with unknown email 422s user_not_found", async () => {
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy(),
        users: baseUsers({ byEmail: vi.fn(async () => null) }),
      },
    });
    const res = await app.request("/api/v1/instance/operators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("user_not_found");
  });

  it("DELETE 204s when another operator exists", async () => {
    const revoke = vi.fn();
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({
          getOperator: vi.fn(async (id) =>
            id === opId
              ? actorOp
              : {
                  userId: anotherId,
                  grantedAt: now,
                  grantedBy: opId,
                  revokedAt: null,
                  revokedBy: null,
                },
          ),
          countActiveOperators: vi.fn(async () => 2),
          revokeOperator: revoke,
        }),
        users: baseUsers(),
      },
    });
    const res = await app.request(`/api/v1/instance/operators/${anotherId}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(revoke).toHaveBeenCalledWith(anotherId, opId);
  });

  it("DELETE 422s with would_orphan_operator on the last active operator", async () => {
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({
          getOperator: vi.fn(async (id) =>
            id === opId
              ? actorOp
              : {
                  userId: anotherId,
                  grantedAt: now,
                  grantedBy: opId,
                  revokedAt: null,
                  revokedBy: null,
                },
          ),
          countActiveOperators: vi.fn(async () => 1),
        }),
        users: baseUsers(),
      },
    });
    const res = await app.request(`/api/v1/instance/operators/${anotherId}`, { method: "DELETE" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("would_orphan_operator");
  });

  it("GET filters out revoked rows by default", async () => {
    const rows: readonly InstanceOperator[] = [
      actorOp,
      { userId: anotherId, grantedAt: now, grantedBy: opId, revokedAt: now, revokedBy: opId },
    ];
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({ listOperators: vi.fn(async () => rows) }),
      },
    });
    const res = await app.request("/api/v1/instance/operators");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: InstanceOperator[] };
    expect(body.entries.map((r) => r.userId)).toEqual([opId]);
  });

  it("GET 403s a non-operator viewing the operator roster", async () => {
    const app = harness({
      userId: anotherId,
      ports: {
        policy: {
          ...throwingProxy<InstanceAccessPolicyRepository>("policy"),
          getOperator: vi.fn(async () => null),
        } as InstanceAccessPolicyRepository,
      },
    });
    const res = await app.request("/api/v1/instance/operators");
    expect(res.status).toBe(403);
  });

  it("GET 400s on a malformed includeRevoked query param", async () => {
    const app = harness({ userId: opId, ports: { policy: baseOperatorPolicy() } });
    const res = await app.request("/api/v1/instance/operators?includeRevoked=maybe");
    expect(res.status).toBe(400);
  });

  it("DELETE 400s on a malformed userId path param", async () => {
    const app = harness({
      userId: opId,
      ports: { policy: baseOperatorPolicy(), users: baseUsers() },
    });
    const res = await app.request(`/api/v1/instance/operators/${"x".repeat(65)}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_user_id");
  });

  it("DELETE maps adapter throws into a problem+json envelope", async () => {
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({
          getOperator: vi.fn(async (id) =>
            id === opId
              ? actorOp
              : {
                  userId: anotherId,
                  grantedAt: now,
                  grantedBy: opId,
                  revokedAt: null,
                  revokedBy: null,
                },
          ),
          countActiveOperators: vi.fn(async () => 2),
          revokeOperator: vi.fn(async () => {
            throw new Error("d1 down");
          }),
        }),
        users: baseUsers(),
      },
    });
    const res = await app.request(`/api/v1/instance/operators/${anotherId}`, { method: "DELETE" });
    expect(res.status).toBe(500);
  });

  it("POST 400s on malformed JSON to /operators", async () => {
    const app = harness({
      userId: opId,
      ports: { policy: baseOperatorPolicy(), users: baseUsers() },
    });
    const res = await app.request("/api/v1/instance/operators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
  });

  it("GET ?includeRevoked=true returns every row", async () => {
    const rows: readonly InstanceOperator[] = [
      actorOp,
      { userId: anotherId, grantedAt: now, grantedBy: opId, revokedAt: now, revokedBy: opId },
    ];
    const app = harness({
      userId: opId,
      ports: {
        policy: baseOperatorPolicy({ listOperators: vi.fn(async () => rows) }),
      },
    });
    const res = await app.request("/api/v1/instance/operators?includeRevoked=true");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: InstanceOperator[] };
    expect(body.entries).toHaveLength(2);
  });
});
