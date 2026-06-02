import { expect, test } from "@playwright/test";

const WORKER_BASE_URL = "http://localhost:8788";
const VALID_LIBRARY_KEY = "library/g_fpguard/l_fpguard/r_fpguard";

test.describe("Dev R2 proxy — FP guard", () => {
  test("PUT with a bad HMAC signature returns 403", async ({ request }) => {
    const expiresAtMs = Date.now() + 60_000;
    const contentType = "text/markdown";
    const url =
      `${WORKER_BASE_URL}/api/v1/__r2/upload/${VALID_LIBRARY_KEY}` +
      `?expires=${expiresAtMs}&sig=deadbeef&contentType=${encodeURIComponent(contentType)}`;

    const res = await request.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      data: "hello",
    });

    expect(res.status()).toBe(403);
  });
});
