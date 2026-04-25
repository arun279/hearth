/**
 * Client-side shape of an RFC 7807 `application/problem+json` response from
 * the API. Mirrors `packages/api/src/problem.ts` so the SPA can pattern-match
 * on `code` without depending on the Worker runtime types.
 */
type ApiProblem = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly policy?: { readonly code: string };
  readonly issues?: ReadonlyArray<{ readonly path: string; readonly message: string }>;
};

class ApiError extends Error {
  readonly status: number;
  readonly problem: ApiProblem;
  constructor(problem: ApiProblem) {
    super(problem.detail);
    this.name = "ApiError";
    this.status = problem.status;
    this.problem = problem;
  }
}

export async function assertOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("problem+json") || contentType.includes("application/json")) {
    const body = (await res.json().catch(() => null)) as ApiProblem | null;
    if (body && typeof body === "object" && "code" in body) {
      throw new ApiError(body);
    }
  }
  throw new ApiError({
    type: "about:blank#network",
    title: "request failed",
    status: res.status,
    detail: `Request failed (${res.status})`,
    code: "network_error",
  });
}

/**
 * Single source of truth for mapping a deny-reason / problem `code` to the
 * user-facing phrase. UI strings live here rather than in each caller so a
 * copy change touches one place. Keys match `PolicyDenialReason.code` values
 * emitted by the domain layer.
 */
const policyDenialMessages: Record<string, string> = {
  not_instance_operator: "Only an Instance Operator can do that.",
  would_orphan_operator:
    "An instance must keep at least one operator. Grant the role to someone else first.",
  cannot_revoke_self: "You can't revoke your own operator role. Ask another operator.",
  already_revoked: "That operator role was already revoked.",
  already_exists: "That email is already on the Approved Email list.",
  user_not_found:
    "No signed-in user has this email yet. Add it to Approved Emails first — they'll appear here after they sign in.",
  invalid_instance_name: "The instance name must be 1–80 characters.",
  email_revoked: "That email's access was revoked. Re-approve it to re-grant entry.",
  unauthenticated: "Please sign in to continue.",
};

function problemMessage(problem: ApiProblem): string {
  const code = problem.policy?.code ?? problem.code;
  return policyDenialMessages[code] ?? problem.detail;
}

/**
 * Maps a thrown value into a user-facing string. ApiError unwraps through
 * the policy-denial table; any other Error uses its message; everything
 * else gets the caller-supplied fallback. Centralised so the admin tabs
 * don't each ship their own three-way ternary.
 */
export function asUserMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return problemMessage(err.problem);
  if (err instanceof Error && err.message.length > 0) return err.message;
  return fallback;
}
