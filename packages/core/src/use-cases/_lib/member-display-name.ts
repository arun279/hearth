import type { GroupMembership, User } from "@hearth/domain";

/**
 * Resolve the name to show for a member via the M3 precedence chain: their
 * group-scoped nickname, then their account name, then email, then the
 * snapshot captured at membership time, and finally a neutral `"Member"`
 * fallback for a row whose user and membership have both gone missing. Used
 * wherever a participant/member is rendered in a roster or a peer-facing
 * read — keep the fallback string consistent across every call site.
 */
export function memberDisplayName(user: User | null, membership: GroupMembership | null): string {
  return (
    membership?.profile.nickname ??
    user?.name ??
    user?.email ??
    membership?.displayNameSnapshot ??
    "Member"
  );
}
