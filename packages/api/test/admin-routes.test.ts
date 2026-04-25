import type {
  InstanceAccessPolicyRepository,
  InstanceSettingsRepository,
  KillswitchGate,
  SystemFlagKey,
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
    clock: { now: () => new Date(0) },
    ids: { generate: () => "id_test" },
    ...overrides,
  };
}

const TOKEN = "k".repeat(48);

function harness(opts: { ports: Partial<Ports> }) {
  const gate: KillswitchGate = {
    getMode: async () => "normal",
    assertWritable: async () => {},
    invalidate: vi.fn(),
  };
  const app = new Hono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("userId", null);
    c.set("auth", { handler: async () => new Response(null) });
    c.set("gate", gate);
    c.set("adminToken", TOKEN);
    c.set("writeLimiter", { limit: async () => ({ success: true }) });
    c.set("authLimiter", { limit: async () => ({ success: true }) });
    c.set("ports", buildPorts(opts.ports));
    await next();
  });
  app.route("/api/v1", createApiRouter());
  return app;
}

function bearer(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` };
}

describe("/api/v1/admin/* — bearer-authed operator endpoints", () => {
  it("rejects requests without a bearer token", async () => {
    const app = harness({ ports: {} });
    const res = await app.request("/api/v1/admin/killswitch");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unauthorized");
  });

  it("rejects requests with the wrong bearer token", async () => {
    const app = harness({ ports: {} });
    const res = await app.request("/api/v1/admin/killswitch", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts the token via ?token=… query parameter as a phone-bookmark fallback", async () => {
    const flags: SystemFlagRepository = {
      get: vi.fn(async () => null),
      set: vi.fn(),
      list: vi.fn(async () => []),
    };
    const app = harness({ ports: { flags } });
    const res = await app.request(`/api/v1/admin/killswitch?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("GET /killswitch returns the current mode + metadata", async () => {
    const flagValues: Record<string, string> = {
      killswitch_mode: "read_only",
      killswitch_reason: "spike at 95% writes",
      killswitch_last_transition_at: "2026-04-22T00:00:00.000Z",
    };
    const flags: SystemFlagRepository = {
      get: vi.fn(async (key: SystemFlagKey) => flagValues[key] ?? null),
      set: vi.fn(),
      list: vi.fn(async () => []),
    };
    const app = harness({ ports: { flags } });
    const res = await app.request("/api/v1/admin/killswitch", { headers: bearer() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      reason: string;
      lastTransitionAt: string;
    };
    expect(body.mode).toBe("read_only");
    expect(body.reason).toBe("spike at 95% writes");
    expect(body.lastTransitionAt).toBe("2026-04-22T00:00:00.000Z");
  });

  it("GET /killswitch falls back to 'normal' when the flag has an unknown value", async () => {
    const flags: SystemFlagRepository = {
      get: vi.fn(async () => "garbled"),
      set: vi.fn(),
      list: vi.fn(async () => []),
    };
    const app = harness({ ports: { flags } });
    const res = await app.request("/api/v1/admin/killswitch", { headers: bearer() });
    const body = (await res.json()) as { mode: string };
    expect(body.mode).toBe("normal");
  });

  it("GET /killswitch maps adapter throws into a problem+json envelope", async () => {
    const flags: SystemFlagRepository = {
      get: vi.fn(async () => {
        throw new Error("d1 down");
      }),
      set: vi.fn(),
      list: vi.fn(async () => []),
    };
    const app = harness({ ports: { flags } });
    const res = await app.request("/api/v1/admin/killswitch", { headers: bearer() });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("problem+json");
  });

  it("POST /killswitch flips the mode in order: reason → timestamp → mode", async () => {
    const set = vi.fn();
    const flags: SystemFlagRepository = {
      get: vi.fn(async () => null),
      set,
      list: vi.fn(async () => []),
    };
    const app = harness({ ports: { flags } });
    const res = await app.request("/api/v1/admin/killswitch", {
      method: "POST",
      headers: { ...bearer(), "content-type": "application/json" },
      body: JSON.stringify({ mode: "read_only", reason: "manual flip" }),
    });
    expect(res.status).toBe(200);
    expect(set.mock.calls.map((c) => c[0])).toEqual([
      "killswitch_reason",
      "killswitch_last_transition_at",
      "killswitch_mode",
    ]);
  });

  it("POST /killswitch 400s on malformed JSON", async () => {
    const app = harness({ ports: {} });
    const res = await app.request("/api/v1/admin/killswitch", {
      method: "POST",
      headers: { ...bearer(), "content-type": "application/json" },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_json");
  });

  it("POST /killswitch 400s on a body that fails Zod validation", async () => {
    const app = harness({ ports: {} });
    const res = await app.request("/api/v1/admin/killswitch", {
      method: "POST",
      headers: { ...bearer(), "content-type": "application/json" },
      body: JSON.stringify({ mode: "wrong-value" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("POST /killswitch invalidates the gate even when the flag write throws", async () => {
    const invalidate = vi.fn();
    const gate: KillswitchGate = {
      getMode: async () => "normal",
      assertWritable: async () => {},
      invalidate,
    };
    const flags: SystemFlagRepository = {
      get: vi.fn(),
      set: vi.fn(async () => {
        throw new Error("d1 down");
      }),
      list: vi.fn(async () => []),
    };
    const app = new Hono<AppBindings>();
    app.use("*", async (c, next) => {
      c.set("userId", null);
      c.set("auth", { handler: async () => new Response(null) });
      c.set("gate", gate);
      c.set("adminToken", TOKEN);
      c.set("writeLimiter", { limit: async () => ({ success: true }) });
      c.set("authLimiter", { limit: async () => ({ success: true }) });
      c.set("ports", buildPorts({ flags }));
      await next();
    });
    app.route("/api/v1", createApiRouter());
    const res = await app.request("/api/v1/admin/killswitch", {
      method: "POST",
      headers: { ...bearer(), "content-type": "application/json" },
      body: JSON.stringify({ mode: "read_only" }),
    });
    expect(res.status).toBe(500);
    expect(invalidate).toHaveBeenCalled();
  });

  it("GET /health returns the stub shape until M16 ships the dashboard", async () => {
    const app = harness({ ports: {} });
    const res = await app.request("/api/v1/admin/health", { headers: bearer() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      metrics: unknown[];
      killswitch: { mode: string };
      evidenceSignalCount: number;
    };
    expect(body.metrics).toEqual([]);
    expect(body.killswitch.mode).toBe("normal");
    expect(body.evidenceSignalCount).toBe(0);
  });
});
