import { DomainError, type DomainErrorCode } from "@hearth/domain";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

/**
 * RFC 7807 "Problem Details" envelope. Every error response from the API
 * layer uses this shape so clients can pattern-match on `code` without
 * peeking into free-form message strings.
 */
export type Problem = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  /** Stable machine-readable code — safe to switch on in the SPA. */
  readonly code: string;
  /** Present on policy-denial responses — matches PolicyDenialReason.code. */
  readonly policy?: { readonly code: string };
  /** Present on validation failures — one entry per failed Zod issue. */
  readonly issues?: ReadonlyArray<{ readonly path: string; readonly message: string }>;
};

const CODE_TO_STATUS: Record<DomainErrorCode, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  INVARIANT_VIOLATION: 422,
  INSUFFICIENT_STORAGE: 507,
  READ_ONLY: 503,
  DISABLED: 503,
};

const TYPE_PREFIX = "about:blank#";

/**
 * Return an `application/problem+json` response for a well-known error.
 * Route handlers throw DomainError or ZodError; the global error handler
 * below calls this to convert. Unexpected errors get a generic 500.
 *
 * `c.json()` would force `application/json` — use the body-response overload
 * so the problem+json content type is authoritative.
 */
export function problemResponse(c: Context, problem: Problem) {
  return c.body(JSON.stringify(problem), problem.status as ContentfulStatusCode, {
    "Content-Type": "application/problem+json",
  });
}

export function problemFromDomainError(err: DomainError): Problem {
  const status = CODE_TO_STATUS[err.code];
  const code = err.reason ?? err.code.toLowerCase();
  const base: Problem = {
    type: `${TYPE_PREFIX}${code}`,
    title: err.code.toLowerCase().replace(/_/g, " "),
    status,
    detail: err.message,
    code,
  };
  if (err.code === "FORBIDDEN" && err.reason) {
    return { ...base, policy: { code: err.reason } };
  }
  return base;
}

export function problemFromZodError(err: ZodError): Problem {
  return {
    type: `${TYPE_PREFIX}validation_failed`,
    title: "validation failed",
    status: 400,
    detail: "The request body did not match the expected schema.",
    code: "validation_failed",
    issues: err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function unknownErrorProblem(err: unknown): Problem {
  // Log the full error server-side (Sentry catches via the worker
  // wrapping). The CLIENT response stays generic — a SQL message or
  // stack trace would leak schema details and obscure the actual user-
  // facing failure mode. Surface diagnosis through the operator's
  // observability surface, not the SPA's error toast.
  if (err instanceof Error) {
    console.error("Unhandled error in API route", err);
  } else {
    console.error("Unhandled non-Error thrown from API route", err);
  }
  return {
    type: `${TYPE_PREFIX}internal_error`,
    title: "internal error",
    status: 500,
    detail: "Something went wrong on our end. Try again, or contact your operator.",
    code: "internal_error",
  };
}

export function problemForKillswitch(mode: "read_only" | "disabled"): Problem {
  return {
    type: `${TYPE_PREFIX}${mode}`,
    title: mode === "read_only" ? "instance is read-only" : "instance is disabled",
    status: 503,
    detail:
      mode === "read_only"
        ? "The Hearth instance is currently read-only; writes are blocked."
        : "The Hearth instance is currently disabled; all endpoints except operator health are unavailable.",
    code: mode,
  };
}

export function mapUnknown(err: unknown): Problem {
  if (err instanceof DomainError) return problemFromDomainError(err);
  if (err instanceof ZodError) return problemFromZodError(err);
  return unknownErrorProblem(err);
}
