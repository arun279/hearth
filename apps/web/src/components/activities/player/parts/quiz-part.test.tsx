import type { PartProgressState, QuizPart as QuizPartT } from "@hearth/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  gradedMcOptions,
  initialAnswers,
  isAnswered,
  QuizPart,
  verdictBadge,
} from "./quiz-part.tsx";

/**
 * Pure coverage for `initialAnswers` (which `useState` seeds the answer map
 * from on mount), `gradedMcOptions` (the post-grade option tinting, across
 * the correct / incorrect / no-key verdicts), and `verdictBadge` (the
 * outcome-badge tone + copy), plus SSR checks for the participant and
 * read-only render arms.
 *
 * TODO(test): the post-submit rendering paths — the `ScoreSummary`
 * `gradeable === 0` ("no auto-graded questions") branch, the short-answer
 * submit round-trip, and verdict-clears-on-edit — depend on a submit mutation
 * firing and updating state, so they need a real DOM. They land with the
 * deferred jsdom component-test layer (separate PR), alongside the reflection
 * keepalive-flush / autosave-transition tests; the m10 e2e covers the single
 * correct-MC path end-to-end in the meantime.
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
      shape: { kind: "short_answer", alsoAccept: [], exactMatch: false },
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

describe("verdictBadge", () => {
  it("reads a correct verdict as a good-toned 'Correct'", () => {
    expect(verdictBadge("correct", true)).toEqual({ tone: "good", label: "Correct" });
  });

  it("reads a wrong attempt as danger-toned 'Not quite'", () => {
    expect(verdictBadge("incorrect", true)).toEqual({ tone: "danger", label: "Not quite" });
  });

  it("reads a left-blank question as neutral-toned 'Not answered' — a skip is not an error", () => {
    expect(verdictBadge("incorrect", false)).toEqual({ tone: "neutral", label: "Not answered" });
  });

  it("reads an ungraded (no-key) verdict as neutral 'Submitted'", () => {
    expect(verdictBadge("no_key", true)).toEqual({ tone: "neutral", label: "Submitted" });
    expect(verdictBadge("no_key", false)).toEqual({ tone: "neutral", label: "Submitted" });
  });
});

describe("isAnswered", () => {
  it("treats a chosen MC option as answered and a null selection as blank", () => {
    expect(isAnswered({ questionId: "q", kind: "multiple_choice", selectedIndex: 0 })).toBe(true);
    expect(isAnswered({ questionId: "q", kind: "multiple_choice", selectedIndex: null })).toBe(
      false,
    );
  });

  it("treats whitespace-only short-answer text as blank", () => {
    expect(isAnswered({ questionId: "q", kind: "short_answer", text: "hola" })).toBe(true);
    expect(isAnswered({ questionId: "q", kind: "short_answer", text: "   " })).toBe(false);
    expect(isAnswered({ questionId: "q", kind: "short_answer", text: "" })).toBe(false);
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

  it("renders a short-answer input alongside the multiple-choice question", () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <QuizPart activityId="a_test" part={PART} partState={null} canParticipate={true} />
      </QueryClientProvider>,
    );
    expect(html).toContain('aria-label="Answer for question 2"');
  });

  it("renders read-only with disabled inputs, no Submit, and the enrolled-only notice", () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <QuizPart activityId="a_test" part={PART} partState={null} canParticipate={false} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Only enrolled participants can submit answers.");
    expect(html).not.toContain(">Submit<");
    expect(html).toContain("disabled");
  });
});
