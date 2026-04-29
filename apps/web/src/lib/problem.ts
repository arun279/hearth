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
  not_group_admin: "Only a Group Admin can do that.",
  not_group_member: "You aren't a member of this group.",
  group_archived: "This group is archived. Unarchive it first to make changes.",
  would_orphan_admin:
    "Active groups must keep at least one Group Admin. Promote another admin first.",
  not_self: "You can only edit your own profile in this group.",
  invalid_nickname: "Nickname must be 1–60 characters.",
  invalid_bio: "Bio must be 800 characters or fewer.",
  invitation_expired: "This invitation expired. Ask a Group Admin for a new one.",
  invitation_revoked: "This invitation was revoked.",
  invitation_consumed: "This invitation has already been used.",
  invitation_email_mismatch: "This invitation was issued to a different email address.",
  email_not_approved_yet:
    "Your email isn't on the Approved list for this Hearth Instance yet. Ask an Instance Operator to approve it, then try again.",
  invitation_not_found: "This invitation is no longer valid.",
  invalid_avatar_size: "Avatars must be 512 KB or smaller.",
  invalid_avatar_mime: "Avatars must be PNG, JPEG, or WebP.",
  upload_missing: "The upload didn't complete. Check your connection and try again.",
  upload_size_mismatch:
    "The uploaded file's size didn't match what was reserved. Pick the file again and retry.",
  size_mismatch:
    "The uploaded file's size didn't match what was reserved. Pick the file again and retry.",
  pending_upload_not_found: "Upload session expired. Start a new one.",
  upload_expired: "Upload window expired. Pick the file and try again.",
  byte_quota_exceeded:
    "This upload would push the instance past its storage budget. Retire older items or ask an operator to expand the bucket.",
  library_item_retired:
    "This item is retired. Existing references keep working, but new uploads against it are paused.",
  not_library_steward:
    "Only the uploader, a Steward, a Group Admin, or an Instance Operator can do that.",
  cannot_remove_uploader: "The original uploader is always a Steward and can't be removed.",
  target_not_member: "Stewards must be current Group Members.",
  revision_number_conflict: "Another revision was added at the same time. Try again.",
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
