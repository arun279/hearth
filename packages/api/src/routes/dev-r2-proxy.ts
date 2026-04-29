import { isAvatarKey, isLibraryKey } from "@hearth/domain";
import {
  DEV_PROXY_GET_PATH,
  DEV_PROXY_PUBLIC_PATH,
  DEV_PROXY_PUT_PATH,
  verifyDevProxy,
} from "@hearth/domain/dev-r2-signing";
import { Hono } from "hono";

/**
 * Minimal R2 surface this route uses. Defined locally so `packages/api`
 * doesn't transitively import `@cloudflare/workers-types` — that
 * dependency is owned by the adapter layer per the architecture rules.
 */
type R2BucketLike = {
  put(
    key: string,
    body: ReadableStream | Uint8Array,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    readonly body: ReadableStream;
    readonly httpMetadata?: { contentType?: string };
  } | null>;
};

/**
 * Dev-only R2 proxy. Mounted ONLY when the worker boot path detects
 * `R2_DEV_PROXY=true`; in production these routes don't exist (a request
 * hits the static-asset / SPA fallback instead). The routes mimic the
 * three things a real R2 bucket gives the SPA:
 *
 *   PUT  /api/v1/__r2/upload/<key>?expires=…&sig=…&contentType=…
 *     -> presigned PUT receiver. Validates the HMAC, accepts the body,
 *        writes via the R2 binding.
 *
 *   GET  /api/v1/__r2/download/<key>?expires=…&sig=…&disposition=…
 *     -> presigned GET receiver. Validates the HMAC, reads via the
 *        binding, streams the body with the supplied Content-
 *        Disposition. Browsers follow the 200 directly.
 *
 *   GET  /api/v1/__r2/public/<key>
 *     -> public read receiver, scoped to AVATAR keys only. The SPA
 *        renders avatars via `${R2_PUBLIC_ORIGIN}/${avatarKey}` and we
 *        set R2_PUBLIC_ORIGIN to `<worker>/api/v1/__r2/public` in dev so
 *        the existing avatar code path keeps working unchanged. Library
 *        revisions ship via the signed GET path above; the public route
 *        deliberately rejects library keys so the dev permission shape
 *        matches production (R2 public buckets only carry avatars).
 *
 * Auth model:
 *   - PUT/GET routes are authenticated by the HMAC, NOT by session
 *     cookie. The browser PUTs `credentials: "omit"` so a leaked URL
 *     can't ride a victim cookie cross-origin. Same shape as
 *     production.
 *   - Public route is unauthenticated (avatars are public in prod).
 *
 * Security caveat: the dev proxy is NOT meant for production. It
 * trusts the Worker's BETTER_AUTH_SECRET as the URL signer, has no
 * rate-limiting beyond the global edge limiter, and serves any R2 key
 * whose URL has a valid signature. Only mount it behind a clear
 * R2_DEV_PROXY=true flag.
 */
type DevR2ProxyDeps = {
  readonly bucket: R2BucketLike;
  readonly secret: string;
};

/**
 * Permissive CORS for the dev proxy. The browser sends an OPTIONS
 * preflight for every cross-origin PUT with a custom Content-Type
 * (Vite SPA on :5173 → worker on :8787 in dev). The preflight needs a
 * 2xx response with `Access-Control-Allow-Methods` listing PUT, and
 * the actual PUT response needs `Access-Control-Allow-Origin` so the
 * browser exposes it to JS. Production never reaches this code — the
 * real R2 endpoint sets its own CORS via the bucket configuration —
 * so the wide-open allowlist here is dev-only.
 */
function applyCors(res: Response): Response {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}

export function createDevR2ProxyRouter({ bucket, secret }: DevR2ProxyDeps) {
  const app = new Hono()
    .use("*", async (c, next) => {
      await next();
      applyCors(c.res);
    })
    .options("*", (c) => c.body(null, 204))
    .put(`${DEV_PROXY_PUT_PATH}*`, async (c) => {
      const key = decodeKeyFromPath(c.req.path, DEV_PROXY_PUT_PATH);
      if (!isAcceptableSignedKey(key)) return c.text("invalid key", 400);

      const expiresStr = c.req.query("expires");
      const sig = c.req.query("sig");
      const contentType = c.req.query("contentType");
      if (!expiresStr || !sig || !contentType) {
        return c.text("missing signed-URL parameters", 400);
      }
      const expiresAtMs = Number(expiresStr);
      if (!Number.isFinite(expiresAtMs)) return c.text("invalid expires", 400);
      if (Date.now() > expiresAtMs) return c.text("signature expired", 410);

      const ok = await verifyDevProxy(
        { method: "PUT", key, expiresAtMs, contentType },
        sig,
        secret,
      );
      if (!ok) return c.text("invalid signature", 403);

      const headerType = c.req.header("Content-Type");
      if (headerType !== contentType) {
        // Mirror R2's behaviour: the signed Content-Type is bound into
        // the signature, so a different header is a 403, not a 400.
        return c.text("Content-Type mismatch", 403);
      }

      const body = c.req.raw.body;
      if (!body) return c.text("missing body", 400);
      await bucket.put(key, body, {
        httpMetadata: { contentType },
      });
      return c.body(null, 200);
    })

    .get(`${DEV_PROXY_GET_PATH}*`, async (c) => {
      const key = decodeKeyFromPath(c.req.path, DEV_PROXY_GET_PATH);
      if (!isAcceptableSignedKey(key)) return c.text("invalid key", 400);

      const expiresStr = c.req.query("expires");
      const sig = c.req.query("sig");
      if (!expiresStr || !sig) return c.text("missing signed-URL parameters", 400);
      const expiresAtMs = Number(expiresStr);
      if (!Number.isFinite(expiresAtMs)) return c.text("invalid expires", 400);
      if (Date.now() > expiresAtMs) return c.text("signature expired", 410);

      const ok = await verifyDevProxy({ method: "GET", key, expiresAtMs }, sig, secret);
      if (!ok) return c.text("invalid signature", 403);

      const obj = await bucket.get(key);
      if (!obj) return c.text("not found", 404);

      const disposition = c.req.query("disposition");
      const headers = new Headers();
      const ct = obj.httpMetadata?.contentType;
      if (ct) headers.set("Content-Type", ct);
      if (disposition) headers.set("Content-Disposition", disposition);
      return new Response(obj.body, { headers });
    })

    .get(`${DEV_PROXY_PUBLIC_PATH}*`, async (c) => {
      const key = decodeKeyFromPath(c.req.path, DEV_PROXY_PUBLIC_PATH);
      // Avatars only on the unsigned public route; library keys must
      // route through the signed GET path. Production's R2 public
      // bucket only carries avatars, so anything else here is a
      // dev-only divergence we explicitly refuse.
      if (key.length === 0 || !isAvatarKey(key)) return c.text("invalid key", 400);
      const obj = await bucket.get(key);
      if (!obj) return c.text("not found", 404);
      const headers = new Headers();
      const ct = obj.httpMetadata?.contentType;
      if (ct) headers.set("Content-Type", ct);
      // Public reads cache aggressively in prod (custom-domain Cache
      // Rules); the dev path doesn't bother — avatars change rarely
      // enough that browser cache by URL hash is plenty.
      return new Response(obj.body, { headers });
    });
  return app;
}

function decodeKeyFromPath(path: string, prefix: string): string {
  const idx = path.indexOf(prefix);
  if (idx === -1) return "";
  // The path may include query-string already stripped by Hono;
  // decodeURIComponent matches what putUploadPresigned encoded. Keys
  // don't contain `/` from the path's perspective because cuid2 +
  // brand prefixes are URL-safe.
  return decodeURIComponent(path.slice(idx + prefix.length));
}

function isAcceptableSignedKey(key: string): boolean {
  return key.length > 0 && (isAvatarKey(key) || isLibraryKey(key));
}
