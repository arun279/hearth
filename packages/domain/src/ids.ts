export type UserId = string & { readonly __brand: "UserId" };
export type StudyGroupId = string & { readonly __brand: "StudyGroupId" };
export type LearningTrackId = string & { readonly __brand: "LearningTrackId" };
export type LibraryItemId = string & { readonly __brand: "LibraryItemId" };
export type LibraryRevisionId = string & { readonly __brand: "LibraryRevisionId" };
export type LearningActivityId = string & { readonly __brand: "LearningActivityId" };
export type ActivityPartId = string & { readonly __brand: "ActivityPartId" };
export type ActivityRecordId = string & { readonly __brand: "ActivityRecordId" };
export type StudySessionId = string & { readonly __brand: "StudySessionId" };
export type GroupMembershipId = string & { readonly __brand: "GroupMembershipId" };
export type TrackEnrollmentId = string & { readonly __brand: "TrackEnrollmentId" };
export type InvitationId = string & { readonly __brand: "InvitationId" };
export type PendingContributionId = string & { readonly __brand: "PendingContributionId" };

export function asUserId(raw: string): UserId {
  return raw as UserId;
}
