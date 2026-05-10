import { POLICY_DENIAL_CODES, type PolicyDenialCode } from "@hearth/domain";

/**
 * Reason codes for `DomainError`s that aren't policy denials but still
 * need a user-facing message. Adding a literal to this tuple is the
 * companion to adding a `throw new DomainError(..., "<reason>")` whose
 * message is too internal to surface verbatim. The source-scan test in
 * `problem.test.ts` enforces that every code in `POLICY_DENIAL_CODES`
 * and this tuple has an entry in `policyDenialMessages` — without it,
 * the SPA falls back to the raw `problem.detail`, which leaks internal
 * shape (e.g. "displayOrder references unknown Part ${id}").
 */
const INVARIANT_AND_VALIDATION_CODES = [
  // Activity invariants (M8)
  "flow_cycle_detected",
  "display_order_not_topo",
  "window_post_close_inconsistent",
  "part_library_mime_mismatch",
  "duplicate_part_id",
  "duplicate_library_ref",
  "unknown_part_id_in_flow",
  "cross_activity_prereq_cycle",
  "audience_user_not_enrolled",
  "pinned_revision_not_in_item",
  "activity_has_dependents",
  "prereq_cross_track",
  "prereq_self_loop",
  "suggested_cross_track",
  "suggested_self_edge",
  "suggested_self_loop",
  "library_item_missing",
  "library_item_no_revision",
  "library_item_wrong_group",
  // Profile / group / track validation
  "already_exists",
  "user_not_found",
  "actor_not_found",
  "invalid_email",
  "invalid_title",
  "invalid_instance_name",
  "invalid_nickname",
  "invalid_bio",
  "invalid_avatar_size",
  "invalid_avatar_mime",
  "invalid_group_name",
  "invalid_group_description",
  "invalid_track_name",
  "invalid_track_description",
  // Library / upload reasons
  "byte_quota_exceeded",
  "cannot_remove_uploader",
  "target_not_member",
  "revision_number_conflict",
  "upload_missing",
  "upload_size_mismatch",
  "size_mismatch",
  "pending_upload_not_found",
  "upload_expired",
  "mime_not_allowed",
  "invalid_size",
  "no_metadata_provided",
  "library_item_disappeared",
  "library_ref_not_attached",
  "malformed_storage_key",
  "group_mismatch",
  // Invitations & access
  "invitation_not_found",
  "email_revoked",
  "unauthenticated",
  // Track lifecycle
  "track_status_transition_invalid",
  "self_remove_via_leave",
] as const;

type KnownProblemCode = PolicyDenialCode | (typeof INVARIANT_AND_VALIDATION_CODES)[number];

export const KNOWN_PROBLEM_CODES: readonly KnownProblemCode[] = [
  ...POLICY_DENIAL_CODES,
  ...INVARIANT_AND_VALIDATION_CODES,
];

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
 * copy change touches one place. Keys are typed against `KnownProblemCode`
 * so adding a new domain reason without a SPA copy is a compile error.
 */
const policyDenialMessages: Record<KnownProblemCode, string> = {
  // Policy denials
  already_revoked: "That operator role was already revoked.",
  cannot_revoke_self: "You can't revoke your own operator role. Ask another operator.",
  email_not_approved_yet:
    "Your email isn't on the Approved list for this Hearth Instance yet. Ask an Instance Operator to approve it, then try again.",
  enrollment_requires_membership:
    "Only current Group Members can be enrolled on this track. Add them to the group first.",
  group_archived: "This group is archived. Unarchive it first to make changes.",
  invitation_consumed: "This invitation has already been used.",
  invitation_email_mismatch: "This invitation was issued to a different email address.",
  invitation_expired: "This invitation expired. Ask a Group Admin for a new one.",
  invitation_revoked: "This invitation was revoked.",
  library_item_retired:
    "This item is retired. Existing references keep working, but new uploads against it are paused.",
  not_a_member: "You aren't a member of this group.",
  not_facilitator: "Only a Track Facilitator can do that.",
  not_group_admin: "Only a Group Admin can do that.",
  not_group_member: "You aren't a member of this group.",
  not_instance_operator: "Only an Instance Operator can do that.",
  not_library_steward:
    "Only the uploader, a Steward, a Group Admin, or an Instance Operator can do that.",
  not_self: "You can only edit your own profile in this group.",
  not_track_authority: "Only a Track Facilitator, Group Admin, or Instance Operator can do that.",
  not_track_enrollee: "You aren't enrolled on this track.",
  track_archived: "This track is archived. Unarchive it first to make changes.",
  track_paused: "This track is paused. Resume it first to make changes.",
  would_orphan_admin:
    "Active groups must keep at least one Group Admin. Promote another admin first.",
  would_orphan_facilitator:
    "Active tracks must keep at least one Facilitator. Promote another enrollee first.",
  would_orphan_operator:
    "An instance must keep at least one operator. Grant the role to someone else first.",
  // Activity invariants
  flow_cycle_detected:
    "Activity flow has a cycle — a Part can't depend on itself, directly or indirectly.",
  display_order_not_topo:
    "Part order must list every Part exactly once. Re-check the sequence and try again.",
  window_post_close_inconsistent:
    "Opens-at, due-at, and closes-at must be in order. Adjust the dates so the window is consistent.",
  part_library_mime_mismatch:
    "One of the referenced library items doesn't match the expected file type. Swap it for a compatible item.",
  duplicate_part_id: "Two Parts share the same id. Reorder Parts and try again.",
  duplicate_library_ref:
    "The same library item is referenced twice. Remove the duplicate and try again.",
  unknown_part_id_in_flow:
    "The Part order references a Part that doesn't exist. Refresh and try again.",
  cross_activity_prereq_cycle:
    "Cross-activity prerequisite would create a cycle. Drop one of the edges and try again.",
  audience_user_not_enrolled:
    "Audience includes someone who isn't enrolled on this track. Remove them or enroll them first.",
  pinned_revision_not_in_item:
    "The pinned library revision no longer exists. Pick the current revision and try again.",
  activity_has_dependents:
    "Other activities depend on this one. Drop the cross-activity prerequisite edges first.",
  prereq_cross_track: "Prerequisites must live on the same track. Remove the cross-track edge.",
  prereq_self_loop: "An activity can't be its own prerequisite.",
  suggested_cross_track:
    "Suggested-next activities must live on the same track. Remove the cross-track edge.",
  suggested_self_edge: "An activity can't suggest itself as the next step.",
  suggested_self_loop: "An activity can't suggest itself, directly or indirectly.",
  library_item_missing: "A referenced library item is missing. Pick another item.",
  library_item_no_revision: "That library item has no published revision yet.",
  library_item_wrong_group: "A referenced library item belongs to a different group.",
  // Profile / group / track validation
  already_exists: "That email is already on the Approved Email list.",
  user_not_found:
    "No signed-in user has this email yet. Add it to Approved Emails first — they'll appear here after they sign in.",
  actor_not_found: "Your account couldn't be loaded. Sign in again and retry.",
  invalid_email: "That email doesn't look valid.",
  invalid_title: "Title must be 1–200 characters.",
  invalid_instance_name: "The instance name must be 1–80 characters.",
  invalid_nickname: "Nickname must be 1–60 characters.",
  invalid_bio: "Bio must be 800 characters or fewer.",
  invalid_avatar_size: "Avatars must be 512 KB or smaller.",
  invalid_avatar_mime: "Avatars must be PNG, JPEG, or WebP.",
  invalid_group_name: "Group name must be 1–80 characters.",
  invalid_group_description: "Group description must be 4,000 characters or fewer.",
  invalid_track_name: "Track name must be 1–80 characters.",
  invalid_track_description: "Track description must be 4,000 characters or fewer.",
  // Library / upload reasons
  byte_quota_exceeded:
    "This upload would push the instance past its storage budget. Retire older items or ask an operator to expand the bucket.",
  cannot_remove_uploader: "The original uploader is always a Steward and can't be removed.",
  target_not_member: "Stewards must be current Group Members.",
  revision_number_conflict: "Another revision was added at the same time. Try again.",
  upload_missing: "The upload didn't complete. Check your connection and try again.",
  upload_size_mismatch:
    "The uploaded file's size didn't match what was reserved. Pick the file again and retry.",
  size_mismatch:
    "The uploaded file's size didn't match what was reserved. Pick the file again and retry.",
  pending_upload_not_found: "Upload session expired. Start a new one.",
  upload_expired: "Upload window expired. Pick the file and try again.",
  mime_not_allowed: "That file type isn't allowed here.",
  invalid_size: "The file size is outside the allowed range.",
  no_metadata_provided: "Upload metadata is missing. Pick the file again and retry.",
  library_item_disappeared:
    "The library item went away between the picker and the save. Refresh and pick again.",
  library_ref_not_attached: "That library item isn't attached to this activity.",
  malformed_storage_key: "The upload key looked malformed. Pick the file again and retry.",
  group_mismatch: "The referenced item belongs to a different group.",
  // Invitations & access
  invitation_not_found: "This invitation is no longer valid.",
  email_revoked: "That email's access was revoked. Re-approve it to re-grant entry.",
  unauthenticated: "Please sign in to continue.",
  // Track lifecycle
  track_status_transition_invalid:
    "That track status change isn't allowed. Refresh and try the action again.",
  self_remove_via_leave: "Use Leave Track to remove yourself instead.",
};

function problemMessage(problem: ApiProblem): string {
  const code = problem.policy?.code ?? problem.code;
  return policyDenialMessages[code as KnownProblemCode] ?? problem.detail;
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
