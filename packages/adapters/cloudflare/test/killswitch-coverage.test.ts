import type {
  ActivityPartId,
  ActivityRecordId,
  AttributionPreference,
  ContributionPolicyEnvelope,
  InvitationId,
  LearningActivityDraft,
  LearningActivityId,
  LearningTrackId,
  LibraryItemId,
  LibraryRevisionId,
  StudyGroupId,
  TrackStructureEnvelope,
  UserId,
} from "@hearth/domain";
import type {
  ActivityRecordRepository,
  LearningActivityRepository,
  LibraryItemRepository,
  SystemFlagRepository,
  WriteMethods,
} from "@hearth/ports";
import { describe, expect, it } from "vitest";
import type { CloudflareAdapterDeps } from "../src/deps.ts";
import {
  createActivityRecordRepository,
  createInstanceAccessPolicyRepository,
  createInstanceSettingsRepository,
  createKillswitchGate,
  createLearningActivityRepository,
  createLearningTrackRepository,
  createLibraryItemRepository,
  createObjectStorage,
  createPendingUploadsSweep,
  createStudyGroupRepository,
  createUploadCoordinationRepository,
  createUserRepository,
  KillswitchBlocked,
} from "../src/index.ts";

/**
 * CI-enforced resilience invariant: every D1 + R2 adapter write method must
 * call `gate.assertWritable()` before touching storage. The test drives each
 * known write method through a gate that throws KillswitchBlocked — if a
 * method skips the check, it instead hits a DB/storage mock whose failure
 * mode is distinguishable from KillswitchBlocked.
 *
 * When adding a new adapter write method, extend the CASES array below.
 * The test guards the $0-guaranteed deployment: if a write method forgets
 * the gate, the killswitch cannot stop runaway writes on the free tier.
 * Do not weaken or skip this test.
 */

type Db = CloudflareAdapterDeps["db"];
type Storage = CloudflareAdapterDeps["storage"];

function hostileDb(): Db {
  // Any db operation called before the gate check fails — we use a throwing
  // Proxy so a test failure (method call reaching the DB) surfaces loudly.
  return new Proxy({} as Db, {
    get() {
      throw new Error("db was accessed before killswitch gate");
    },
  });
}

function hostileStorage(): Storage {
  return new Proxy({} as Storage, {
    get() {
      throw new Error("R2 was accessed before killswitch gate");
    },
  });
}

function readOnlyFlags(): SystemFlagRepository {
  return {
    async get() {
      return "read_only";
    },
    async set() {
      throw new Error("unused");
    },
    async list() {
      return [];
    },
  };
}

const uid = "u_test" as UserId;
const attrib: AttributionPreference = "preserve_name";

describe("killswitch coverage (resilience invariant 2 + 3)", () => {
  const db = hostileDb();
  const storage = hostileStorage();
  const gate = createKillswitchGate(readOnlyFlags());
  const users = createUserRepository({ db, gate });
  const policy = createInstanceAccessPolicyRepository({ db, gate });
  const settings = createInstanceSettingsRepository({ db, gate });
  const groups = createStudyGroupRepository({ db, gate });
  const tracks = createLearningTrackRepository({ db, gate });
  const library = createLibraryItemRepository({ db, gate });
  const activities = createLearningActivityRepository({ db, gate });
  const records = createActivityRecordRepository({ db, gate });
  const uploads = createUploadCoordinationRepository({ db, gate });
  const sweep = createPendingUploadsSweep({ db, storage, gate });
  const object = createObjectStorage(storage, gate, {
    endpoint: "https://example.r2.cloudflarestorage.com",
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "hearth-storage",
    maxExpirySeconds: 900,
  });

  const gid = "g_test" as Parameters<typeof groups.byId>[0];

  const CASES = [
    ["UserRepository.deactivate", () => users.deactivate(uid, uid)],
    ["UserRepository.reactivate", () => users.reactivate(uid)],
    ["UserRepository.setAttributionPreference", () => users.setAttributionPreference(uid, attrib)],

    ["InstanceAccessPolicyRepository.addApprovedEmail", () => policy.addApprovedEmail("x@y", uid)],
    [
      "InstanceAccessPolicyRepository.removeApprovedEmail",
      () => policy.removeApprovedEmail("x@y", uid),
    ],
    ["InstanceAccessPolicyRepository.addOperator", () => policy.addOperator(uid, uid)],
    ["InstanceAccessPolicyRepository.revokeOperator", () => policy.revokeOperator(uid, uid)],

    ["InstanceSettingsRepository.update", () => settings.update({ name: "x" }, uid)],

    ["StudyGroupRepository.create", () => groups.create({ name: "g", createdBy: uid })],
    ["StudyGroupRepository.updateStatus", () => groups.updateStatus(gid, "archived", uid)],
    ["StudyGroupRepository.updateMetadata", () => groups.updateMetadata(gid, { name: "x" }, uid)],
    [
      "StudyGroupRepository.addMembership",
      () => groups.addMembership({ groupId: gid, userId: uid, role: "participant", by: uid }),
    ],
    [
      "StudyGroupRepository.removeMembership",
      () =>
        groups.removeMembership({
          groupId: gid,
          userId: uid,
          by: uid,
          attribution: attrib,
          displayNameSnapshot: "name",
        }),
    ],
    [
      "StudyGroupRepository.setMembershipRole",
      () => groups.setMembershipRole({ groupId: gid, userId: uid, role: "admin", by: uid }),
    ],
    [
      "StudyGroupRepository.updateProfile",
      () => groups.updateProfile({ groupId: gid, userId: uid, patch: { nickname: "n" } }),
    ],
    [
      "StudyGroupRepository.createInvitation",
      () =>
        groups.createInvitation({
          groupId: gid,
          trackId: null,
          token: "tok",
          email: null,
          createdBy: uid,
          expiresAt: new Date(),
        }),
    ],
    [
      "StudyGroupRepository.revokeInvitation",
      () => groups.revokeInvitation({ id: "iid" as InvitationId, by: uid, now: new Date() }),
    ],
    [
      "StudyGroupRepository.consumeInvitation",
      () =>
        groups.consumeInvitation({
          invitationId: "iid" as InvitationId,
          userId: uid,
          now: new Date(),
        }),
    ],

    [
      "UploadCoordinationRepository.createPending",
      () =>
        uploads.createPending({
          id: "u_test",
          uploaderUserId: uid,
          groupId: gid as StudyGroupId,
          context: "avatar",
          storageKey: "avatars/u_test/g_test/k",
          declaredSizeBytes: 1,
          declaredMimeType: "image/png",
          originalFilename: null,
          createdAt: new Date(),
          expiresAt: new Date(),
        }),
    ],
    ["UploadCoordinationRepository.deletePending", () => uploads.deletePending("u_test")],

    ["ObjectStorage.putUpload", () => object.putUpload("k", new Blob([]).stream(), undefined)],
    ["ObjectStorage.delete", () => object.delete("k")],

    [
      "LearningTrackRepository.create",
      () =>
        tracks.create({
          groupId: gid as StudyGroupId,
          name: "T",
          description: null,
          createdBy: uid,
        }),
    ],
    [
      "LearningTrackRepository.updateStatus",
      () =>
        tracks.updateStatus({
          id: "t_test" as LearningTrackId,
          to: "paused",
          expectedFromStatus: "active",
          by: uid,
        }),
    ],
    [
      "LearningTrackRepository.updateMetadata",
      () => tracks.updateMetadata("t_test" as LearningTrackId, { name: "T" }, uid),
    ],
    [
      "LearningTrackRepository.saveStructure",
      () =>
        tracks.saveStructure(
          "t_test" as LearningTrackId,
          { v: 1, data: { mode: "free" } } satisfies TrackStructureEnvelope,
          uid,
        ),
    ],
    [
      "LearningTrackRepository.saveContributionPolicy",
      () =>
        tracks.saveContributionPolicy(
          "t_test" as LearningTrackId,
          { v: 1, data: { mode: "direct" } } satisfies ContributionPolicyEnvelope,
          uid,
        ),
    ],
    [
      "LearningTrackRepository.endAllEnrollmentsForUser",
      () => tracks.endAllEnrollmentsForUser({ groupId: gid, userId: uid, by: uid }),
    ],
    [
      "LearningTrackRepository.enroll",
      () => tracks.enroll({ trackId: "t_test" as LearningTrackId, userId: uid, by: uid }),
    ],
    [
      "LearningTrackRepository.unenroll",
      () => tracks.unenroll({ trackId: "t_test" as LearningTrackId, userId: uid, by: uid }),
    ],
    [
      "LearningTrackRepository.setEnrollmentRole",
      () =>
        tracks.setEnrollmentRole({
          trackId: "t_test" as LearningTrackId,
          userId: uid,
          role: "facilitator",
          by: uid,
        }),
    ],

    [
      "LibraryItemRepository.create",
      () =>
        library.create({
          id: "li_test" as LibraryItemId,
          groupId: gid as StudyGroupId,
          title: "T",
          description: null,
          tags: [],
          uploadedBy: uid,
          firstRevision: {
            id: "lr_test" as LibraryRevisionId,
            storageKey: "library/g_test/li_test/lr_test",
            mimeType: "application/pdf",
            sizeBytes: 1,
            originalFilename: null,
            uploadedBy: uid,
            uploadedAt: new Date(),
          },
          now: new Date(),
        }),
    ],
    [
      "LibraryItemRepository.updateMetadata",
      () => library.updateMetadata("li_test" as LibraryItemId, { title: "T2" }),
    ],
    [
      "LibraryItemRepository.markRetired",
      () => library.markRetired("li_test" as LibraryItemId, uid, new Date()),
    ],
    [
      "LibraryItemRepository.addRevision",
      () =>
        library.addRevision({
          libraryItemId: "li_test" as LibraryItemId,
          revision: {
            id: "lr_test2" as LibraryRevisionId,
            storageKey: "library/g_test/li_test/lr_test2",
            mimeType: "application/pdf",
            sizeBytes: 1,
            originalFilename: null,
            uploadedBy: uid,
            uploadedAt: new Date(),
          },
        }),
    ],
    [
      "LibraryItemRepository.addSteward",
      () =>
        library.addSteward({
          libraryItemId: "li_test" as LibraryItemId,
          userId: uid,
          grantedBy: uid,
          grantedAt: new Date(),
        }),
    ],
    [
      "LibraryItemRepository.removeSteward",
      () =>
        library.removeSteward({
          libraryItemId: "li_test" as LibraryItemId,
          userId: uid,
        }),
    ],
    ["LibraryItemRepository.restoreFtsIndex", () => library.restoreFtsIndex()],

    [
      "LearningActivityRepository.create",
      () =>
        activities.create({
          draft: {
            trackId: "t_test" as LearningTrackId,
            title: "x",
            description: null,
            parts: [],
            flow: { prereqs: [] },
            audience: { kind: "everyone_enrolled" },
            window: null,
            postClosePolicy: null,
            completionRule: { kind: "manual_mark" },
            libraryRefs: [],
            prerequisiteActivityIds: [],
            suggestedNextActivityIds: [],
          } satisfies LearningActivityDraft,
          createdBy: uid,
        }),
    ],
    [
      "LearningActivityRepository.update",
      () =>
        activities.update({
          id: "a_test" as LearningActivityId,
          patch: { title: "y" },
          by: uid,
        }),
    ],
    [
      "LearningActivityRepository.delete",
      () => activities.delete({ id: "a_test" as LearningActivityId, by: uid }),
    ],
    [
      "LearningActivityRepository.setLibraryRefs",
      () =>
        activities.setLibraryRefs({
          activityId: "a_test" as LearningActivityId,
          refs: [],
        }),
    ],
    [
      "LearningActivityRepository.setPrerequisites",
      () =>
        activities.setPrerequisites({
          activityId: "a_test" as LearningActivityId,
          prerequisiteActivityIds: [],
        }),
    ],
    [
      "LearningActivityRepository.setSuggestedSequences",
      () =>
        activities.setSuggestedSequences({
          activityId: "a_test" as LearningActivityId,
          nextActivityIds: [],
        }),
    ],

    [
      "ActivityRecordRepository.upsert",
      () => records.upsert({ activityId: "a_test" as LearningActivityId, participantId: uid }),
    ],
    [
      "ActivityRecordRepository.savePartProgress",
      () =>
        records.savePartProgress({
          activityRecordId: "ar_test" as ActivityRecordId,
          partId: "p_test" as ActivityPartId,
          state: { kind: "write_reflection", completed: false, text: "" },
        }),
    ],
    [
      "ActivityRecordRepository.setPartCompletion",
      () =>
        records.setPartCompletion({
          activityRecordId: "ar_test" as ActivityRecordId,
          partId: "p_test" as ActivityPartId,
          completed: true,
          initialState: { kind: "write_reflection", completed: false, text: "" },
        }),
    ],
    [
      "ActivityRecordRepository.setCompletion",
      () =>
        records.setCompletion({
          id: "ar_test" as ActivityRecordId,
          state: "completed",
          at: new Date(),
        }),
    ],
    [
      "ActivityRecordRepository.appendPartHistory",
      () =>
        records.appendPartHistory({
          activityRecordId: "ar_test" as ActivityRecordId,
          partId: "p_test" as ActivityPartId,
          snapshot: { kind: "write_reflection", completed: false, text: "" },
          reason: "retry",
        }),
    ],
    [
      "ActivityRecordRepository.reopenAgainstRevision",
      () =>
        records.reopenAgainstRevision({
          recordId: "ar_test" as ActivityRecordId,
          newRevisionId: "lr_test" as LibraryRevisionId,
          affectedPartIds: ["p_test" as ActivityPartId],
          reason: "revision_bump",
        }),
    ],
    [
      "ActivityRecordRepository.flushEvidenceSignals",
      () =>
        records.flushEvidenceSignals([
          {
            activityId: "a_test" as LearningActivityId,
            participantId: uid,
            partId: "p_test" as ActivityPartId,
            signalType: "word_count",
            value: 1,
          },
        ]),
    ],

    // The hourly cron-driven sweep is not a *port* method, but it
    // calls `gate.assertWritable()` on entry and is the only path
    // through which the killswitch can stop the cron from mutating
    // R2 + D1. Treat it as a write method for invariant 2 + 3.
    ["PendingUploadsSweep", () => sweep(new Date())],
  ] as const;

  for (const [label, run] of CASES) {
    it(`${label} calls gate.assertWritable before touching storage`, async () => {
      await expect(run()).rejects.toBeInstanceOf(KillswitchBlocked);
    });
  }

  // Type-level exhaustiveness for every port that has adopted the
  // `Write<>` brand. `BrandedPorts` is the single registry — one entry
  // per branded port, keyed by its CASES label-prefix. `ExpectedLabel`
  // expands each entry to `${prefix}.${branded method}`; `Missing` is
  // whatever the registry expects but CASES omits. When a new branded
  // write method lands on any registered port without a CASES entry,
  // `Missing` becomes non-`never`, so the `satisfies` target collapses
  // to the `MISSING from CASES: …` template and `"ok"` no longer
  // satisfies it — `tsc` fails naming the missing label. The runtime
  // `expect` is incidental; the compile-time `satisfies` is the gate.
  //
  // To cover another port: brand its mutating methods with `Write<>` in
  // the port file and add ONE registry entry below. `SystemFlagRepository`
  // is deliberately absent — its `set` is an intentional non-gated write
  // (the killswitch persists its own mode through it), so it stays
  // un-branded and out of this registry. See `docs/tripwires.md`.
  type CaseLabels = (typeof CASES)[number][0];

  type BrandedPorts = {
    LibraryItemRepository: LibraryItemRepository;
    LearningActivityRepository: LearningActivityRepository;
    ActivityRecordRepository: ActivityRecordRepository;
  };
  type ExpectedLabel = {
    [P in keyof BrandedPorts & string]: `${P}.${WriteMethods<BrandedPorts[P]> & string}`;
  }[keyof BrandedPorts & string];
  type Missing = Exclude<ExpectedLabel, CaseLabels>;

  it("every branded write method on a registered port is in CASES", () => {
    const check = "ok" satisfies [Missing] extends [never]
      ? "ok"
      : `MISSING from CASES: ${Missing}`;
    expect(check).toBe("ok");
  });
});
