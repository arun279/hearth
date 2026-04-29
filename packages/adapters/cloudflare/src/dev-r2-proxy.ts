/**
 * Dev-only HMAC signer + verifier for the worker-mediated R2 upload
 * proxy. Production never reaches this code — when `devProxy` is set on
 * `ObjectStorageConfig`, the adapter signs URLs against this scheme and
 * a dev-only worker route validates them.
 *
 * Why an HMAC and not session auth? The browser PUTs `credentials:
 * "omit"` on the upload (so a leaked URL can't ride a victim's cookie
 * cross-origin to a real R2 bucket), and the dev proxy keeps that
 * shape so the SPA path is byte-identical to production. The HMAC is
 * the credential.
 *
 * Pure utilities — no `env` capture so the tests can drive the helper
 * directly. The worker passes a per-request `secret` (BETTER_AUTH_SECRET
 * by default).
 */

const ENCODER = new TextEncoder();

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * String-to-sign:
 *   `<method>:<key>:<expiresUnixMs>[:<contentType>]`
 *
 * `contentType` is signed for PUT only — R2's signed PUTs bind it into
 * the URL too, so a presigned URL can't be re-purposed to upload
 * different MIME types. GET signing leaves it out.
 */
function canonical(input: SignInput): string {
  const base = `${input.method}:${input.key}:${input.expiresAtMs}`;
  return input.method === "PUT" && input.contentType !== undefined
    ? `${base}:${input.contentType}`
    : base;
}

export type SignInput =
  | {
      readonly method: "PUT";
      readonly key: string;
      readonly expiresAtMs: number;
      readonly contentType: string;
    }
  | {
      readonly method: "GET";
      readonly key: string;
      readonly expiresAtMs: number;
    };

export async function signDevProxy(input: SignInput, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, ENCODER.encode(canonical(input)));
  return toHex(sig);
}

export async function verifyDevProxy(
  input: SignInput,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (signature.length === 0) return false;
  const key = await importHmacKey(secret);
  // Hex → bytes. Reject malformed sig early so a non-hex string can't
  // throw inside subtle.verify.
  if (!/^[0-9a-f]+$/i.test(signature) || signature.length % 2 !== 0) return false;
  const sigBytes = new Uint8Array(signature.length / 2);
  for (let i = 0; i < sigBytes.length; i++) {
    sigBytes[i] = parseInt(signature.slice(i * 2, i * 2 + 2), 16);
  }
  return crypto.subtle.verify("HMAC", key, sigBytes, ENCODER.encode(canonical(input)));
}

export const DEV_PROXY_PUT_PATH = "/api/v1/__r2/upload/";
export const DEV_PROXY_GET_PATH = "/api/v1/__r2/download/";
/**
 * Public-read prefix. Avatars render via `${R2_PUBLIC_ORIGIN}/${key}`;
 * in dev the operator sets R2_PUBLIC_ORIGIN to
 * `${WORKER_ORIGIN}/api/v1/__r2/public` and the worker serves the
 * binding read directly. Production swaps in a real R2 public bucket
 * (or custom domain) and never hits this route.
 */
export const DEV_PROXY_PUBLIC_PATH = "/api/v1/__r2/public/";

export function buildDevProxyPutUrl(args: {
  readonly baseUrl: string;
  readonly key: string;
  readonly expiresAtMs: number;
  readonly contentType: string;
  readonly signature: string;
}): string {
  const params = new URLSearchParams({
    expires: String(args.expiresAtMs),
    sig: args.signature,
    contentType: args.contentType,
  });
  return `${trimTrailingSlash(args.baseUrl)}${DEV_PROXY_PUT_PATH}${args.key}?${params.toString()}`;
}

export function buildDevProxyGetUrl(args: {
  readonly baseUrl: string;
  readonly key: string;
  readonly expiresAtMs: number;
  readonly signature: string;
  readonly contentDisposition?: string;
}): string {
  const params = new URLSearchParams({
    expires: String(args.expiresAtMs),
    sig: args.signature,
  });
  if (args.contentDisposition) {
    params.set("disposition", args.contentDisposition);
  }
  return `${trimTrailingSlash(args.baseUrl)}${DEV_PROXY_GET_PATH}${args.key}?${params.toString()}`;
}

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
