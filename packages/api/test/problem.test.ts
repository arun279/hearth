import { DomainError } from "@hearth/domain";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { mapUnknown, problemFromDomainError, unknownErrorProblem } from "../src/problem.ts";

describe("problem.ts envelope mapping", () => {
  it("falls back to lowercased domain code when no reason was supplied", () => {
    const out = problemFromDomainError(new DomainError("NOT_FOUND", "Missing."));
    expect(out.code).toBe("not_found");
    expect(out.policy).toBeUndefined();
  });

  it("only attaches policy.code on FORBIDDEN with a reason", () => {
    const forbidden = problemFromDomainError(new DomainError("FORBIDDEN", "Nope.", "not_admin"));
    expect(forbidden.policy).toEqual({ code: "not_admin" });

    const conflict = problemFromDomainError(new DomainError("CONFLICT", "Dup.", "already_exists"));
    expect(conflict.policy).toBeUndefined();
  });

  it("uses a generic fallback message for unknownErrorProblem", () => {
    // Generic message (no echoing err.message) so a SQL or stack trace
    // never leaks to the client. The full error is logged server-side
    // for the operator's observability surface.
    const expected = "Something went wrong on our end. Try again, or contact your operator.";
    const empty = unknownErrorProblem(new Error(""));
    expect(empty.detail).toBe(expected);
    const withMessage = unknownErrorProblem(new Error("internal SQL state leaks here"));
    expect(withMessage.detail).toBe(expected);
    const nonError = unknownErrorProblem("bare-string");
    expect(nonError.detail).toBe(expected);
  });

  it("mapUnknown routes ZodError through the validation envelope", () => {
    const zerr = new ZodError([
      // Minimal Zod issue payload — the mapper only reads path + message.
      { code: "custom", path: ["field"], message: "bad", input: undefined } as never,
    ]);
    const out = mapUnknown(zerr);
    expect(out.code).toBe("validation_failed");
    expect(out.status).toBe(400);
  });
});
