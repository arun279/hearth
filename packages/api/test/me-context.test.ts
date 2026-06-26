import type {
  InstanceAccessPolicyRepository,
  InstanceSettingsRepository,
  KillswitchGate,
  StudyGroupRepository,
  SystemFlagRepository,
  UserRepository,
} from "@hearth/ports";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
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
    uploads: throwingProxy<Ports["uploads"]>("uploads"),
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
    c.set("config", { r2PublicOrigin: "https://pub-test.r2.dev" });
    c.set("ports", buildPorts(opts.ports));
    await next();
  });
  app.route("/api/v1", createApiRouter());
  return app;
}

// Groups port stub that returns no memberships — sufficient for me/context
// shape tests that don't exercise the group surface.
function emptyGroupsPort(): StudyGroupRepository {
  return {
    ...throwingProxy<StudyGroupRepository>("groups"),
    membershipsForUser: async () => [],
  } as StudyGroupRepository;
}

function emptyTracksPort(): Ports["tracks"] {
  return {
    ...throwingProxy<Ports["tracks"]>("tracks"),
    enrollmentsForUser: async () => [],
  } as Ports["tracks"];
}

describe("GET /api/v1/me/context", () => {
  it("returns anonymous envelope when no session", async () => {
    const app = harness({
      userId: null,
      ports: {
        policy: {
          ...throwingProxy<InstanceAccessPolicyRepository>("policy"),
          countActiveOperators: async () => 0,
          isOperator: async () => false,
        } as InstanceAccessPolicyRepository,
        settings: {
          get: async () => null,
          update: async () => {
            throw new Error("unused");
          },
        },
        groups: emptyGroupsPort(),
        tracks: emptyTracksPort(),
      },
    });

    const res = await app.request("/api/v1/me/context");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      v: 1,
      data: {
        user: null,
        instance: {
          name: "Hearth",
          needsBootstrap: true,
          r2PublicOrigin: "https://pub-test.r2.dev",
        },
        isOperator: false,
        memberships: [],
        enrollments: [],
      },
    });
  });

  it("returns signed-in envelope when userId is set", async () => {
    const userId = "u_1";
    const app = harness({
      userId,
      ports: {
        users: {
          ...throwingProxy<UserRepository>("users"),
          byId: async () => ({
            id: "u_1" as ReturnType<UserRepository["byId"]> extends Promise<infer U>
              ? U extends { id: infer I } | null
                ? I
                : never
              : never,
            email: "op@example.com",
            name: "Op",
            image: null,
            deactivatedAt: null,
            deletedAt: null,
            attributionPreference: "preserve_name",
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }),
        } as UserRepository,
        policy: {
          ...throwingProxy<InstanceAccessPolicyRepository>("policy"),
          countActiveOperators: async () => 1,
          isOperator: async () => true,
        } as InstanceAccessPolicyRepository,
        settings: {
          get: async () => ({ name: "Jolene's Hearth", updatedAt: new Date(0), updatedBy: null }),
          update: async () => {
            throw new Error("unused");
          },
        },
        groups: emptyGroupsPort(),
        tracks: emptyTracksPort(),
      },
    });

    const res = await app.request("/api/v1/me/context");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      v: number;
      data: {
        user: { id: string; email: string };
        instance: { name: string; needsBootstrap: boolean };
        isOperator: boolean;
      };
    };
    expect(body.v).toBe(1);
    expect(body.data.user).toEqual({ id: "u_1", email: "op@example.com", name: "Op", image: null });
    expect(body.data.instance).toEqual({
      name: "Jolene's Hearth",
      needsBootstrap: false,
      r2PublicOrigin: "https://pub-test.r2.dev",
    });
    expect(body.data.isOperator).toBe(true);
  });

  it("populates the memberships array from the groups port", async () => {
    const userId = "u_1";
    const memberships: ReturnType<StudyGroupRepository["membershipsForUser"]> extends Promise<
      infer R
    >
      ? R
      : never = [
      {
        groupId: "g_42" as never,
        userId: "u_1" as never,
        role: "admin",
        joinedAt: new Date("2026-01-01T00:00:00.000Z"),
        removedAt: null,
        removedBy: null,
        attributionOnLeave: null,
        displayNameSnapshot: null,
        profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
      },
    ];
    const app = harness({
      userId,
      ports: {
        users: {
          ...throwingProxy<UserRepository>("users"),
          byId: async () => ({
            id: "u_1" as never,
            email: "op@example.com",
            name: "Op",
            image: null,
            deactivatedAt: null,
            deletedAt: null,
            attributionPreference: "preserve_name",
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }),
        } as UserRepository,
        policy: {
          ...throwingProxy<InstanceAccessPolicyRepository>("policy"),
          countActiveOperators: async () => 1,
          isOperator: async () => false,
        } as InstanceAccessPolicyRepository,
        settings: {
          get: async () => ({ name: "X", updatedAt: new Date(0), updatedBy: null }),
          update: async () => {
            throw new Error("unused");
          },
        },
        groups: {
          ...throwingProxy<StudyGroupRepository>("groups"),
          membershipsForUser: async () => memberships,
        } as StudyGroupRepository,
        tracks: emptyTracksPort(),
      },
    });
    const res = await app.request("/api/v1/me/context");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { memberships: typeof memberships } };
    expect(body.data.memberships).toHaveLength(1);
    expect(body.data.memberships[0]?.role).toBe("admin");
  });

  it("maps adapter throws into a problem+json envelope", async () => {
    const app = harness({
      userId: null,
      ports: {
        policy: {
          ...throwingProxy<InstanceAccessPolicyRepository>("policy"),
          countActiveOperators: async () => {
            throw new Error("d1 down");
          },
          isOperator: async () => false,
        } as InstanceAccessPolicyRepository,
        settings: {
          get: async () => null,
          update: async () => {
            throw new Error("unused");
          },
        },
      },
    });
    const res = await app.request("/api/v1/me/context");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("problem+json");
  });
});

describe("GET /api/v1/me/up-next", () => {
  it("returns an empty items list — stub until sessions aggregate lands", async () => {
    const app = harness({ userId: "u_1", ports: {} });
    const res = await app.request("/api/v1/me/up-next");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });
});
