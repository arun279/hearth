import { describe, expect, it } from "vitest";
import {
  buildDevProxyGetUrl,
  buildDevProxyPutUrl,
  signDevProxy,
  verifyDevProxy,
} from "../src/dev-r2-proxy.ts";

const SECRET = "z".repeat(32);

describe("dev-r2-proxy sign/verify", () => {
  it("round-trips a PUT signature", async () => {
    const sig = await signDevProxy(
      {
        method: "PUT",
        key: "library/g/li/lr",
        expiresAtMs: 1_700_000_000_000,
        contentType: "application/pdf",
      },
      SECRET,
    );
    expect(sig).toMatch(/^[0-9a-f]+$/);
    expect(
      await verifyDevProxy(
        {
          method: "PUT",
          key: "library/g/li/lr",
          expiresAtMs: 1_700_000_000_000,
          contentType: "application/pdf",
        },
        sig,
        SECRET,
      ),
    ).toBe(true);
  });

  it("rejects a forged signature", async () => {
    expect(
      await verifyDevProxy(
        { method: "GET", key: "library/g/li/lr", expiresAtMs: 1_700_000_000_000 },
        "deadbeef".repeat(8),
        SECRET,
      ),
    ).toBe(false);
  });

  it("rejects when the content-type changes (PUT signature is bound)", async () => {
    const sig = await signDevProxy(
      {
        method: "PUT",
        key: "library/g/li/lr",
        expiresAtMs: 1_700_000_000_000,
        contentType: "application/pdf",
      },
      SECRET,
    );
    expect(
      await verifyDevProxy(
        {
          method: "PUT",
          key: "library/g/li/lr",
          expiresAtMs: 1_700_000_000_000,
          contentType: "application/octet-stream",
        },
        sig,
        SECRET,
      ),
    ).toBe(false);
  });

  it("rejects when the key, secret, or expires changes", async () => {
    const sig = await signDevProxy(
      { method: "GET", key: "library/g/li/lr", expiresAtMs: 1_700_000_000_000 },
      SECRET,
    );
    // Different key.
    expect(
      await verifyDevProxy(
        { method: "GET", key: "library/g/other/lr", expiresAtMs: 1_700_000_000_000 },
        sig,
        SECRET,
      ),
    ).toBe(false);
    // Different secret.
    expect(
      await verifyDevProxy(
        { method: "GET", key: "library/g/li/lr", expiresAtMs: 1_700_000_000_000 },
        sig,
        "different-secret-32-bytes-padding!",
      ),
    ).toBe(false);
    // Different expires.
    expect(
      await verifyDevProxy(
        { method: "GET", key: "library/g/li/lr", expiresAtMs: 1_700_000_000_001 },
        sig,
        SECRET,
      ),
    ).toBe(false);
  });

  it("handles malformed signatures without throwing", async () => {
    expect(
      await verifyDevProxy(
        { method: "GET", key: "library/g/li/lr", expiresAtMs: 1_700_000_000_000 },
        "",
        SECRET,
      ),
    ).toBe(false);
    expect(
      await verifyDevProxy(
        { method: "GET", key: "library/g/li/lr", expiresAtMs: 1_700_000_000_000 },
        "not-hex!",
        SECRET,
      ),
    ).toBe(false);
    // Odd-length hex string.
    expect(
      await verifyDevProxy(
        { method: "GET", key: "library/g/li/lr", expiresAtMs: 1_700_000_000_000 },
        "abc",
        SECRET,
      ),
    ).toBe(false);
  });
});

describe("dev-r2-proxy URL builders", () => {
  it("builds a PUT URL with the signed parameters", () => {
    const url = buildDevProxyPutUrl({
      baseUrl: "http://localhost:8787",
      key: "library/g/li/lr",
      expiresAtMs: 1_700_000_000_000,
      contentType: "application/pdf",
      signature: "deadbeef",
    });
    expect(url).toBe(
      "http://localhost:8787/api/v1/__r2/upload/library/g/li/lr?expires=1700000000000&sig=deadbeef&contentType=application%2Fpdf",
    );
  });

  it("builds a GET URL with optional content-disposition", () => {
    const url = buildDevProxyGetUrl({
      baseUrl: "http://localhost:8787/",
      key: "avatars/u/g/k",
      expiresAtMs: 1_700_000_000_000,
      signature: "deadbeef",
      contentDisposition: 'attachment; filename="primer.pdf"',
    });
    expect(url).toContain("/api/v1/__r2/download/avatars/u/g/k");
    expect(url).toContain("expires=1700000000000");
    expect(url).toContain("sig=deadbeef");
    expect(url).toContain("disposition=attachment");
    // baseUrl trailing slash should not produce double-slash.
    expect(url).not.toContain("8787//");
  });
});
