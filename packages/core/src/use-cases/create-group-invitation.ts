import {
  DomainError,
  type GroupInvitation,
  type LearningTrackId,
  type StudyGroupId,
  type UserId,
} from "@hearth/domain";
import type {
  IdGenerator,
  InstanceAccessPolicyRepository,
  StudyGroupRepository,
  UserRepository,
} from "@hearth/ports";
import { loadInvitationAuthority } from "./_lib/load-invitation-authority.ts";

export type CreateGroupInvitationInput = {
  readonly actor: UserId;
  readonly groupId: StudyGroupId;
  readonly trackId: LearningTrackId | null;
  readonly email: string | null;
  readonly now: Date;
};

export type CreateGroupInvitationDeps = {
  readonly users: UserRepository;
  readonly groups: StudyGroupRepository;
  readonly policy: InstanceAccessPolicyRepository;
  readonly ids: IdGenerator;
};

export type CreateGroupInvitationResult = {
  readonly invitation: GroupInvitation;
  /**
   * `true` iff the email is already on the Approved Email allowlist (or
   * no email was specified). The SPA renders an "awaiting instance
   * approval" badge when this is `false` — the invitation is created
   * regardless, since the operator may approve the email later.
   */
  readonly emailApproved: boolean;
};

const TOKEN_BYTES = 32; // 256 bits — single-use random token.
const EXPIRY_DAYS = 14;
const MAX_EMAIL_LENGTH = 254;

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function mintToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/**
 * Mint a single-use, 14-day invitation. Delivery is intentionally out-of-
 * band — Hearth doesn't send email in v1, so the SPA shows the resulting
 * `acceptUrl` for the admin to copy and share via whatever channel the
 * group already uses.
 */
export async function createGroupInvitation(
  input: CreateGroupInvitationInput,
  deps: CreateGroupInvitationDeps,
): Promise<CreateGroupInvitationResult> {
  await loadInvitationAuthority(input.actor, input.groupId, deps);

  const normalizedEmail = input.email === null ? null : input.email.trim().toLowerCase();
  if (normalizedEmail !== null) {
    if (normalizedEmail.length === 0 || normalizedEmail.length > MAX_EMAIL_LENGTH) {
      throw new DomainError(
        "INVARIANT_VIOLATION",
        "Email must be between 1 and 254 characters.",
        "invalid_email",
      );
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      throw new DomainError("INVARIANT_VIOLATION", "Email must include a domain.", "invalid_email");
    }
  }

  const expiresAt = new Date(input.now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const token = mintToken();

  const invitation = await deps.groups.createInvitation({
    groupId: input.groupId,
    trackId: input.trackId,
    token,
    email: normalizedEmail,
    createdBy: input.actor,
    expiresAt,
  });

  const emailApproved =
    normalizedEmail === null ? true : await deps.policy.isEmailApproved(normalizedEmail);

  return { invitation, emailApproved };
}
