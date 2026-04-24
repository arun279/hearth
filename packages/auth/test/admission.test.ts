import type { User, UserId } from "@hearth/domain";
import { DomainError } from "@hearth/domain";
import type { InstanceAccessPolicyRepository, UserRepository } from "@hearth/ports";
import { describe, expect, it, vi } from "vitest";
import { admissionCheck, canonicalizeEmail } from "../src/admission.ts";
import { createSessionGuard } from "../src/session-guard.ts";

function makePolicy(
  overrides: Partial<InstanceAccessPolicyRepository> = {},
): InstanceAccessPolicyRepository {
  return {
    isEmailApproved: vi.fn(async () => false),
    listApprovedEmails: vi.fn(async () => ({ entries: [], nextCursor: null })),
    addApprovedEmail: vi.fn(),
    removeApprovedEmail: vi.fn(),
    getApprovedEmail: vi.fn(async () => null),
    getOperator: vi.fn(async () => null),
    isOperator: vi.fn(async () => false),
    listOperators: vi.fn(async () => []),
    addOperator: vi.fn(),
    revokeOperator: vi.fn(),
    countActiveOperators: vi.fn(async () => 0),
    bootstrapIfNeeded: vi.fn(async () => ({ kind: "not_eligible" })),
    ...overrides,
  } as InstanceAccessPolicyRepository;
}

const BOOTSTRAP = "operator@example.com";

describe("canonicalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(canonicalizeEmail("  Alice@Example.COM  ")).toBe("alice@example.com");
  });
});

describe("admissionCheck", () => {
  it("allows when email is on approved list", async () => {
    const policy = makePolicy({ isEmailApproved: vi.fn(async () => true) });
    await expect(admissionCheck(policy, "approved@x.com", BOOTSTRAP)).resolves.toBeUndefined();
    expect(policy.countActiveOperators).not.toHaveBeenCalled();
  });

  it("rejects when email is not approved and not the bootstrap email", async () => {
    const policy = makePolicy();
    await expect(admissionCheck(policy, "stranger@x.com", BOOTSTRAP)).rejects.toMatchObject({
      code: "FORBIDDEN",
      reason: "email_not_approved",
    });
  });

  it("allows the bootstrap email when there are zero active operators", async () => {
    const policy = makePolicy({
      isEmailApproved: vi.fn(async () => false),
      countActiveOperators: vi.fn(async () => 0),
    });
    await expect(admissionCheck(policy, BOOTSTRAP, BOOTSTRAP)).resolves.toBeUndefined();
    expect(policy.countActiveOperators).toHaveBeenCalledOnce();
  });

  it("rejects the bootstrap email once operators already exist (bootstrap window closed)", async () => {
    const policy = makePolicy({
      isEmailApproved: vi.fn(async () => false),
      countActiveOperators: vi.fn(async () => 1),
    });
    await expect(admissionCheck(policy, BOOTSTRAP, BOOTSTRAP)).rejects.toBeInstanceOf(DomainError);
  });

  it("canonicalizes the bootstrap comparison (casing + whitespace)", async () => {
    const policy = makePolicy({
      isEmailApproved: vi.fn(async () => false),
      countActiveOperators: vi.fn(async () => 0),
    });
    await expect(
      admissionCheck(policy, "  Operator@Example.COM ", BOOTSTRAP),
    ).resolves.toBeUndefined();
  });

  it("treats an empty bootstrap config as 'no bootstrap-bypass'", async () => {
    const policy = makePolicy({
      isEmailApproved: vi.fn(async () => false),
      countActiveOperators: vi.fn(async () => 0),
    });
    await expect(admissionCheck(policy, "", "")).rejects.toBeInstanceOf(DomainError);
  });
});

const uid = "u_1" as UserId;
const now = new Date("2026-04-22T00:00:00.000Z");

function userRow(over: Partial<User> = {}): User {
  return {
    id: uid,
    email: "user@example.com",
    name: "U",
    image: null,
    deactivatedAt: null,
    deletedAt: null,
    attributionPreference: "preserve_name",
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function makeUsers(user: User | null): UserRepository {
  return {
    byId: vi.fn(async () => user),
    byEmail: vi.fn(async () => user),
    deactivate: vi.fn(),
    reactivate: vi.fn(),
    deleteIdentity: vi.fn(),
    setAttributionPreference: vi.fn(),
  } as UserRepository;
}

describe("sessionGuard", () => {
  it("rejects when user does not exist", async () => {
    const guard = createSessionGuard(makePolicy(), makeUsers(null), BOOTSTRAP);
    await expect(guard(uid)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a deactivated user", async () => {
    const user = userRow({ deactivatedAt: now });
    const guard = createSessionGuard(makePolicy(), makeUsers(user), BOOTSTRAP);
    await expect(guard(uid)).rejects.toMatchObject({
      code: "FORBIDDEN",
      reason: "user_inactive",
    });
  });

  it("rejects a deleted user", async () => {
    const user = userRow({ deletedAt: now });
    const guard = createSessionGuard(makePolicy(), makeUsers(user), BOOTSTRAP);
    await expect(guard(uid)).rejects.toMatchObject({
      code: "FORBIDDEN",
      reason: "user_inactive",
    });
  });

  it("allows when email is approved", async () => {
    const policy = makePolicy({ isEmailApproved: vi.fn(async () => true) });
    const guard = createSessionGuard(policy, makeUsers(userRow()), BOOTSTRAP);
    await expect(guard(uid)).resolves.toBeUndefined();
    expect(policy.countActiveOperators).not.toHaveBeenCalled();
  });

  it("rejects when email is no longer approved and not the bootstrap", async () => {
    const guard = createSessionGuard(makePolicy(), makeUsers(userRow()), BOOTSTRAP);
    await expect(guard(uid)).rejects.toMatchObject({
      code: "FORBIDDEN",
      reason: "email_revoked",
    });
  });

  it("allows the first-operator bootstrap flow (approved_emails not yet seeded)", async () => {
    // Mirrors the hook-ordering race: session.create.before fires BEFORE the
    // deferred user.create.after seeds approved_emails. The bootstrap-bypass
    // keeps the first sign-in from being rejected.
    const policy = makePolicy({
      isEmailApproved: vi.fn(async () => false),
      countActiveOperators: vi.fn(async () => 0),
    });
    const user = userRow({ email: BOOTSTRAP });
    const guard = createSessionGuard(policy, makeUsers(user), BOOTSTRAP);
    await expect(guard(uid)).resolves.toBeUndefined();
  });

  it("closes the bootstrap window once any operator exists", async () => {
    const policy = makePolicy({
      isEmailApproved: vi.fn(async () => false),
      countActiveOperators: vi.fn(async () => 1),
    });
    const user = userRow({ email: BOOTSTRAP });
    const guard = createSessionGuard(policy, makeUsers(user), BOOTSTRAP);
    await expect(guard(uid)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows an approved user whose email differs from the bootstrap", async () => {
    const policy = makePolicy({ isEmailApproved: vi.fn(async () => true) });
    const user = userRow({ email: "member@example.com" });
    const guard = createSessionGuard(policy, makeUsers(user), BOOTSTRAP);
    await expect(guard(uid)).resolves.toBeUndefined();
  });

  it("skips admission when the user has no email (defensive)", async () => {
    // An OAuth provider could in theory return a user without an email; the
    // session still requires isActiveUser but should not crash on a null email.
    const user = userRow({ email: null });
    const guard = createSessionGuard(makePolicy(), makeUsers(user), BOOTSTRAP);
    await expect(guard(uid)).resolves.toBeUndefined();
  });
});
