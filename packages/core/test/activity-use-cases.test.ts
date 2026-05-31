import type {
  LearningActivity,
  LearningActivityDraft,
  LearningActivityId,
  LearningActivityListRow,
  LearningTrack,
  LearningTrackId,
  LibraryItem,
  LibraryItemId,
  LibraryRevision,
  UserId,
} from "@hearth/domain";
import { describe, expect, it, vi } from "vitest";
import { createActivity } from "../src/use-cases/create-activity.ts";
import { deleteActivity } from "../src/use-cases/delete-activity.ts";
import { getActivity } from "../src/use-cases/get-activity.ts";
import { listTrackActivities } from "../src/use-cases/list-track-activities.ts";
import { pinLibraryRevision } from "../src/use-cases/pin-library-revision.ts";
import { setActivityLibraryRefs } from "../src/use-cases/set-activity-library-refs.ts";
import { setActivityPrerequisites } from "../src/use-cases/set-activity-prerequisites.ts";
import { setActivitySuggestedSequences } from "../src/use-cases/set-activity-suggested-sequences.ts";
import { unpinLibraryRevision } from "../src/use-cases/unpin-library-revision.ts";
import { updateActivity } from "../src/use-cases/update-activity.ts";
import {
  ACTIVE_GROUP,
  ACTOR,
  ACTOR_ID,
  GROUP_ID,
  makeActivities,
  makeGroups,
  makeLibrary,
  makePolicy,
  makeTracks,
  makeUsers,
  membership,
  TEST_NOW,
} from "./_helpers.ts";

const TRACK_ID = "t_1" as LearningTrackId;
const ACTIVITY_ID = "a_1" as LearningActivityId;
const OTHER_ACTIVITY_ID = "a_2" as LearningActivityId;
const ITEM_ID = "li_1" as LibraryItemId;

const ACTIVE_TRACK: LearningTrack = {
  id: TRACK_ID,
  groupId: GROUP_ID,
  name: "Beginner Spanish",
  description: null,
  status: "active",
  pausedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

const baseDraft = (): LearningActivityDraft => ({
  trackId: TRACK_ID,
  title: "Activity",
  description: null,
  parts: [{ kind: "write_reflection", id: "p1", prompt: "Reflect." }],
  flow: { prereqs: [] },
  audience: { kind: "everyone_enrolled" },
  window: null,
  postClosePolicy: null,
  completionRule: { kind: "manual_mark" },
  libraryRefs: [],
  prerequisiteActivityIds: [],
  suggestedNextActivityIds: [],
});

const baseActivity: LearningActivity = {
  id: ACTIVITY_ID,
  trackId: TRACK_ID,
  title: "Activity",
  description: null,
  parts: [{ kind: "write_reflection", id: "p1", prompt: "Reflect." }],
  flow: { prereqs: [] },
  audience: { kind: "everyone_enrolled" },
  window: null,
  postClosePolicy: null,
  completionRule: { kind: "manual_mark" },
  participationMode: "individual",
  libraryRefs: [],
  prerequisiteActivityIds: [],
  suggestedNextActivityIds: [],
  createdAt: TEST_NOW,
  updatedAt: TEST_NOW,
};

const facilitatorTracks = () =>
  makeTracks({
    byId: vi.fn(async () => ACTIVE_TRACK),
    enrollment: vi.fn(async () => ({
      trackId: TRACK_ID,
      userId: ACTOR_ID,
      role: "facilitator" as const,
      enrolledAt: TEST_NOW,
      leftAt: null,
    })),
    listEnrollments: vi.fn(async () => [
      {
        trackId: TRACK_ID,
        userId: ACTOR_ID,
        role: "facilitator" as const,
        enrolledAt: TEST_NOW,
        leftAt: null,
      },
    ]),
  });

const baseGroups = () =>
  makeGroups({
    byId: vi.fn(async () => ACTIVE_GROUP),
    membership: vi.fn(async () => membership({ role: "participant" })),
  });

const basePolicy = () => makePolicy({ getOperator: vi.fn(async () => null) });

describe("create-activity with prereqs", () => {
  it("walks prereq edges to detect cross-activity cycles", async () => {
    const draft: LearningActivityDraft = {
      ...baseDraft(),
      prerequisiteActivityIds: [OTHER_ACTIVITY_ID],
    };
    const created = vi.fn(async () => baseActivity);
    await createActivity(
      { actor: ACTOR_ID, draft },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        library: makeLibrary(),
        activities: makeActivities({
          create: created,
          listPrerequisitesFor: vi.fn(async () => []),
        }),
      },
    );
    expect(created).toHaveBeenCalled();
  });

  it("rejects when proposed prereqs would close a cross-activity cycle", async () => {
    const draft: LearningActivityDraft = {
      ...baseDraft(),
      prerequisiteActivityIds: [OTHER_ACTIVITY_ID],
    };
    // Existing edge: OTHER → __pending_create__ creates a cycle when the
    // new activity adds OTHER as a prereq. The use case uses a synthetic
    // pseudo-id, but the cycle check is the same — exercise the edge
    // walker via a chain where OTHER points back.
    await expect(
      createActivity(
        { actor: ACTOR_ID, draft },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary(),
          activities: makeActivities({
            create: vi.fn(),
            listPrerequisitesFor: vi.fn(async (id) =>
              id === OTHER_ACTIVITY_ID ? ["__pending_create__" as LearningActivityId] : [],
            ),
          }),
        },
      ),
    ).rejects.toThrow(/cycle/);
  });
});

describe("validate-activity-draft branches (via createActivity)", () => {
  const audioItem: LibraryItem = {
    id: ITEM_ID,
    groupId: GROUP_ID,
    title: "song",
    description: null,
    tags: [],
    currentRevisionId: "rev_1" as never,
    uploadedBy: ACTOR_ID,
    retiredAt: null,
    retiredBy: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  };
  const audioRevision: LibraryRevision = {
    id: "rev_1" as never,
    libraryItemId: ITEM_ID,
    revisionNumber: 1,
    storageKey: "k",
    mimeType: "audio/mpeg",
    sizeBytes: 1,
    originalFilename: null,
    uploadedBy: ACTOR_ID,
    uploadedAt: TEST_NOW,
  };

  const validDraft: LearningActivityDraft = {
    ...baseDraft(),
    parts: [{ kind: "listen_audio", id: "p1", libraryItemId: ITEM_ID }],
    libraryRefs: [{ libraryItemId: ITEM_ID, pinnedRevisionId: null }],
  };

  function depsWith(
    overrides: Partial<{ item: LibraryItem | null; revisions: LibraryRevision[] }>,
  ) {
    const item = overrides.item === undefined ? audioItem : overrides.item;
    const revs = overrides.revisions ?? [audioRevision];
    return {
      users: makeUsers(ACTOR),
      groups: baseGroups(),
      tracks: facilitatorTracks(),
      policy: basePolicy(),
      library: makeLibrary({
        byId: vi.fn(async () => item),
        currentRevision: vi.fn(async () => revs[0] ?? null),
        listRevisions: vi.fn(async () => revs),
      }),
      activities: makeActivities({ create: vi.fn(async () => baseActivity) }),
    };
  }

  it("rejects when referenced library item is missing", async () => {
    await expect(
      createActivity({ actor: ACTOR_ID, draft: validDraft }, depsWith({ item: null })),
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects when item belongs to another group", async () => {
    await expect(
      createActivity(
        { actor: ACTOR_ID, draft: validDraft },
        depsWith({ item: { ...audioItem, groupId: "g_other" as never } }),
      ),
    ).rejects.toThrow(/another group/);
  });

  it("rejects when item is retired", async () => {
    await expect(
      createActivity(
        { actor: ACTOR_ID, draft: validDraft },
        depsWith({ item: { ...audioItem, retiredAt: TEST_NOW } }),
      ),
    ).rejects.toThrow(/[Rr]etired/);
  });

  it("rejects when item has no current revision", async () => {
    await expect(
      createActivity({ actor: ACTOR_ID, draft: validDraft }, depsWith({ revisions: [] })),
    ).rejects.toThrow(/no current revision/);
  });

  it("rejects pinned revision that does not belong to the item", async () => {
    const draftWithBadPin: LearningActivityDraft = {
      ...validDraft,
      libraryRefs: [{ libraryItemId: ITEM_ID, pinnedRevisionId: "rev_other" }],
    };
    await expect(
      createActivity({ actor: ACTOR_ID, draft: draftWithBadPin }, depsWith({})),
    ).rejects.toThrow(/does not belong/);
  });
});

describe("create-activity (extended)", () => {
  it("rejects mime mismatch — read part referencing audio item", async () => {
    const audioItem: LibraryItem = {
      id: ITEM_ID,
      groupId: GROUP_ID,
      title: "song",
      description: null,
      tags: [],
      currentRevisionId: "rev_1" as never,
      uploadedBy: ACTOR_ID,
      retiredAt: null,
      retiredBy: null,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    };
    const audioRevision: LibraryRevision = {
      id: "rev_1" as never,
      libraryItemId: ITEM_ID,
      revisionNumber: 1,
      storageKey: "k",
      mimeType: "audio/mpeg",
      sizeBytes: 1,
      originalFilename: null,
      uploadedBy: ACTOR_ID,
      uploadedAt: TEST_NOW,
    };
    const draft: LearningActivityDraft = {
      ...baseDraft(),
      parts: [{ kind: "read_library_item", id: "p1", libraryItemId: ITEM_ID }],
    };
    await expect(
      createActivity(
        { actor: ACTOR_ID, draft },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary({
            byId: vi.fn(async () => audioItem),
            currentRevision: vi.fn(async () => audioRevision),
            listRevisions: vi.fn(async () => [audioRevision]),
          }),
          activities: makeActivities(),
        },
      ),
    ).rejects.toThrow(/cannot render/);
  });
});

describe("loadViewableActivity NOT_FOUND paths (via getActivity)", () => {
  it("404s when the activity does not exist", async () => {
    await expect(
      getActivity(
        { actor: ACTOR_ID, id: ACTIVITY_ID },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          activities: makeActivities({ byId: vi.fn(async () => null) }),
        },
      ),
    ).rejects.toThrow(/Activity not found/);
  });

  it("404s when the activity's trackId does not match the loaded track", async () => {
    const mismatched: LearningActivity = {
      ...baseActivity,
      trackId: "t_mismatch" as LearningTrackId,
    };
    await expect(
      getActivity(
        { actor: ACTOR_ID, id: ACTIVITY_ID },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: makeTracks({
            // The first byId loads the mismatched track; loadViewableTrack
            // then loads the parent group, but the post-check in
            // loadViewableActivity sees that activity.trackId !== loaded
            // track.id — collapse to NOT_FOUND.
            byId: vi.fn(async () => ({ ...ACTIVE_TRACK, id: "t_other" as LearningTrackId })),
            enrollment: vi.fn(async () => null),
          }),
          policy: basePolicy(),
          activities: makeActivities({ byId: vi.fn(async () => mismatched) }),
        },
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("policy denials across activity use cases", () => {
  // Drive every authority-gated use case once with a non-authority actor
  // so each policy-deny branch is exercised.
  function nonAuthorityDeps() {
    return {
      users: makeUsers(ACTOR),
      groups: makeGroups({
        byId: vi.fn(async () => ACTIVE_GROUP),
        membership: vi.fn(async () => membership({ role: "participant" })),
      }),
      tracks: makeTracks({
        byId: vi.fn(async () => ACTIVE_TRACK),
        enrollment: vi.fn(async () => null),
      }),
      policy: basePolicy(),
      library: makeLibrary(),
      activities: makeActivities({ byId: vi.fn(async () => baseActivity) }),
    };
  }

  it("update-activity denies non-authority", async () => {
    await expect(
      updateActivity(
        { actor: ACTOR_ID, id: ACTIVITY_ID, patch: { title: "x" } },
        nonAuthorityDeps(),
      ),
    ).rejects.toThrow(/Only a Group Admin or Track Facilitator/);
  });

  it("delete-activity denies non-authority", async () => {
    await expect(
      deleteActivity({ actor: ACTOR_ID, id: ACTIVITY_ID }, nonAuthorityDeps()),
    ).rejects.toThrow(/Only a Group Admin or Track Facilitator/);
  });

  it("set-activity-prerequisites denies non-authority", async () => {
    await expect(
      setActivityPrerequisites(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, prerequisiteActivityIds: [] },
        nonAuthorityDeps(),
      ),
    ).rejects.toThrow(/Only a Group Admin or Track Facilitator/);
  });

  it("set-activity-suggested-sequences denies non-authority", async () => {
    await expect(
      setActivitySuggestedSequences(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, nextActivityIds: [] },
        nonAuthorityDeps(),
      ),
    ).rejects.toThrow(/Only a Group Admin or Track Facilitator/);
  });

  it("set-activity-library-refs denies non-authority", async () => {
    await expect(
      setActivityLibraryRefs(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, refs: [] },
        nonAuthorityDeps(),
      ),
    ).rejects.toThrow(/Only a Group Admin or Track Facilitator/);
  });

  it("pin-library-revision denies non-authority", async () => {
    await expect(
      pinLibraryRevision(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          libraryItemId: ITEM_ID,
          revisionId: "rev",
        },
        nonAuthorityDeps(),
      ),
    ).rejects.toThrow(/Only a Group Admin or Track Facilitator/);
  });

  it("unpin-library-revision denies non-authority", async () => {
    await expect(
      unpinLibraryRevision(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, libraryItemId: ITEM_ID },
        nonAuthorityDeps(),
      ),
    ).rejects.toThrow(/Only a Group Admin or Track Facilitator/);
  });
});

describe("update-activity", () => {
  it("preserves prior libraryRefs when the patch omits them", async () => {
    // Activity already has a ref; patch doesn't mention libraryRefs;
    // the merged draft must carry the existing ref forward unchanged.
    const item: LibraryItem = {
      id: ITEM_ID,
      groupId: GROUP_ID,
      title: "x",
      description: null,
      tags: [],
      currentRevisionId: "rev_1" as never,
      uploadedBy: ACTOR_ID,
      retiredAt: null,
      retiredBy: null,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    };
    const revision: LibraryRevision = {
      id: "rev_1" as never,
      libraryItemId: ITEM_ID,
      revisionNumber: 1,
      storageKey: "k",
      mimeType: "application/pdf",
      sizeBytes: 1,
      originalFilename: null,
      uploadedBy: ACTOR_ID,
      uploadedAt: TEST_NOW,
    };
    const activityWithRef: LearningActivity = {
      ...baseActivity,
      libraryRefs: [
        { id: "ref_1", activityId: ACTIVITY_ID, libraryItemId: ITEM_ID, pinnedRevisionId: null },
      ],
    };
    const update = vi.fn(async () => activityWithRef);
    await updateActivity(
      { actor: ACTOR_ID, id: ACTIVITY_ID, patch: { title: "Renamed" } },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        library: makeLibrary({
          byId: vi.fn(async () => item),
          currentRevision: vi.fn(async () => revision),
          listRevisions: vi.fn(async () => [revision]),
        }),
        activities: makeActivities({
          byId: vi.fn(async () => activityWithRef),
          update,
        }),
      },
    );
    expect(update).toHaveBeenCalled();
  });

  it("merges patch with prior activity and writes", async () => {
    const update = vi.fn(async () => ({ ...baseActivity, title: "Renamed" }));
    const result = await updateActivity(
      { actor: ACTOR_ID, id: ACTIVITY_ID, patch: { title: "Renamed" } },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        library: makeLibrary(),
        activities: makeActivities({
          byId: vi.fn(async () => baseActivity),
          update,
        }),
      },
    );
    expect(result.title).toBe("Renamed");
    expect(update).toHaveBeenCalled();
  });

  // The atomic-save path: the composer ships every aggregate field in
  // one PUT, so the use case orchestrates the body update plus three
  // child writes (library refs, prereqs, suggested-sequences) and
  // reloads the assembled aggregate. Each child path is exercised here
  // so the orchestration coverage stays load-bearing.
  it("orchestrates body + children writes and reloads via byId", async () => {
    const sibling: LearningActivityListRow = {
      id: "a_sibling" as never,
      trackId: TRACK_ID,
      title: "sibling",
      description: null,
      partCount: 1,
      partKindSequence: ["write_reflection"],
      libraryRefCount: 0,
      prereqCount: 0,
      suggestedNextCount: 0,
      audience: { kind: "everyone_enrolled" },
      window: null,
      postClosePolicy: null,
      completionRuleKind: "manual_mark",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    };
    const item: LibraryItem = {
      id: ITEM_ID,
      groupId: GROUP_ID,
      title: "x",
      description: null,
      tags: [],
      currentRevisionId: "rev_1" as never,
      uploadedBy: ACTOR_ID,
      retiredAt: null,
      retiredBy: null,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    };
    const revision: LibraryRevision = {
      id: "rev_1" as never,
      libraryItemId: ITEM_ID,
      revisionNumber: 1,
      storageKey: "k",
      mimeType: "application/pdf",
      sizeBytes: 1,
      originalFilename: null,
      uploadedBy: ACTOR_ID,
      uploadedAt: TEST_NOW,
    };
    const update = vi.fn(async () => baseActivity);
    const setLibraryRefs = vi.fn(async () => []);
    const setPrerequisites = vi.fn(async () => []);
    const setSuggestedSequences = vi.fn(async () => []);
    const finalState: LearningActivity = {
      ...baseActivity,
      title: "Final",
      prerequisiteActivityIds: [sibling.id],
      suggestedNextActivityIds: [sibling.id],
    };
    const byId = vi.fn(async () => baseActivity);
    // The use case calls byId twice: once for the initial viewability
    // check + cycle context, and a second time for the post-orchestration
    // reload that returns the assembled aggregate.
    byId.mockResolvedValueOnce(baseActivity); // load-viewable
    byId.mockResolvedValueOnce(baseActivity); // cross-activity lookup of trackId
    byId.mockResolvedValueOnce(finalState); // post-write reload
    const result = await updateActivity(
      {
        actor: ACTOR_ID,
        id: ACTIVITY_ID,
        patch: {
          title: "Final",
          libraryRefs: [{ libraryItemId: ITEM_ID, pinnedRevisionId: null }],
          prerequisiteActivityIds: [sibling.id],
          suggestedNextActivityIds: [sibling.id],
        },
      },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        library: makeLibrary({
          byId: vi.fn(async () => item),
          currentRevision: vi.fn(async () => revision),
          listRevisions: vi.fn(async () => [revision]),
        }),
        activities: makeActivities({
          byId,
          byTrack: vi.fn(async () => [sibling]),
          listPrerequisitesFor: vi.fn(async () => []),
          update,
          setLibraryRefs,
          setPrerequisites,
          setSuggestedSequences,
        }),
      },
    );
    expect(result.title).toBe("Final");
    expect(update).toHaveBeenCalled();
    expect(setLibraryRefs).toHaveBeenCalled();
    expect(setPrerequisites).toHaveBeenCalled();
    expect(setSuggestedSequences).toHaveBeenCalled();
  });

  it("rejects a prereq pointing at the activity itself", async () => {
    await expect(
      updateActivity(
        {
          actor: ACTOR_ID,
          id: ACTIVITY_ID,
          patch: { prerequisiteActivityIds: [ACTIVITY_ID] },
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary(),
          activities: makeActivities({ byId: vi.fn(async () => baseActivity) }),
        },
      ),
    ).rejects.toThrow(/cannot list itself/);
  });

  it("rejects a prereq targeting an activity on a different track", async () => {
    await expect(
      updateActivity(
        {
          actor: ACTOR_ID,
          id: ACTIVITY_ID,
          patch: { prerequisiteActivityIds: ["a_off_track" as never] },
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary(),
          activities: makeActivities({
            byId: vi.fn(async () => baseActivity),
            byTrack: vi.fn(async () => []),
          }),
        },
      ),
    ).rejects.toThrow(/not on the same track/);
  });

  it("rejects a suggested-next targeting an activity on a different track", async () => {
    await expect(
      updateActivity(
        {
          actor: ACTOR_ID,
          id: ACTIVITY_ID,
          patch: { suggestedNextActivityIds: ["a_off_track" as never] },
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary(),
          activities: makeActivities({
            byId: vi.fn(async () => baseActivity),
            byTrack: vi.fn(async () => []),
          }),
        },
      ),
    ).rejects.toThrow(/not on the same track/);
  });

  it("rejects a prereq that closes a cross-activity cycle", async () => {
    const sibling: LearningActivityListRow = {
      id: "a_sibling" as never,
      trackId: TRACK_ID,
      title: "sibling",
      description: null,
      partCount: 1,
      partKindSequence: ["write_reflection"],
      libraryRefCount: 0,
      prereqCount: 1,
      suggestedNextCount: 0,
      audience: { kind: "everyone_enrolled" },
      window: null,
      postClosePolicy: null,
      completionRuleKind: "manual_mark",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    };
    const byId = vi.fn(async () => baseActivity);
    byId.mockResolvedValueOnce(baseActivity); // load-viewable
    byId.mockResolvedValueOnce(baseActivity); // cross-activity lookup
    await expect(
      updateActivity(
        {
          actor: ACTOR_ID,
          id: ACTIVITY_ID,
          patch: { prerequisiteActivityIds: [sibling.id] },
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary(),
          activities: makeActivities({
            byId,
            byTrack: vi.fn(async () => [sibling]),
            // Sibling already requires this activity — adding the
            // reverse edge closes a 2-node cycle.
            listPrerequisitesFor: vi.fn(async () => [ACTIVITY_ID]),
          }),
        },
      ),
    ).rejects.toThrow(/cycle/i);
  });

  it("throws NOT_FOUND when the activity disappears between the validation byId and the prereq cycle byId", async () => {
    // The cross-activity cycle helper re-loads the activity to discover
    // its trackId. If the row vanishes between the use-case load and
    // the helper's load (e.g., a concurrent delete), the helper throws.
    let calls = 0;
    const byId = vi.fn(async () => {
      calls += 1;
      // First call: load-viewable returns the row. Second call:
      // cross-activity helper sees vanished row.
      return calls === 1 ? baseActivity : null;
    });
    await expect(
      updateActivity(
        {
          actor: ACTOR_ID,
          id: ACTIVITY_ID,
          patch: { prerequisiteActivityIds: ["a_other" as never] },
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary(),
          activities: makeActivities({ byId, byTrack: vi.fn(async () => []) }),
        },
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("throws NOT_FOUND when the post-write reload sees the activity vanished", async () => {
    // The orchestrated children writes succeed, then byId is called
    // again to assemble the final aggregate. A concurrent delete in
    // that gap means the reload returns null.
    let calls = 0;
    const byId = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? baseActivity : null;
    });
    await expect(
      updateActivity(
        {
          actor: ACTOR_ID,
          id: ACTIVITY_ID,
          patch: { libraryRefs: [] },
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary(),
          activities: makeActivities({
            byId,
            setLibraryRefs: vi.fn(async () => []),
          }),
        },
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects a suggested-next pointing at the activity itself", async () => {
    await expect(
      updateActivity(
        {
          actor: ACTOR_ID,
          id: ACTIVITY_ID,
          patch: { suggestedNextActivityIds: [ACTIVITY_ID] },
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary(),
          activities: makeActivities({ byId: vi.fn(async () => baseActivity) }),
        },
      ),
    ).rejects.toThrow(/cannot list itself/);
  });
});

describe("delete-activity", () => {
  const deps = (overrides: Partial<Parameters<typeof deleteActivity>[1]>) => ({
    users: makeUsers(ACTOR),
    groups: baseGroups(),
    tracks: facilitatorTracks(),
    policy: basePolicy(),
    activities: makeActivities({
      byId: vi.fn(async () => baseActivity),
      ...((overrides.activities as object | undefined) ?? {}),
    }),
    ...overrides,
  });

  it("happy path", async () => {
    const remove = vi.fn();
    await deleteActivity(
      { actor: ACTOR_ID, id: ACTIVITY_ID },
      deps({
        activities: makeActivities({
          byId: vi.fn(async () => baseActivity),
          delete: remove,
          listDependentsOf: vi.fn(async () => []),
        }),
      }),
    );
    expect(remove).toHaveBeenCalled();
  });

  it("refuses CONFLICT when dependents exist", async () => {
    await expect(
      deleteActivity(
        { actor: ACTOR_ID, id: ACTIVITY_ID },
        deps({
          activities: makeActivities({
            byId: vi.fn(async () => baseActivity),
            listDependentsOf: vi.fn(async () => [{ id: OTHER_ACTIVITY_ID, title: "Other" }]),
          }),
        }),
      ),
    ).rejects.toThrow(/required by/);
  });
});

describe("get-activity / list-track-activities", () => {
  it("get returns the activity", async () => {
    const result = await getActivity(
      { actor: ACTOR_ID, id: ACTIVITY_ID },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        activities: makeActivities({ byId: vi.fn(async () => baseActivity) }),
      },
    );
    expect(result.id).toBe(ACTIVITY_ID);
  });

  const quizActivity: LearningActivity = {
    ...baseActivity,
    parts: [
      {
        kind: "quiz",
        id: "p_quiz",
        questions: [
          {
            id: "q1",
            prompt: "MC",
            shape: { kind: "multiple_choice", options: ["a", "b"], answerKeyIndex: 1 },
          },
          {
            id: "q2",
            prompt: "SA",
            shape: {
              kind: "short_answer",
              correctAnswer: "yes",
              alsoAccept: [],
              exactMatch: false,
            },
          },
        ],
      },
    ],
  };

  it("get returns unredacted quiz answer keys to an edit-authority caller", async () => {
    const result = await getActivity(
      { actor: ACTOR_ID, id: ACTIVITY_ID },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        activities: makeActivities({ byId: vi.fn(async () => quizActivity) }),
      },
    );
    const quiz = result.parts.find((p) => p.kind === "quiz");
    expect(quiz?.kind).toBe("quiz");
    if (quiz?.kind === "quiz") {
      expect((quiz.questions[0]?.shape as { answerKeyIndex?: number }).answerKeyIndex).toBe(1);
      expect((quiz.questions[1]?.shape as { correctAnswer?: string }).correctAnswer).toBe("yes");
    }
  });

  it("get strips quiz answer keys for a non-editor viewer (no key leak via the detail route)", async () => {
    const participantTracks = makeTracks({
      byId: vi.fn(async () => ACTIVE_TRACK),
      enrollment: vi.fn(async () => ({
        trackId: TRACK_ID,
        userId: ACTOR_ID,
        role: "participant" as const,
        enrolledAt: TEST_NOW,
        leftAt: null,
      })),
    });
    const result = await getActivity(
      { actor: ACTOR_ID, id: ACTIVITY_ID },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: participantTracks,
        policy: basePolicy(),
        activities: makeActivities({ byId: vi.fn(async () => quizActivity) }),
      },
    );
    const quiz = result.parts.find((p) => p.kind === "quiz");
    expect(quiz?.kind).toBe("quiz");
    if (quiz?.kind === "quiz") {
      expect(
        (quiz.questions[0]?.shape as { answerKeyIndex?: number }).answerKeyIndex,
      ).toBeUndefined();
      expect(
        (quiz.questions[1]?.shape as { correctAnswer?: string }).correctAnswer,
      ).toBeUndefined();
    }
  });

  it("list returns the projection", async () => {
    const result = await listTrackActivities(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        activities: makeActivities({ byTrack: vi.fn(async () => []) }),
        clock: { now: () => TEST_NOW },
      },
    );
    expect(result).toEqual([]);
  });

  it("filters_post_close_hidden — list omits rows whose accessState is hidden", async () => {
    // Two rows with identical shape except the post-close policy. The
    // second's `closesAt` has already passed AND its policy is
    // `hidden` — the use case must drop it so a viewer who once had
    // access cannot enumerate it by listing the track.
    const past = new Date(TEST_NOW.getTime() - 24 * 60 * 60 * 1000);
    const baseRow = {
      trackId: TRACK_ID,
      description: null,
      partCount: 1,
      partKindSequence: ["write_reflection"],
      libraryRefCount: 0,
      prereqCount: 0,
      suggestedNextCount: 0,
      audience: { kind: "everyone_enrolled" as const },
      completionRuleKind: "manual_mark" as const,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    };
    const visible: LearningActivityListRow = {
      ...baseRow,
      id: "a_visible" as LearningActivityId,
      title: "visible",
      window: null,
      postClosePolicy: null,
    };
    const hidden: LearningActivityListRow = {
      ...baseRow,
      id: "a_hidden" as LearningActivityId,
      title: "hidden",
      window: { opensAt: null, dueAt: null, closesAt: past.getTime() },
      postClosePolicy: { kind: "hidden" },
    };
    const result = await listTrackActivities(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        activities: makeActivities({ byTrack: vi.fn(async () => [visible, hidden]) }),
        clock: { now: () => TEST_NOW },
      },
    );
    expect(result.map((r) => r.id)).toEqual(["a_visible"]);
  });

  it("filters_audience_subset_exclusion — list omits subset rows that exclude the actor", async () => {
    // ACTOR is a plain participant (not a facilitator, not an operator).
    // Two subset-audience rows: one lists ACTOR, one doesn't. Only the
    // first survives the list. Without this filter, the excluded row
    // would advertise its title to a non-audience member who clicks
    // and 404s at /player — an enumeration oracle on the audience axis.
    const baseRow = {
      trackId: TRACK_ID,
      description: null,
      partCount: 1,
      partKindSequence: ["write_reflection"],
      libraryRefCount: 0,
      prereqCount: 0,
      suggestedNextCount: 0,
      window: null,
      postClosePolicy: null,
      completionRuleKind: "manual_mark" as const,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    };
    const inAudience: LearningActivityListRow = {
      ...baseRow,
      id: "a_in_audience" as LearningActivityId,
      title: "actor listed",
      audience: { kind: "subset", userIds: [ACTOR_ID] },
    };
    const excluded: LearningActivityListRow = {
      ...baseRow,
      id: "a_excluded" as LearningActivityId,
      title: "actor not listed",
      audience: { kind: "subset", userIds: ["u_someone_else" as UserId] },
    };
    // Override the default facilitator enrollment with a plain
    // participant — facilitators bypass audience filtering by design
    // (track authority can QA any subset). Filtering only fires for
    // non-authority members.
    const participantTracks = makeTracks({
      byId: vi.fn(async () => ACTIVE_TRACK),
      enrollment: vi.fn(async () => ({
        trackId: TRACK_ID,
        userId: ACTOR_ID,
        role: "participant" as const,
        enrolledAt: TEST_NOW,
        leftAt: null,
      })),
    });
    const result = await listTrackActivities(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: participantTracks,
        policy: basePolicy(),
        activities: makeActivities({ byTrack: vi.fn(async () => [inAudience, excluded]) }),
        clock: { now: () => TEST_NOW },
      },
    );
    expect(result.map((r) => r.id)).toEqual(["a_in_audience"]);
  });

  it("authority_sees_subset_through_list — facilitator sees subset rows they're not listed in", async () => {
    // Mirror of the participant-exclusion case for the authority branch
    // of `canSeeActivity`: a facilitator (track authority) must be able
    // to see narrowed activities for QA purposes even when they aren't
    // in `audience.userIds`. Without this branch, the composer surfaces
    // and the list would diverge for the very role that needs to
    // author + spot-check those activities.
    //
    // ACTOR is the default facilitator-enrolled actor; both rows surface.
    const baseRow = {
      trackId: TRACK_ID,
      description: null,
      partCount: 1,
      partKindSequence: ["write_reflection"],
      libraryRefCount: 0,
      prereqCount: 0,
      suggestedNextCount: 0,
      window: null,
      postClosePolicy: null,
      completionRuleKind: "manual_mark" as const,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    };
    const inAudience: LearningActivityListRow = {
      ...baseRow,
      id: "a_in_audience" as LearningActivityId,
      title: "actor listed",
      audience: { kind: "subset", userIds: [ACTOR_ID] },
    };
    const excluded: LearningActivityListRow = {
      ...baseRow,
      id: "a_excluded" as LearningActivityId,
      title: "actor not listed",
      audience: { kind: "subset", userIds: ["u_someone_else" as UserId] },
    };
    const result = await listTrackActivities(
      { actor: ACTOR_ID, trackId: TRACK_ID },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        activities: makeActivities({ byTrack: vi.fn(async () => [inAudience, excluded]) }),
        clock: { now: () => TEST_NOW },
      },
    );
    expect(result.map((r) => r.id)).toEqual(["a_in_audience", "a_excluded"]);
  });
});

describe("pin / unpin library revision", () => {
  const itemAttached: LearningActivity = {
    ...baseActivity,
    libraryRefs: [
      { id: "ref_1", activityId: ACTIVITY_ID, libraryItemId: ITEM_ID, pinnedRevisionId: null },
    ],
  };
  const revision: LibraryRevision = {
    id: "rev_1" as never,
    libraryItemId: ITEM_ID,
    revisionNumber: 1,
    storageKey: "k",
    mimeType: "application/pdf",
    sizeBytes: 1,
    originalFilename: null,
    uploadedBy: ACTOR_ID,
    uploadedAt: TEST_NOW,
  };

  it("pin happy path", async () => {
    const setLibraryRefs = vi.fn(async () => []);
    await pinLibraryRevision(
      {
        actor: ACTOR_ID,
        activityId: ACTIVITY_ID,
        libraryItemId: ITEM_ID,
        revisionId: "rev_1",
      },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        library: makeLibrary({ listRevisions: vi.fn(async () => [revision]) }),
        activities: makeActivities({
          byId: vi.fn(async () => itemAttached),
          setLibraryRefs,
        }),
      },
    );
    expect(setLibraryRefs).toHaveBeenCalled();
  });

  it("pin rejects revision that does not belong to the item", async () => {
    await expect(
      pinLibraryRevision(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          libraryItemId: ITEM_ID,
          revisionId: "rev_other",
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary({ listRevisions: vi.fn(async () => [revision]) }),
          activities: makeActivities({ byId: vi.fn(async () => itemAttached) }),
        },
      ),
    ).rejects.toThrow(/pinned_revision_not_in_item|does not belong/);
  });

  it("pin rejects when library item is not attached", async () => {
    await expect(
      pinLibraryRevision(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          libraryItemId: "unrelated",
          revisionId: "rev_1",
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary(),
          activities: makeActivities({ byId: vi.fn(async () => itemAttached) }),
        },
      ),
    ).rejects.toThrow(/not attached|library_ref_not_attached/);
  });

  it("unpin happy path", async () => {
    const pinned: LearningActivity = {
      ...baseActivity,
      libraryRefs: [
        {
          id: "ref_1",
          activityId: ACTIVITY_ID,
          libraryItemId: ITEM_ID,
          pinnedRevisionId: "rev_1",
        },
      ],
    };
    const setLibraryRefs = vi.fn(async () => []);
    await unpinLibraryRevision(
      { actor: ACTOR_ID, activityId: ACTIVITY_ID, libraryItemId: ITEM_ID },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        activities: makeActivities({
          byId: vi.fn(async () => pinned),
          setLibraryRefs,
        }),
      },
    );
    expect(setLibraryRefs).toHaveBeenCalled();
  });
});

describe("set-activity-library-refs", () => {
  const item: LibraryItem = {
    id: ITEM_ID,
    groupId: GROUP_ID,
    title: "x",
    description: null,
    tags: [],
    currentRevisionId: "rev_1" as never,
    uploadedBy: ACTOR_ID,
    retiredAt: null,
    retiredBy: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  };
  const retiredItem: LibraryItem = { ...item, retiredAt: TEST_NOW };
  const wrongGroupItem: LibraryItem = { ...item, groupId: "g_other" as never };

  // The current revision projects to the display kind for the
  // mime-match invariant. Audio MIME maps to display kind "audio";
  // pdf maps to "pdf". `baseActivity.parts` has no library-attached
  // Parts so any display kind passes the mime-match for the happy path.
  const pdfRevision: LibraryRevision = {
    id: "rev_1" as never,
    libraryItemId: ITEM_ID,
    revisionNumber: 1,
    storageKey: "k",
    mimeType: "application/pdf",
    sizeBytes: 1,
    originalFilename: null,
    uploadedBy: ACTOR_ID,
    uploadedAt: TEST_NOW,
  };

  it("happy path", async () => {
    const setLibraryRefs = vi.fn(async () => []);
    await setActivityLibraryRefs(
      {
        actor: ACTOR_ID,
        activityId: ACTIVITY_ID,
        refs: [{ libraryItemId: ITEM_ID, pinnedRevisionId: null }],
      },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        library: makeLibrary({
          byId: vi.fn(async () => item),
          currentRevision: vi.fn(async () => pdfRevision),
        }),
        activities: makeActivities({
          byId: vi.fn(async () => baseActivity),
          setLibraryRefs,
        }),
      },
    );
    expect(setLibraryRefs).toHaveBeenCalled();
  });

  it("rejects duplicate refs", async () => {
    await expect(
      setActivityLibraryRefs(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          refs: [
            { libraryItemId: ITEM_ID, pinnedRevisionId: null },
            { libraryItemId: ITEM_ID, pinnedRevisionId: null },
          ],
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary({ byId: vi.fn(async () => item) }),
          activities: makeActivities({ byId: vi.fn(async () => baseActivity) }),
        },
      ),
    ).rejects.toThrow(/Duplicate/);
  });

  it("rejects unknown library item", async () => {
    await expect(
      setActivityLibraryRefs(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          refs: [{ libraryItemId: "missing", pinnedRevisionId: null }],
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary({ byId: vi.fn(async () => null) }),
          activities: makeActivities({ byId: vi.fn(async () => baseActivity) }),
        },
      ),
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects ref attaching a retired item to a NEW reference", async () => {
    await expect(
      setActivityLibraryRefs(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          refs: [{ libraryItemId: ITEM_ID, pinnedRevisionId: null }],
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary({ byId: vi.fn(async () => retiredItem) }),
          activities: makeActivities({ byId: vi.fn(async () => baseActivity) }),
        },
      ),
    ).rejects.toThrow(/[Rr]etired/);
  });

  it("rejects ref pointing at a different group's item", async () => {
    await expect(
      setActivityLibraryRefs(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          refs: [{ libraryItemId: ITEM_ID, pinnedRevisionId: null }],
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary({ byId: vi.fn(async () => wrongGroupItem) }),
          activities: makeActivities({ byId: vi.fn(async () => baseActivity) }),
        },
      ),
    ).rejects.toThrow(/another group/);
  });

  it("rejects ref with pinned revision that does not belong to the item", async () => {
    await expect(
      setActivityLibraryRefs(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          refs: [{ libraryItemId: ITEM_ID, pinnedRevisionId: "rev_other" }],
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          library: makeLibrary({
            byId: vi.fn(async () => item),
            currentRevision: vi.fn(async () => pdfRevision),
            listRevisions: vi.fn(async () => []),
          }),
          activities: makeActivities({ byId: vi.fn(async () => baseActivity) }),
        },
      ),
    ).rejects.toThrow(/does not belong/);
  });
});

describe("set-activity-prerequisites / suggested-sequences", () => {
  const sibling: LearningActivity = { ...baseActivity, id: OTHER_ACTIVITY_ID, title: "B" };
  const siblingList = [sibling, baseActivity];

  it("prereqs happy path", async () => {
    const setPrerequisites = vi.fn(async () => []);
    await setActivityPrerequisites(
      {
        actor: ACTOR_ID,
        activityId: ACTIVITY_ID,
        prerequisiteActivityIds: [OTHER_ACTIVITY_ID],
      },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        activities: makeActivities({
          byId: vi.fn(async () => baseActivity),
          byTrack: vi.fn(async () =>
            siblingList.map((a) => ({
              id: a.id,
              trackId: a.trackId,
              title: a.title,
              description: null,
              partCount: 1,
              partKindSequence: ["write_reflection"],
              libraryRefCount: 0,
              prereqCount: 0,
              suggestedNextCount: 0,
              audience: { kind: "everyone_enrolled" as const },
              window: null,
              postClosePolicy: null,
              completionRuleKind: "manual_mark" as const,
              createdAt: TEST_NOW,
              updatedAt: TEST_NOW,
            })),
          ),
          listPrerequisitesFor: vi.fn(async () => []),
          setPrerequisites,
        }),
      },
    );
    expect(setPrerequisites).toHaveBeenCalled();
  });

  it("prereqs reject cross-track id", async () => {
    await expect(
      setActivityPrerequisites(
        {
          actor: ACTOR_ID,
          activityId: ACTIVITY_ID,
          prerequisiteActivityIds: ["a_other_track" as LearningActivityId],
        },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          activities: makeActivities({
            byId: vi.fn(async () => baseActivity),
            byTrack: vi.fn(async () => []),
            listPrerequisitesFor: vi.fn(async () => []),
          }),
        },
      ),
    ).rejects.toThrow(/same track/);
  });

  it("suggested-sequences happy path", async () => {
    const setSuggestedSequences = vi.fn(async () => []);
    await setActivitySuggestedSequences(
      {
        actor: ACTOR_ID,
        activityId: ACTIVITY_ID,
        nextActivityIds: [OTHER_ACTIVITY_ID],
      },
      {
        users: makeUsers(ACTOR),
        groups: baseGroups(),
        tracks: facilitatorTracks(),
        policy: basePolicy(),
        activities: makeActivities({
          byId: vi.fn(async () => baseActivity),
          byTrack: vi.fn(async () =>
            siblingList.map((a) => ({
              id: a.id,
              trackId: a.trackId,
              title: a.title,
              description: null,
              partCount: 1,
              partKindSequence: ["write_reflection"],
              libraryRefCount: 0,
              prereqCount: 0,
              suggestedNextCount: 0,
              audience: { kind: "everyone_enrolled" as const },
              window: null,
              postClosePolicy: null,
              completionRuleKind: "manual_mark" as const,
              createdAt: TEST_NOW,
              updatedAt: TEST_NOW,
            })),
          ),
          setSuggestedSequences,
        }),
      },
    );
    expect(setSuggestedSequences).toHaveBeenCalled();
  });

  it("suggested-sequences reject self-edge", async () => {
    await expect(
      setActivitySuggestedSequences(
        { actor: ACTOR_ID, activityId: ACTIVITY_ID, nextActivityIds: [ACTIVITY_ID] },
        {
          users: makeUsers(ACTOR),
          groups: baseGroups(),
          tracks: facilitatorTracks(),
          policy: basePolicy(),
          activities: makeActivities({
            byId: vi.fn(async () => baseActivity),
            byTrack: vi.fn(async () => []),
          }),
        },
      ),
    ).rejects.toThrow(/cannot suggest itself/);
  });
});
