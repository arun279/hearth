import type {
  GroupMembership,
  LearningTrack,
  LearningTrackId,
  StudyGroupId,
  TrackEnrollment,
  User,
  UserId,
} from "@hearth/domain";
import type { LearningTrackRepository, StudyGroupRepository, UserRepository } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { enrollInTrack } from "../src/use-cases/enroll-in-track.ts";

const now = new Date("2026-04-22T00:00:00.000Z");
const actorId = "u_actor" as UserId;
const groupId = "g_1" as StudyGroupId;
const trackId = "t_1" as LearningTrackId;

const actor: User = {
  id: actorId,
  email: "u@x.com",
  name: null,
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

const activeTrack: LearningTrack = {
  id: trackId,
  groupId,
  name: "T",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

const membership: GroupMembership = {
  groupId,
  userId: actorId,
  role: "participant",
  joinedAt: now,
  removedAt: null,
};

function makeUsers(user: User | null): UserRepository {
  return {
    byId: vi.fn(async () => user),
    byEmail: vi.fn(async () => null),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
  };
}

function makeTracks(overrides: Partial<LearningTrackRepository>): LearningTrackRepository {
  const enrolledRow: TrackEnrollment = {
    trackId,
    userId: actorId,
    role: "participant",
    enrolledAt: now,
    leftAt: null,
  };
  return {
    create: vi.fn(),
    byId: vi.fn(async () => activeTrack),
    byGroup: vi.fn(async () => []),
    updateStatus: vi.fn(),
    enroll: vi.fn(async () => enrolledRow),
    unenroll: vi.fn(),
    listEnrollments: vi.fn(async () => []),
    enrollment: vi.fn(async () => null),
    listFacilitators: vi.fn(async () => []),
    countFacilitators: vi.fn(async () => 0),
    ...overrides,
  };
}

function makeGroups(overrides: Partial<StudyGroupRepository>): StudyGroupRepository {
  return {
    create: vi.fn(),
    byId: vi.fn(),
    updateStatus: vi.fn(),
    addMembership: vi.fn(),
    removeMembership: vi.fn(),
    listMemberships: vi.fn(async () => []),
    membership: vi.fn(async () => membership),
    listAdmins: vi.fn(async () => []),
    countAdmins: vi.fn(async () => 1),
    ...overrides,
  };
}

describe("enrollInTrack", () => {
  it("enrolls a current member in an active track", async () => {
    const enroll = vi.fn(
      async (): Promise<TrackEnrollment> => ({
        trackId,
        userId: actorId,
        role: "participant",
        enrolledAt: now,
        leftAt: null,
      }),
    );
    await enrollInTrack(
      { actor: actorId, groupId, trackId },
      { users: makeUsers(actor), tracks: makeTracks({ enroll }), groups: makeGroups({}) },
    );
    expect(enroll).toHaveBeenCalledWith(trackId, actorId);
  });

  it("rejects NOT_FOUND when actor doesn't exist", async () => {
    await expect(
      enrollInTrack(
        { actor: actorId, groupId, trackId },
        { users: makeUsers(null), tracks: makeTracks({}), groups: makeGroups({}) },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects NOT_FOUND when track doesn't exist", async () => {
    await expect(
      enrollInTrack(
        { actor: actorId, groupId, trackId },
        {
          users: makeUsers(actor),
          tracks: makeTracks({ byId: vi.fn(async () => null) }),
          groups: makeGroups({}),
        },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects FORBIDDEN/track_archived on an archived track", async () => {
    const archived: LearningTrack = { ...activeTrack, status: "archived" };
    await expect(
      enrollInTrack(
        { actor: actorId, groupId, trackId },
        {
          users: makeUsers(actor),
          tracks: makeTracks({ byId: vi.fn(async () => archived) }),
          groups: makeGroups({}),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "track_archived" });
  });

  it("rejects FORBIDDEN/not_a_member when actor isn't in the group", async () => {
    await expect(
      enrollInTrack(
        { actor: actorId, groupId, trackId },
        {
          users: makeUsers(actor),
          tracks: makeTracks({}),
          groups: makeGroups({ membership: vi.fn(async () => null) }),
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", reason: "not_a_member" });
  });
});
