import type { KillswitchGate, KillswitchMode } from "@hearth/ports";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppBindings } from "../src/bindings.ts";
import { killswitchMiddleware } from "../src/middleware/killswitch.ts";

function makeGate(mode: KillswitchMode): KillswitchGate {
  return {
    getMode: async () => mode,
    assertWritable: async () => {
      if (mode !== "normal") throw new Error(`killswitch: ${mode}`);
    },
    invalidate: () => {},
  };
}

function harness(mode: KillswitchMode) {
  const app = new Hono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("gate", makeGate(mode));
    await next();
  });
  app.use("*", killswitchMiddleware());
  app.get("/healthz", (c) => c.text("ok"));
  app.get("/api/v1/admin/killswitch", (c) => c.json({ mode }));
  app.post("/api/v1/admin/killswitch", (c) => c.json({ mode }));
  app.get("/api/v1/me/context", (c) => c.json({ ok: true }));
  app.post("/api/v1/me/profile", (c) => c.json({ ok: true }));
  return app;
}

describe("killswitch HTTP middleware", () => {
  it("normal: lets every request through", async () => {
    const app = harness("normal");
    for (const [method, path] of [
      ["GET", "/healthz"],
      ["GET", "/api/v1/me/context"],
      ["POST", "/api/v1/me/profile"],
      ["GET", "/api/v1/admin/killswitch"],
    ] as const) {
      const res = await app.request(path, { method });
      expect(res.status, `${method} ${path}`).toBe(200);
    }
  });

  it("read_only: blocks write methods with 503 problem+json, allows reads", async () => {
    const app = harness("read_only");
    const readRes = await app.request("/api/v1/me/context");
    expect(readRes.status).toBe(200);

    const writeRes = await app.request("/api/v1/me/profile", { method: "POST" });
    expect(writeRes.status).toBe(503);
    expect(writeRes.headers.get("content-type")).toContain("application/problem+json");
    expect(await writeRes.json()).toMatchObject({ code: "read_only", status: 503 });

    // Admin endpoints bypass the block so operators can unflip.
    const adminRes = await app.request("/api/v1/admin/killswitch", { method: "POST" });
    expect(adminRes.status).toBe(200);
  });

  it("disabled: blocks everything except /healthz and /api/v1/admin/*", async () => {
    const app = harness("disabled");
    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/api/v1/admin/killswitch")).status).toBe(200);
    expect((await app.request("/api/v1/admin/killswitch", { method: "POST" })).status).toBe(200);

    const blocked = await app.request("/api/v1/me/context");
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("content-type")).toContain("application/problem+json");
    expect(await blocked.json()).toMatchObject({ code: "disabled", status: 503 });
  });
});
