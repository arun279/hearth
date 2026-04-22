import type { StudyGroupId, UserId } from "./ids.ts";

export type GroupStatus = "active" | "archived";
export type AdmissionPolicy = "open" | "invite_only";
export type GroupRole = "participant" | "admin";

export type StudyGroup = {
  readonly id: StudyGroupId;
  readonly name: string;
  readonly description: string | null;
  readonly admissionPolicy: AdmissionPolicy;
  readonly status: GroupStatus;
  readonly archivedAt: Date | null;
  readonly archivedBy: UserId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type GroupMembership = {
  readonly groupId: StudyGroupId;
  readonly userId: UserId;
  readonly role: GroupRole;
  readonly joinedAt: Date;
  readonly removedAt: Date | null;
};
