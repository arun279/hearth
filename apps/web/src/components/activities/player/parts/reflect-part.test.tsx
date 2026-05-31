import type { PartProgressState, WriteReflectionPart } from "@hearth/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { deriveSaveStatus, ReflectPart } from "./reflect-part.tsx";

/**
 * `deriveSaveStatus` is the precedence rule the autosave pill reads; pinning
 * it here keeps a future branch (e.g. a "conflict" state) conspicuously the
 * odd one out. The retry-calls-persist wiring and the autosave-debounce
 * transitions are behavioural — they need a DOM the workspace deliberately
 * doesn't ship and are covered by the M11 3-Part E2E (see docs/tripwires.md
 * § Frontend test coverage).
 */

const PART: WriteReflectionPart = { kind: "write_reflection", id: "p_reflect", prompt: "Why?" };

describe("deriveSaveStatus", () => {
  it("ranks error above every other flag", () => {
    expect(deriveSaveStatus({ isError: true, isPending: true, dirty: true, isSuccess: true })).toBe(
      "error",
    );
  });

  it("reads pending OR unsaved edits as saving", () => {
    expect(
      deriveSaveStatus({ isError: false, isPending: true, dirty: false, isSuccess: false }),
    ).toBe("saving");
    expect(
      deriveSaveStatus({ isError: false, isPending: false, dirty: true, isSuccess: true }),
    ).toBe("saving");
  });

  it("reads a settled success as saved", () => {
    expect(
      deriveSaveStatus({ isError: false, isPending: false, dirty: false, isSuccess: true }),
    ).toBe("saved");
  });

  it("reads the untouched, never-saved state as idle", () => {
    expect(
      deriveSaveStatus({ isError: false, isPending: false, dirty: false, isSuccess: false }),
    ).toBe("idle");
  });
});

describe("<ReflectPart>", () => {
  it("renders an editable textarea for an enrolled participant", () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <ReflectPart
          activityId="a_test"
          part={PART}
          partState={null}
          canParticipate={true}
          visibilityOverride={null}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain('aria-label="Your reflection"');
  });

  it("renders prior work read-only when the viewer cannot participate", () => {
    const stored: PartProgressState = {
      kind: "write_reflection",
      completed: false,
      text: "mi obra",
    };
    const html = renderToString(
      <ReflectPart
        activityId="a_test"
        part={PART}
        partState={stored}
        canParticipate={false}
        visibilityOverride={null}
      />,
    );
    expect(html).toContain("mi obra");
    expect(html).not.toContain('aria-label="Your reflection"');
  });
});
