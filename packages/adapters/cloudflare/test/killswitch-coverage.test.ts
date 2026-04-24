import type { AttributionPreference, UserId } from "@hearth/domain";
import type { SystemFlagRepository } from "@hearth/ports";
import { describe, expect, it } from "vitest";
import type { CloudflareAdapterDeps } from "../src/deps.ts";
import {
  createInstanceAccessPolicyRepository,
  createInstanceSettingsRepository,
  createKillswitchGate,
  createObjectStorage,
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
  const object = createObjectStorage(storage, gate);

  const CASES: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
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

    ["ObjectStorage.putUpload", () => object.putUpload("k", new Blob([]).stream(), undefined)],
    ["ObjectStorage.delete", () => object.delete("k")],
  ];

  for (const [label, run] of CASES) {
    it(`${label} calls gate.assertWritable before touching storage`, async () => {
      await expect(run()).rejects.toBeInstanceOf(KillswitchBlocked);
    });
  }
});
