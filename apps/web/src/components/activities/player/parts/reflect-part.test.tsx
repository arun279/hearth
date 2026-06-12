import type { PartProgressState, WriteReflectionPart } from "@hearth/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { deriveSaveStatus, ReflectPart, wordCountLabel } from "./reflect-part.tsx";

/**
 * `deriveSaveStatus` is the precedence rule the autosave pill reads; pinning
 * it here keeps a future branch (e.g. a "conflict" state) conspicuously the
 * odd one out.
 *
 * TODO(test): the behavioural DOM transitions — retry-calls-persist, the
 * autosave-debounce pill transitions, the monotonic `lastSaved` advance, and
 * the visibilitychange/unmount keepalive flush (including the no-pending-change
 * skip) — need a real DOM and a fetch spy, so they land with the deferred
 * jsdom component-test layer (separate PR). The m10 e2e covers debounced
 * autosave and retry end-to-end in the meantime.
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

describe("wordCountLabel", () => {
  it("flips copy (not just colour) when the minimum is met", () => {
    expect(wordCountLabel(3, 10)).toEqual({ text: "3 of 10 words", met: false });
    expect(wordCountLabel(14, 10)).toEqual({ text: "10+ words", met: true });
    // At the boundary the minimum counts as met.
    expect(wordCountLabel(10, 10)).toEqual({ text: "10+ words", met: true });
  });

  it("reads as a plain count with no minimum (never 'met')", () => {
    expect(wordCountLabel(1, undefined)).toEqual({ text: "1 word", met: false });
    expect(wordCountLabel(5, undefined)).toEqual({ text: "5 words", met: false });
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
