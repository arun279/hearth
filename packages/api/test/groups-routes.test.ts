import type {
  GroupMembership,
  InstanceOperator,
  StudyGroup,
  StudyGroupId,
  User,
  UserId,
} from "@hearth/domain";
import type {
  InstanceAccessPolicyRepository,
  KillswitchGate,
  StudyGroupRepository,
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
    settings: throwingProxy<Ports["settings"]>("settings"),
    users: throwingProxy<UserRepository>("users"),
    groups: throwingProxy<StudyGroupRepository>("groups"),
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
const memberId = "u_mem" as UserId;
const strangerId = "u_str" as UserId;
const gid = "g_1" as StudyGroupId;

const opUser: User = {
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

const memberUser: User = { ...opUser, id: memberId, email: "m@x.com", name: "Member" };
const strangerUser: User = { ...opUser, id: strangerId, email: "s@x.com", name: "Stranger" };

const opRow: InstanceOperator = {
  userId: opId,
  grantedAt: now,
  grantedBy: opId,
  revokedAt: null,
  revokedBy: null,
};

const group: StudyGroup = {
  id: gid,
  name: "Tuesday Night Learners",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

const adminMembership: GroupMembership = {
  groupId: gid,
  userId: opId,
  role: "admin",
  joinedAt: now,
  removedAt: null,
};

function makeGroupsPort(overrides: Partial<StudyGroupRepository> = {}): StudyGroupRepository {
  return {
    create: vi.fn(async () => group),
    byId: vi.fn(async () => group),
    list: vi.fn(async () => []),
    listForUser: vi.fn(async () => [group]),
    updateStatus: vi.fn(),
    updateMetadata: vi.fn(async () => group),
    membership: vi.fn(async () => adminMembership),
    membershipsForUser: vi.fn(async () => [adminMembership]),
    countAdmins: vi.fn(async () => 1),
    counts: vi.fn(async () => ({ memberCount: 1, trackCount: 0, libraryItemCount: 0 })),
    ...overrides,
  };
}

function makeUsersPort(user: User | null): UserRepository {
  return {
    byId: vi.fn(async () => user),
    byEmail: vi.fn(async () => null),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
  };
}

function makePolicyPort(
  overrides: Partial<InstanceAccessPolicyRepository> = {},
): InstanceAccessPolicyRepository {
  return {
    isEmailApproved: vi.fn(),
    listApprovedEmails: vi.fn(),
    addApprovedEmail: vi.fn(),
    removeApprovedEmail: vi.fn(),
    getApprovedEmail: vi.fn(),
    getOperator: vi.fn(async () => null),
    isOperator: vi.fn(async () => false),
    listOperators: vi.fn(),
    addOperator: vi.fn(),
    revokeOperator: vi.fn(),
    countActiveOperators: vi.fn(async () => 1),
    bootstrapIfNeeded: vi.fn(),
    ...overrides,
  } as InstanceAccessPolicyRepository;
}

describe("POST /api/v1/g (create study group)", () => {
  it("201s and returns the new group for an operator", async () => {
    const create = vi.fn(async () => group);
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort({ getOperator: vi.fn(async () => opRow) }),
        groups: makeGroupsPort({ create }),
      },
    });
    const res = await app.request("/api/v1/g", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Tuesday Night Learners" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(gid);
    expect(create).toHaveBeenCalledWith({
      name: "Tuesday Night Learners",
      description: undefined,
      createdBy: opId,
    });
  });

  it("403s with code=not_instance_operator for a non-operator", async () => {
    const app = harness({
      userId: memberId,
      ports: {
        users: makeUsersPort(memberUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort(),
      },
    });
    const res = await app.request("/api/v1/g", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "G" }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("problem+json");
    const body = (await res.json()) as { code: string; policy?: { code: string } };
    expect(body.code).toBe("not_instance_operator");
    expect(body.policy?.code).toBe("not_instance_operator");
  });

  it("401s when unauthenticated", async () => {
    const app = harness({ userId: null, ports: {} });
    const res = await app.request("/api/v1/g", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "G" }),
    });
    expect(res.status).toBe(401);
  });

  it("400s on a malformed JSON body", async () => {
    const app = harness({ userId: opId, ports: {} });
    const res = await app.request("/api/v1/g", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    // Hono's `validator("json", ...)` short-circuits a malformed body with a
    // plain 400 before any user hook can rewrap it. Asserting just the
    // status keeps the test honest about the framework boundary; the SPA
    // already treats every non-2xx as an error and never sends malformed
    // JSON itself.
    expect(res.status).toBe(400);
  });

  it("400s on missing name", async () => {
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort({ getOperator: vi.fn(async () => opRow) }),
        groups: makeGroupsPort(),
      },
    });
    const res = await app.request("/api/v1/g", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });
});

describe("GET /api/v1/g (list my groups)", () => {
  it("returns the actor's active memberships", async () => {
    const app = harness({
      userId: memberId,
      ports: { groups: makeGroupsPort() },
    });
    const res = await app.request("/api/v1/g");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ id: string }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.id).toBe(gid);
  });
});

describe("GET /api/v1/g/:groupId", () => {
  it("returns group + caps for a current member", async () => {
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      group: StudyGroup;
      caps: { canArchive: boolean; canUpdateMetadata: boolean };
      counts: { memberCount: number };
    };
    expect(body.group.id).toBe(gid);
    expect(body.caps.canArchive).toBe(true);
    expect(body.counts.memberCount).toBe(1);
  });

  it("404s (not 403) for a non-member non-operator", async () => {
    const app = harness({
      userId: strangerId,
      ports: {
        users: makeUsersPort(strangerUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort({ membership: vi.fn(async () => null) }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_group_member");
  });

  it("returns 200 with caps when the actor is an operator with no membership", async () => {
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort({ getOperator: vi.fn(async () => opRow) }),
        groups: makeGroupsPort({ membership: vi.fn(async () => null) }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      myMembership: GroupMembership | null;
      caps: { canUpdateMetadata: boolean };
    };
    expect(body.myMembership).toBeNull();
    // Operator without membership cannot mutate — caps reflect that.
    expect(body.caps.canUpdateMetadata).toBe(false);
  });
});

describe("PATCH /api/v1/g/:groupId", () => {
  it("renames the group for an admin", async () => {
    const updateMetadata = vi.fn(async () => ({ ...group, name: "New" }));
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort({ updateMetadata }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(200);
    expect(updateMetadata).toHaveBeenCalledWith(gid, { name: "New" }, opId);
  });

  it("403s with code=group_archived when the group is archived", async () => {
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort({
          byId: vi.fn(async (): Promise<StudyGroup> => ({ ...group, status: "archived" })),
        }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New" }),
    });
    // Use case throws DomainError(FORBIDDEN, group_archived) → 403. The
    // adapter would also throw CONFLICT(group_archived) on an archived
    // group, but the policy fires first. SPA reads `code` either way.
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("group_archived");
  });

  it("404s (not 403) for a non-member non-operator probing PATCH — closes the enumeration oracle", async () => {
    const app = harness({
      userId: strangerId,
      ports: {
        users: makeUsersPort(strangerUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort({ membership: vi.fn(async () => null) }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_group_member");
  });

  it("400s when the body has no fields", async () => {
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/g/:groupId/archive | unarchive", () => {
  it("archives and returns 204 for an admin on an active group", async () => {
    const updateStatus = vi.fn();
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort({ updateStatus }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/archive`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(updateStatus).toHaveBeenCalledWith(gid, "archived", opId);
  });

  it("archive is idempotent — 204 even on an already-archived group", async () => {
    const updateStatus = vi.fn();
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort({
          byId: vi.fn(async (): Promise<StudyGroup> => ({ ...group, status: "archived" })),
          updateStatus,
        }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/archive`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("unarchive flips status back and returns 204", async () => {
    const updateStatus = vi.fn();
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort({
          byId: vi.fn(async (): Promise<StudyGroup> => ({ ...group, status: "archived" })),
          updateStatus,
        }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/unarchive`, { method: "POST" });
    expect(res.status).toBe(204);
    expect(updateStatus).toHaveBeenCalledWith(gid, "active", opId);
  });

  it("403s for a non-admin (participant) member trying to archive", async () => {
    const app = harness({
      userId: opId,
      ports: {
        users: makeUsersPort(opUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort({
          membership: vi.fn(
            async (): Promise<GroupMembership> => ({ ...adminMembership, role: "participant" }),
          ),
        }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/archive`, { method: "POST" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_group_admin");
  });

  it("404s (not 403) for a non-member non-operator probing archive — closes the enumeration oracle", async () => {
    const app = harness({
      userId: strangerId,
      ports: {
        users: makeUsersPort(strangerUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort({ membership: vi.fn(async () => null) }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/archive`, { method: "POST" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_group_member");
  });

  it("404s (not 403) for a non-member non-operator probing unarchive — closes the enumeration oracle", async () => {
    const app = harness({
      userId: strangerId,
      ports: {
        users: makeUsersPort(strangerUser),
        policy: makePolicyPort(),
        groups: makeGroupsPort({ membership: vi.fn(async () => null) }),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/unarchive`, { method: "POST" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_group_member");
  });
});
