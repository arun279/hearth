import type {
  GroupMembership,
  LibraryItem,
  LibraryItemId,
  LibraryRevision,
  LibraryRevisionId,
  StudyGroup,
  StudyGroupId,
  User,
  UserId,
} from "@hearth/domain";
import type {
  IdGenerator,
  InstanceAccessPolicyRepository,
  KillswitchGate,
  LearningTrackRepository,
  LibraryItemDetail,
  LibraryItemRepository,
  ObjectStorage,
  StudyGroupRepository,
  SystemFlagRepository,
  UploadCoordinationRepository,
  UserRepository,
} from "@hearth/ports";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppBindings } from "../src/bindings.ts";
import { createApiRouter } from "../src/index.ts";

type Ports = AppBindings["Variables"]["ports"];

function throwingProxy<T extends object>(label: string): T {
  return new Proxy({} as T, {
    get(_, key) {
      if (typeof key === "symbol") return undefined;
      return () => {
        throw new Error(`unexpected call: ${label}.${String(key)}`);
      };
    },
  });
}

function buildPorts(overrides: Partial<Ports>): Ports {
  return {
    policy: throwingProxy<InstanceAccessPolicyRepository>("policy"),
    settings: throwingProxy<Ports["settings"]>("settings"),
    users: throwingProxy<UserRepository>("users"),
    groups: throwingProxy<StudyGroupRepository>("groups"),
    tracks: throwingProxy<LearningTrackRepository>("tracks"),
    libraryItems: throwingProxy<LibraryItemRepository>("libraryItems"),
    activities: throwingProxy<Ports["activities"]>("activities"),
    records: throwingProxy<Ports["records"]>("records"),
    sessions: throwingProxy<Ports["sessions"]>("sessions"),
    storage: throwingProxy<ObjectStorage>("storage"),
    uploads: throwingProxy<UploadCoordinationRepository>("uploads"),
    flags: throwingProxy<SystemFlagRepository>("flags"),
    clock: { now: () => new Date("2026-04-22T00:00:00.000Z") },
    ids: { generate: () => "id_test" } as IdGenerator,
    ...overrides,
  };
}

function harness(opts: { userId: string | null; ports: Partial<Ports> }) {
  const gate: KillswitchGate = {
    getMode: async () => "normal",
    assertWritable: async () => {},
    invalidate: () => {},
  };
  const app = new Hono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("userId", opts.userId);
    c.set("auth", { handler: async () => new Response(null) });
    c.set("gate", gate);
    c.set("adminToken", "a".repeat(64));
    c.set("writeLimiter", { limit: async () => ({ success: true }) });
    c.set("authLimiter", { limit: async () => ({ success: true }) });
    c.set("config", { r2PublicOrigin: "https://r2.example.com" });
    c.set("ports", buildPorts(opts.ports));
    await next();
  });
  app.route("/api/v1", createApiRouter());
  return app;
}

const now = new Date("2026-04-22T00:00:00.000Z");
const actorId = "u_actor" as UserId;
const otherId = "u_other" as UserId;
const gid = "g_1" as StudyGroupId;
const itemId = "li_1" as LibraryItemId;
const revisionId = "lr_1" as LibraryRevisionId;

const actor: User = {
  id: actorId,
  email: "actor@example.com",
  name: "Actor",
  image: null,
  deactivatedAt: null,
  deletedAt: null,
  attributionPreference: "preserve_name",
  createdAt: now,
  updatedAt: now,
};

const group: StudyGroup = {
  id: gid,
  name: "G",
  description: null,
  admissionPolicy: "invite_only",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
};

const baseMembership = (overrides: Partial<GroupMembership> = {}): GroupMembership => ({
  groupId: gid,
  userId: actorId,
  role: "participant",
  joinedAt: now,
  removedAt: null,
  removedBy: null,
  attributionOnLeave: null,
  displayNameSnapshot: null,
  profile: { nickname: null, avatarUrl: null, bio: null, updatedAt: null },
  ...overrides,
});

const livingItem: LibraryItem = {
  id: itemId,
  groupId: gid,
  title: "Primer",
  description: null,
  tags: [],
  currentRevisionId: revisionId,
  uploadedBy: actorId,
  retiredAt: null,
  retiredBy: null,
  createdAt: now,
  updatedAt: now,
};

const revision: LibraryRevision = {
  id: revisionId,
  libraryItemId: itemId,
  revisionNumber: 1,
  storageKey: `library/${gid}/${itemId}/${revisionId}`,
  mimeType: "application/pdf",
  sizeBytes: 1000,
  originalFilename: "primer.pdf",
  uploadedBy: actorId,
  uploadedAt: now,
};

const detail: LibraryItemDetail = {
  item: livingItem,
  revisions: [revision],
  stewards: [],
  usedInCount: 0,
};

function makeGroupsPort(): StudyGroupRepository {
  return {
    create: vi.fn(),
    byId: vi.fn(async () => group),
    list: vi.fn(async () => []),
    listForUser: vi.fn(async () => [group]),
    updateStatus: vi.fn(),
    updateMetadata: vi.fn(async () => group),
    membership: vi.fn(async () => baseMembership()),
    membershipsForUser: vi.fn(async () => [baseMembership()]),
    listMemberships: vi.fn(async () => [baseMembership()]),
    listAdmins: vi.fn(async () => [baseMembership({ role: "admin" })]),
    countAdmins: vi.fn(async () => 2),
    addMembership: vi.fn(),
    removeMembership: vi.fn(),
    setMembershipRole: vi.fn(),
    updateProfile: vi.fn(async () => baseMembership()),
    createInvitation: vi.fn(),
    invitationByToken: vi.fn(),
    invitationById: vi.fn(),
    listPendingInvitations: vi.fn(async () => []),
    revokeInvitation: vi.fn(),
    consumeInvitation: vi.fn(),
    counts: vi.fn(async () => ({ memberCount: 1, trackCount: 0, libraryItemCount: 0 })),
  };
}

function makeUsersPort(): UserRepository {
  return {
    byId: vi.fn(async (id: UserId): Promise<User | null> => (id === actorId ? actor : null)),
    byEmail: vi.fn(async () => null),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
  };
}

function makePolicyPort(): InstanceAccessPolicyRepository {
  return {
    isEmailApproved: vi.fn(async () => true),
    listApprovedEmails: vi.fn(),
    addApprovedEmail: vi.fn(),
    removeApprovedEmail: vi.fn(),
    getApprovedEmail: vi.fn(),
    getOperator: vi.fn(async () => null),
    isOperator: vi.fn(async () => false),
    listOperators: vi.fn(),
    addOperator: vi.fn(),
    revokeOperator: vi.fn(),
    countActiveOperators: vi.fn(async () => 1),
    bootstrapIfNeeded: vi.fn(),
  } as InstanceAccessPolicyRepository;
}

function makeLibraryPort(overrides: Partial<LibraryItemRepository> = {}): LibraryItemRepository {
  return {
    create: vi.fn(),
    byId: vi.fn(async () => livingItem),
    detail: vi.fn(async () => detail),
    byGroup: vi.fn(async () => [
      { item: livingItem, currentRevision: revision, stewardCount: 0, usedInCount: 0 },
    ]),
    updateMetadata: vi.fn(async () => livingItem),
    markRetired: vi.fn(async () => ({ ...livingItem, retiredAt: now, retiredBy: actorId })),
    addRevision: vi.fn(),
    listRevisions: vi.fn(async () => [revision]),
    currentRevision: vi.fn(async () => revision),
    revisionById: vi.fn(async () => revision),
    addSteward: vi.fn(),
    removeSteward: vi.fn(),
    listStewards: vi.fn(async () => []),
    isSteward: vi.fn(async () => false),
    usedInCount: vi.fn(async () => 0),
    ...overrides,
  } as LibraryItemRepository;
}

function makeStoragePort(overrides: Partial<ObjectStorage> = {}): ObjectStorage {
  return {
    putUpload: vi.fn(),
    putUploadPresigned: vi.fn(async () => ({
      url: "https://r2.example.com/library/g/li/lr?sig",
      requiredHeaders: { "Content-Type": "application/pdf" },
    })),
    getDownloadUrl: vi.fn(async () => "https://r2.example.com/library/g/li/lr?signed-get"),
    headObject: vi.fn(async () => ({ size: 1000, uploadedAt: now })),
    delete: vi.fn(),
    usedBytes: vi.fn(async () => 0),
    ...overrides,
  };
}

function makeUploadsPort(
  overrides: Partial<UploadCoordinationRepository> = {},
): UploadCoordinationRepository {
  return {
    createPending: vi.fn(),
    getPending: vi.fn(),
    deletePending: vi.fn(),
    ...overrides,
  };
}

describe("GET /api/v1/g/:groupId/library", () => {
  it("returns the byGroup payload + canUpload cap", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/library`, {
      method: "GET",
      headers: { cookie: "session=stub" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[]; caps: { canUpload: boolean } };
    expect(body.entries).toHaveLength(1);
    expect(body.caps.canUpload).toBe(true);
  });
});

describe("POST /api/v1/g/:groupId/library/upload-request", () => {
  it("mints a presigned URL and persists a pending row", async () => {
    const createPending = vi.fn();
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
        storage: makeStoragePort(),
        uploads: makeUploadsPort({ createPending }),
        ids: {
          generate: vi
            .fn()
            .mockReturnValueOnce("itemcuid")
            .mockReturnValueOnce("revcuid")
            .mockReturnValueOnce("uploadcuid"),
        } as IdGenerator,
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/library/upload-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({
        mimeType: "application/pdf",
        sizeBytes: 5000,
        originalFilename: "primer.pdf",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      uploadId: string;
      libraryItemId: string;
      revisionId: string;
      key: string;
      upload: { url: string };
      byteQuotaRemaining: number;
    };
    expect(body.libraryItemId).toBe("itemcuid");
    expect(body.revisionId).toBe("revcuid");
    expect(body.key).toBe(`library/${gid}/itemcuid/revcuid`);
    expect(body.upload.url).toMatch(/^https:\/\//);
    expect(createPending).toHaveBeenCalled();
  });

  it("uploads a new revision against an existing item", async () => {
    const presign = vi.fn(async () => ({
      url: "https://r2.example.com/library/g/li/lr?sig",
      requiredHeaders: { "Content-Type": "application/pdf" },
    }));
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
        storage: makeStoragePort({ putUploadPresigned: presign }),
        uploads: makeUploadsPort(),
        ids: {
          generate: vi.fn().mockReturnValueOnce("revcuid").mockReturnValueOnce("uploadcuid"),
        } as IdGenerator,
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/library/upload-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({
        mimeType: "application/pdf",
        sizeBytes: 1000,
        libraryItemId: itemId,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { libraryItemId: string };
    expect(body.libraryItemId).toBe(itemId);
    expect(presign).toHaveBeenCalled();
  });

  it("propagates upstream domain errors", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: {
          ...makeGroupsPort(),
          membership: vi.fn(async () => null),
        } as StudyGroupRepository,
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
        storage: makeStoragePort(),
        uploads: makeUploadsPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/library/upload-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({ mimeType: "application/pdf", sizeBytes: 1000 }),
    });
    expect(res.status).toBe(404);
  });

  it("400s on disallowed MIME type at the boundary", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
        storage: makeStoragePort(),
        uploads: makeUploadsPort(),
      },
    });
    const res = await app.request(`/api/v1/g/${gid}/library/upload-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({ mimeType: "application/x-msdownload", sizeBytes: 1000 }),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toContain("application/problem+json");
  });
});

describe("GET /api/v1/library/:itemId", () => {
  it("returns detail + caps", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}`, {
      method: "GET",
      headers: { cookie: "session=stub" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { displayKind: string; caps: { canRetire: boolean } };
    expect(body.displayKind).toBe("pdf");
    expect(body.caps.canRetire).toBe(true);
  });

  it("404s when the actor isn't a group member (existence not leaked)", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: {
          ...makeGroupsPort(),
          membership: vi.fn(async () => null),
        } as StudyGroupRepository,
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}`, {
      method: "GET",
      headers: { cookie: "session=stub" },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/library/finalize — variants", () => {
  it("accepts a body with description omitted", async () => {
    const create = vi.fn(async () => detail);
    const app = harness({
      userId: actorId,
      ports: {
        libraryItems: makeLibraryPort({ byId: vi.fn(async () => null), create }),
        storage: makeStoragePort(),
        uploads: makeUploadsPort({
          getPending: vi.fn(async () => ({
            id: "u_2",
            uploaderUserId: actorId,
            groupId: gid,
            context: "library" as const,
            storageKey: `library/${gid}/${itemId}/${revisionId}`,
            declaredSizeBytes: 1000,
            declaredMimeType: "application/pdf",
            createdAt: now,
            expiresAt: new Date(now.getTime() + 900_000),
          })),
          deletePending: vi.fn(),
        }),
      },
    });
    const res = await app.request("/api/v1/library/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({ uploadId: "u_2", groupId: gid, title: "Primer" }),
    });
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalled();
  });
});

describe("POST /api/v1/library/finalize", () => {
  it("returns the materialized detail on success", async () => {
    const create = vi.fn(async () => detail);
    const deletePending = vi.fn();
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort({ byId: vi.fn(async () => null), create }),
        storage: makeStoragePort(),
        uploads: makeUploadsPort({
          getPending: vi.fn(async () => ({
            id: "u_1",
            uploaderUserId: actorId,
            groupId: gid,
            context: "library" as const,
            storageKey: `library/${gid}/${itemId}/${revisionId}`,
            declaredSizeBytes: 1000,
            declaredMimeType: "application/pdf",
            createdAt: now,
            expiresAt: new Date(now.getTime() + 900_000),
          })),
          deletePending,
        }),
      },
    });
    const res = await app.request(`/api/v1/library/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({
        uploadId: "u_1",
        groupId: gid,
        title: "Primer",
        description: null,
        tags: ["spanish"],
      }),
    });
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalled();
    expect(deletePending).toHaveBeenCalledWith("u_1");
  });
});

describe("POST /api/v1/library/:itemId/retire", () => {
  it("retires a living item and returns the updated row", async () => {
    const markRetired = vi.fn(async () => ({
      ...livingItem,
      retiredAt: now,
      retiredBy: actorId,
    }));
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort({ markRetired }),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/retire`, {
      method: "POST",
      headers: { cookie: "session=stub" },
    });
    expect(res.status).toBe(200);
    expect(markRetired).toHaveBeenCalled();
  });
});

describe("GET /api/v1/library/:itemId/download — error paths", () => {
  it("404s when the item has no current revision", async () => {
    const detached = {
      ...detail,
      item: { ...livingItem, currentRevisionId: null },
      revisions: [],
    };
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort({
          byId: vi.fn(async () => ({ ...livingItem, currentRevisionId: null })),
          detail: vi.fn(async () => detached),
        }),
        storage: makeStoragePort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/download`, {
      method: "GET",
      headers: { cookie: "session=stub" },
      redirect: "manual",
    });
    expect(res.status).toBe(404);
  });

  it("falls back to title-based filename when originalFilename is null", async () => {
    const noFilename = {
      ...detail,
      revisions: [{ ...revision, originalFilename: null }],
    };
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort({ detail: vi.fn(async () => noFilename) }),
        storage: makeStoragePort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/download`, {
      method: "GET",
      headers: { cookie: "session=stub" },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
  });
});

describe("GET /api/v1/library/:itemId/download", () => {
  it("redirects to a signed URL for the current revision", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
        storage: makeStoragePort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/download`, {
      method: "GET",
      headers: { cookie: "session=stub" },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("signed-get");
  });
});

describe("POST /api/v1/library/finalize — error paths", () => {
  it("propagates pending_upload_not_found (404)", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        libraryItems: makeLibraryPort(),
        storage: makeStoragePort(),
        uploads: makeUploadsPort({ getPending: vi.fn(async () => null) }),
      },
    });
    const res = await app.request("/api/v1/library/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({
        uploadId: "u_missing",
        groupId: gid,
        title: "Primer",
        description: null,
        tags: [],
      }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/library/finalize", () => {
  it("400s on missing required fields", async () => {
    const app = harness({
      userId: actorId,
      ports: { libraryItems: makeLibraryPort(), storage: makeStoragePort() },
    });
    const res = await app.request("/api/v1/library/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/library/:itemId/retire — error paths", () => {
  it("propagates upstream NOT_FOUND as 404", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: {
          ...makeGroupsPort(),
          membership: vi.fn(async () => null),
        } as StudyGroupRepository,
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/retire`, {
      method: "POST",
      headers: { cookie: "session=stub" },
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/library/:itemId/stewards/:userId — error paths", () => {
  it("rejects removing the implicit-uploader steward (422)", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/stewards/${actorId}`, {
      method: "DELETE",
      headers: { cookie: "session=stub" },
    });
    expect(res.status).toBe(422);
  });
});

describe("PATCH /api/v1/library/:itemId", () => {
  it("returns the updated row on metadata edit", async () => {
    const updateMetadata = vi.fn(async () => ({ ...livingItem, title: "Updated" }));
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort({ updateMetadata }),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(200);
    expect(updateMetadata).toHaveBeenCalledWith(
      itemId,
      expect.objectContaining({ title: "Updated" }),
    );
  });

  it("400s on empty body", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("forwards description + tags (covers each optional spread branch)", async () => {
    const updateMetadata = vi.fn(async () => livingItem);
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort({ updateMetadata }),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({ description: "New", tags: ["spanish"] }),
    });
    expect(res.status).toBe(200);
    expect(updateMetadata).toHaveBeenCalledWith(
      itemId,
      expect.objectContaining({ description: "New", tags: ["spanish"] }),
    );
  });
});

describe("GET /api/v1/library/:itemId/revisions/:revisionId/download", () => {
  it("redirects to a signed URL for a specific revision", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
        storage: makeStoragePort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/revisions/${revisionId}/download`, {
      method: "GET",
      headers: { cookie: "session=stub" },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("signed-get");
  });

  it("404s on unknown revision id", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
        storage: makeStoragePort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/revisions/lr_nonexistent/download`, {
      method: "GET",
      headers: { cookie: "session=stub" },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/library/:itemId/stewards", () => {
  it("returns 201 when promoting a non-uploader to steward", async () => {
    const stewardship = {
      id: "s_1",
      libraryItemId: itemId,
      userId: otherId,
      grantedAt: now,
      grantedBy: actorId,
    };
    const addSteward = vi.fn(async () => stewardship);
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort({ addSteward }),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/stewards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({ userId: otherId }),
    });
    expect(res.status).toBe(201);
    expect(addSteward).toHaveBeenCalled();
  });

  it("returns 200 created:false when promoting the implicit-uploader steward", async () => {
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort(),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/stewards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: "session=stub" },
      body: JSON.stringify({ userId: actorId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean };
    expect(body.created).toBe(false);
  });
});

describe("DELETE /api/v1/library/:itemId/stewards/:userId", () => {
  it("returns 204 when removing a non-uploader steward", async () => {
    const removeSteward = vi.fn();
    const app = harness({
      userId: actorId,
      ports: {
        users: makeUsersPort(),
        groups: makeGroupsPort(),
        policy: makePolicyPort(),
        libraryItems: makeLibraryPort({ removeSteward }),
      },
    });
    const res = await app.request(`/api/v1/library/${itemId}/stewards/${otherId}`, {
      method: "DELETE",
      headers: { cookie: "session=stub" },
    });
    expect(res.status).toBe(204);
    expect(removeSteward).toHaveBeenCalled();
  });
});
