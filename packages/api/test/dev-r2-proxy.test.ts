import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createDevR2ProxyRouter } from "../src/routes/dev-r2-proxy.ts";

const SECRET = "x".repeat(32);
const VALID_KEY = "library/g_test/li_test/lr_test";

class FakeR2 {
  readonly objects = new Map<string, { body: Uint8Array; contentType?: string }>();
  async put(
    key: string,
    body: ReadableStream | Uint8Array,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown> {
    const bytes = body instanceof Uint8Array ? body : await streamToBytes(body);
    this.objects.set(key, { body: bytes, contentType: opts?.httpMetadata?.contentType });
    return undefined;
  }
  async get(key: string) {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return {
      body: bytesToStream(obj.body),
      ...(obj.contentType ? { httpMetadata: { contentType: obj.contentType } } : {}),
    };
  }
}

async function streamToBytes(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function bytesToStream(bytes: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function signPut(key: string, expiresAtMs: number, contentType: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    enc.encode(`PUT:${key}:${expiresAtMs}:${contentType}`),
  );
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function signGet(key: string, expiresAtMs: number): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(`GET:${key}:${expiresAtMs}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function harness(bucket: FakeR2) {
  const app = new Hono();
  const router = createDevR2ProxyRouter({ bucket, secret: SECRET });
  app.route("/", router);
  return app;
}

describe("dev R2 proxy routes", () => {
  it("PUT round-trips a body to the bucket binding", async () => {
    const bucket = new FakeR2();
    const app = harness(bucket);
    const expiresAtMs = Date.now() + 60_000;
    const sig = await signPut(VALID_KEY, expiresAtMs, "text/markdown");
    const url = `/api/v1/__r2/upload/${VALID_KEY}?expires=${expiresAtMs}&sig=${sig}&contentType=${encodeURIComponent("text/markdown")}`;
    const res = await app.request(url, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: new Blob(["hello"]),
    });
    expect(res.status).toBe(200);
    const stored = bucket.objects.get(VALID_KEY);
    expect(stored).toBeDefined();
    expect(new TextDecoder().decode(stored?.body)).toBe("hello");
    expect(stored?.contentType).toBe("text/markdown");
  });

  it("PUT rejects when the signature mismatches", async () => {
    const bucket = new FakeR2();
    const app = harness(bucket);
    const expiresAtMs = Date.now() + 60_000;
    const url = `/api/v1/__r2/upload/${VALID_KEY}?expires=${expiresAtMs}&sig=deadbeef&contentType=${encodeURIComponent("text/markdown")}`;
    const res = await app.request(url, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: new Blob(["hello"]),
    });
    expect(res.status).toBe(403);
    expect(bucket.objects.size).toBe(0);
  });

  it("PUT rejects when the Content-Type header doesn't match the signed type", async () => {
    const bucket = new FakeR2();
    const app = harness(bucket);
    const expiresAtMs = Date.now() + 60_000;
    const sig = await signPut(VALID_KEY, expiresAtMs, "text/markdown");
    const url = `/api/v1/__r2/upload/${VALID_KEY}?expires=${expiresAtMs}&sig=${sig}&contentType=${encodeURIComponent("text/markdown")}`;
    const res = await app.request(url, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Blob(["hello"]),
    });
    expect(res.status).toBe(403);
  });

  it("PUT rejects an expired signature", async () => {
    const bucket = new FakeR2();
    const app = harness(bucket);
    const expiresAtMs = Date.now() - 1;
    const sig = await signPut(VALID_KEY, expiresAtMs, "text/markdown");
    const url = `/api/v1/__r2/upload/${VALID_KEY}?expires=${expiresAtMs}&sig=${sig}&contentType=${encodeURIComponent("text/markdown")}`;
    const res = await app.request(url, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: new Blob(["hello"]),
    });
    expect(res.status).toBe(410);
  });

  it("PUT rejects an unknown key prefix", async () => {
    const bucket = new FakeR2();
    const app = harness(bucket);
    const badKey = "junk/oops";
    const expiresAtMs = Date.now() + 60_000;
    const sig = await signPut(badKey, expiresAtMs, "text/markdown");
    const url = `/api/v1/__r2/upload/${badKey}?expires=${expiresAtMs}&sig=${sig}&contentType=${encodeURIComponent("text/markdown")}`;
    const res = await app.request(url, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: new Blob(["hello"]),
    });
    expect(res.status).toBe(400);
  });

  it("GET returns the stored body with content-disposition", async () => {
    const bucket = new FakeR2();
    await bucket.put(VALID_KEY, new TextEncoder().encode("hello"), {
      httpMetadata: { contentType: "text/markdown" },
    });
    const app = harness(bucket);
    const expiresAtMs = Date.now() + 60_000;
    const sig = await signGet(VALID_KEY, expiresAtMs);
    const url = `/api/v1/__r2/download/${VALID_KEY}?expires=${expiresAtMs}&sig=${sig}&disposition=${encodeURIComponent('attachment; filename="primer.md"')}`;
    const res = await app.request(url, { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("primer.md");
    expect(res.headers.get("Content-Type")).toBe("text/markdown");
    expect(await res.text()).toBe("hello");
  });

  it("GET returns 404 when the key is missing in the bucket", async () => {
    const bucket = new FakeR2();
    const app = harness(bucket);
    const expiresAtMs = Date.now() + 60_000;
    const sig = await signGet(VALID_KEY, expiresAtMs);
    const url = `/api/v1/__r2/download/${VALID_KEY}?expires=${expiresAtMs}&sig=${sig}`;
    const res = await app.request(url, { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("public GET serves any acceptable key without a signature", async () => {
    const bucket = new FakeR2();
    const avatarKey = "avatars/u_x/g_y/k_z";
    await bucket.put(avatarKey, new TextEncoder().encode("png-bytes"), {
      httpMetadata: { contentType: "image/png" },
    });
    const app = harness(bucket);
    const res = await app.request(`/api/v1/__r2/public/${avatarKey}`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("OPTIONS preflight returns 204 with the CORS allow-list headers", async () => {
    // The browser sends a preflight before every cross-origin PUT with
    // a custom Content-Type. Production never reaches this code (R2's
    // own bucket CORS handles it), but the dev proxy has to mimic the
    // shape so the SPA's PUT actually fires.
    const app = harness(new FakeR2());
    const res = await app.request("/api/v1/__r2/upload/anything", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods") ?? "").toMatch(/PUT/);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("PUT rejects with 400 when the signed-URL params are missing", async () => {
    // Neither expires, sig, nor contentType were provided; verifyDevProxy
    // never runs because the param-presence check fires first.
    const app = harness(new FakeR2());
    const res = await app.request(`/api/v1/__r2/upload/${VALID_KEY}`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: new Blob(["x"]),
    });
    expect(res.status).toBe(400);
  });

  it("GET rejects with 400 when the key prefix is unknown", async () => {
    const app = harness(new FakeR2());
    const expiresAtMs = Date.now() + 60_000;
    const sig = await signGet("junk/oops", expiresAtMs);
    const res = await app.request(
      `/api/v1/__r2/download/junk/oops?expires=${expiresAtMs}&sig=${sig}`,
      { method: "GET" },
    );
    expect(res.status).toBe(400);
  });

  it("GET rejects with 400 when the signed-URL params are missing", async () => {
    const app = harness(new FakeR2());
    const res = await app.request(`/api/v1/__r2/download/${VALID_KEY}`, { method: "GET" });
    expect(res.status).toBe(400);
  });

  it("GET rejects an expired signature with 410 and a non-numeric expires with 400", async () => {
    const app = harness(new FakeR2());
    const expired = Date.now() - 1;
    const sig = await signGet(VALID_KEY, expired);
    const res410 = await app.request(
      `/api/v1/__r2/download/${VALID_KEY}?expires=${expired}&sig=${sig}`,
      { method: "GET" },
    );
    expect(res410.status).toBe(410);

    const res400 = await app.request(
      `/api/v1/__r2/download/${VALID_KEY}?expires=not-a-number&sig=${sig}`,
      { method: "GET" },
    );
    expect(res400.status).toBe(400);
  });

  it("GET rejects a forged signature with 403", async () => {
    const app = harness(new FakeR2());
    const expiresAtMs = Date.now() + 60_000;
    const res = await app.request(
      `/api/v1/__r2/download/${VALID_KEY}?expires=${expiresAtMs}&sig=deadbeef`,
      { method: "GET" },
    );
    expect(res.status).toBe(403);
  });

  it("public GET 404s a missing key and 400s an unknown prefix", async () => {
    const app = harness(new FakeR2());
    const missing = await app.request(`/api/v1/__r2/public/${VALID_KEY}`, { method: "GET" });
    expect(missing.status).toBe(404);
    const bad = await app.request("/api/v1/__r2/public/junk/oops", { method: "GET" });
    expect(bad.status).toBe(400);
  });
});
