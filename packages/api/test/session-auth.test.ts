import { describe, expect, it } from "vitest";
import { getUserId } from "../src/middleware/session-auth.ts";

describe("getUserId", () => {
  it("returns the userId when set", () => {
    expect(getUserId({ var: { userId: "u_abc" } })).toBe("u_abc");
  });

  it("throws when userId is null — defensive against routes wired without sessionAuthMiddleware", () => {
    expect(() => getUserId({ var: { userId: null } })).toThrow(/unexpectedly null/);
  });
});
