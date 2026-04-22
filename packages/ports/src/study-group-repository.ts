import type {
  GroupMembership,
  GroupStatus,
  StudyGroup,
  StudyGroupId,
  UserId,
} from "@hearth/domain";

export interface StudyGroupRepository {
  create(input: { name: string; description?: string }): Promise<StudyGroup>;
  byId(id: StudyGroupId): Promise<StudyGroup | null>;
  updateStatus(id: StudyGroupId, status: GroupStatus, by: UserId): Promise<void>;

  addMembership(groupId: StudyGroupId, userId: UserId): Promise<GroupMembership>;
  removeMembership(groupId: StudyGroupId, userId: UserId, by: UserId): Promise<void>;
  listMemberships(groupId: StudyGroupId): Promise<readonly GroupMembership[]>;
  membership(groupId: StudyGroupId, userId: UserId): Promise<GroupMembership | null>;
  listAdmins(groupId: StudyGroupId): Promise<readonly GroupMembership[]>;
  countAdmins(groupId: StudyGroupId): Promise<number>;
}
