import { describe, expect, it } from "vitest";
import { DomainError, policyAllow, policyDeny } from "../src/errors.ts";

describe("DomainError", () => {
  it("preserves code, message, and optional reason", () => {
    const err = new DomainError("FORBIDDEN", "Nope.", "not_instance_operator");
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Nope.");
    expect(err.reason).toBe("not_instance_operator");
    expect(err.name).toBe("DomainError");
    expect(err).toBeInstanceOf(Error);
  });

  it("makes reason optional", () => {
    const err = new DomainError("NOT_FOUND", "Missing.");
    expect(err.reason).toBeUndefined();
  });
});

describe("policyAllow / policyDeny", () => {
  it("policyAllow returns ok=true", () => {
    expect(policyAllow()).toEqual({ ok: true });
  });
  it("policyDeny carries the typed reason payload", () => {
    expect(policyDeny("not_a_member", "x")).toEqual({
      ok: false,
      reason: { code: "not_a_member", message: "x" },
    });
  });
});
