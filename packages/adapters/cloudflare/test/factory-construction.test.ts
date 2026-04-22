import { describe, expect, it } from "vitest";
import {
  createActivityRecordRepository,
  createClock,
  createIdGenerator,
  createInstanceAccessPolicyRepository,
  createLearningActivityRepository,
  createLearningTrackRepository,
  createLibraryItemRepository,
  createObjectStorage,
  createScheduler,
  createStudyGroupRepository,
  createStudySessionRepository,
  createSystemFlagRepository,
  createUserRepository,
} from "../src/index.ts";

/**
 * Invariant: every factory in @hearth/adapter-cloudflare must construct
 * without throwing, even if its implementation is a scaffold stub. The
 * composition root in apps/worker calls every factory once per request —
 * any factory that throws at construction crashes every route including
 * /healthz.
 *
 * Method calls on stubs are expected to throw via the Proxy in
 * src/stub.ts — that's the contract. This test only asserts the factory
 * itself returns, not that its methods succeed.
 */
describe("adapter factory construction", () => {
  const db = {} as unknown as Parameters<typeof createUserRepository>[0]["db"];
  const storage = {} as unknown as Parameters<typeof createObjectStorage>[0];

  it.each([
    ["createInstanceAccessPolicyRepository", () => createInstanceAccessPolicyRepository({ db })],
    ["createUserRepository", () => createUserRepository({ db })],
    ["createStudyGroupRepository", () => createStudyGroupRepository({ db })],
    ["createLearningTrackRepository", () => createLearningTrackRepository({ db })],
    ["createLibraryItemRepository", () => createLibraryItemRepository({ db, storage })],
    ["createLearningActivityRepository", () => createLearningActivityRepository({ db })],
    ["createActivityRecordRepository", () => createActivityRecordRepository({ db })],
    ["createStudySessionRepository", () => createStudySessionRepository({ db })],
    ["createSystemFlagRepository", () => createSystemFlagRepository({ db })],
    ["createObjectStorage", () => createObjectStorage(storage)],
    ["createClock", () => createClock()],
    ["createIdGenerator", () => createIdGenerator()],
    ["createScheduler", () => createScheduler()],
  ])("%s constructs without throwing", (_name, factory) => {
    expect(factory).not.toThrow();
  });
});
