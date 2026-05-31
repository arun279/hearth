import type { PartProgressState, QuizPart as QuizPartT } from "@hearth/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { gradedMcOptions, initialAnswers, QuizPart } from "./quiz-part.tsx";

/**
 * Pure coverage for `initialAnswers` (which `useState` seeds the answer map
 * from on mount) and `gradedMcOptions` (the post-grade option tinting), plus
 * an SSR smoke check that the un-submitted quiz shows the "Submit" CTA and no
 * grading feedback. Verdict-clears-on-edit (a DOM state transition) is covered
 * end-to-end by the Playwright e2e and is the seed case for the component-test
 * layer being added separately.
 */

const PART: QuizPartT = {
  kind: "quiz",
  id: "p_quiz",
  questions: [
    {
      id: "q_mc",
      prompt: "Which greeting is formal?",
      shape: { kind: "multiple_choice", options: ["Buenos días", "Qué onda"] },
    },
    {
      id: "q_sa",
      prompt: "Translate hello.",
      shape: { kind: "short_answer" },
    },
  ],
};

describe("initialAnswers", () => {
  it("reuses a stored answer whose kind matches the question shape", () => {
    const stored: PartProgressState = {
      kind: "quiz",
      completed: false,
      answers: [
        { questionId: "q_mc", kind: "multiple_choice", selectedIndex: 1 },
        { questionId: "q_sa", kind: "short_answer", text: "hola" },
      ],
    };
    const out = initialAnswers(PART, stored);
    expect(out["q_mc"]).toEqual({ questionId: "q_mc", kind: "multiple_choice", selectedIndex: 1 });
    expect(out["q_sa"]).toEqual({ questionId: "q_sa", kind: "short_answer", text: "hola" });
  });

  it("falls back to a blank answer when the stored kind mismatches the question", () => {
    const stored: PartProgressState = {
      kind: "quiz",
      completed: false,
      // q_mc is authored as multiple_choice; a stale short_answer must not bind.
      answers: [{ questionId: "q_mc", kind: "short_answer", text: "wrong shape" }],
    };
    const out = initialAnswers(PART, stored);
    expect(out["q_mc"]).toEqual({
      questionId: "q_mc",
      kind: "multiple_choice",
      selectedIndex: null,
    });
  });

  it("falls back to a blank answer when the question has no stored answer", () => {
    const out = initialAnswers(PART, null);
    expect(out["q_mc"]).toEqual({
      questionId: "q_mc",
      kind: "multiple_choice",
      selectedIndex: null,
    });
    expect(out["q_sa"]).toEqual({ questionId: "q_sa", kind: "short_answer", text: "" });
  });
});

describe("gradedMcOptions", () => {
  const opts = ["Buenos días", "Qué onda", "Hola"];

  it("returns plain options (no tint) before grading", () => {
    const out = gradedMcOptions(opts, 2, null);
    expect(out.map((o) => o.tone)).toEqual([undefined, undefined, undefined]);
    expect(out.every((o) => o.adornment === undefined)).toBe(true);
  });

  it("returns plain options for an ungraded question (no answer key)", () => {
    const out = gradedMcOptions(opts, 2, {
      questionId: "q",
      verdict: "no_key",
      correctIndex: null,
    });
    expect(out.map((o) => o.tone)).toEqual([undefined, undefined, undefined]);
  });

  it("tints only the correct option when the learner was right", () => {
    const out = gradedMcOptions(opts, 0, { questionId: "q", verdict: "correct", correctIndex: 0 });
    expect(out[0]?.tone).toBe("good");
    expect(out[0]?.adornment).toBeTruthy();
    expect(out[1]?.tone).toBeUndefined();
    expect(out[2]?.tone).toBeUndefined();
  });

  it("tints the keyed-correct option good and the wrong pick danger", () => {
    const out = gradedMcOptions(opts, 2, {
      questionId: "q",
      verdict: "incorrect",
      correctIndex: 0,
    });
    expect(out[0]?.tone).toBe("good");
    expect(out[1]?.tone).toBeUndefined();
    expect(out[2]?.tone).toBe("danger");
    expect(out[2]?.adornment).toBeTruthy();
  });
});

describe("<QuizPart> initial render", () => {
  it("shows the Submit CTA and no grading feedback before submission", () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <QuizPart activityId="a_test" part={PART} partState={null} canParticipate={true} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Submit");
    expect(html).not.toContain("Correct");
    expect(html).not.toContain("Not quite");
  });
});
