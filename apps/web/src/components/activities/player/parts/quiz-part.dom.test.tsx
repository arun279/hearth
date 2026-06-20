import type { QuizPart as QuizPartT } from "@hearth/domain";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuizSubmitResult } from "../../../../hooks/use-activity-record.ts";
import { installFetchSpy } from "../../../../test/fetch-spy.ts";
import { renderWithProviders } from "../../../../test/render.tsx";

/**
 * The post-submit rendering paths an SSR-string test can't drive: the
 * `ScoreSummary` `gradeable === 0` branch, the short-answer submit round-trip
 * (answers -> mutation -> verdict -> rendered feedback), and verdict-clears-
 * on-edit. The submit mutation is a real `useMutation` over a controllable
 * `mutationFn` so the test owns the graded result and the genuine state
 * transitions it schedules.
 */

const submitFn =
  vi.fn<(input: { partId: string; answers: unknown }) => Promise<QuizSubmitResult>>();
const verdictFn = vi.fn<() => Promise<QuizSubmitResult | null>>();

// The verdict re-grade is a real `useQuery` over a controllable `queryFn` so
// the rejection path drives the component's `isError` branch (the "Couldn't
// load your earlier grade" retry, asserted below) the same way a 5xx would.
vi.mock("../../../../hooks/use-activity-record.ts", async () => {
  const rq = await import("@tanstack/react-query");
  return {
    useSubmitQuiz: () => rq.useMutation({ mutationFn: submitFn }),
    useQuizVerdict: (activityId: string, partId: string) =>
      rq.useQuery({
        queryKey: ["activity-quiz-verdict", activityId, partId],
        queryFn: verdictFn,
        retry: false,
      }),
  };
});

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

import { QuizPart } from "./quiz-part.tsx";

let fetchSpy: ReturnType<typeof installFetchSpy>;

beforeEach(() => {
  submitFn.mockReset();
  verdictFn.mockReset();
  verdictFn.mockResolvedValue(null);
  toastError.mockReset();
  fetchSpy = installFetchSpy();
});

afterEach(() => {
  fetchSpy.restore();
});

const SHORT_ANSWER_PART: QuizPartT = {
  kind: "quiz",
  id: "p_quiz",
  questions: [
    {
      id: "q_sa",
      prompt: "Translate hello.",
      shape: { kind: "short_answer", alsoAccept: [], exactMatch: false },
    },
  ],
};

const MC_NO_KEY_PART: QuizPartT = {
  kind: "quiz",
  id: "p_quiz",
  questions: [
    {
      id: "q_mc",
      prompt: "Pick one",
      shape: { kind: "multiple_choice", options: ["A", "B"] },
    },
  ],
};

function renderQuiz(part: QuizPartT) {
  return renderWithProviders(
    <QuizPart activityId="a_test" part={part} partState={null} canParticipate={true} />,
  );
}

describe("QuizPart short-answer submit round-trip", () => {
  it("sends the typed answer and renders the returned verdict + score summary", async () => {
    submitFn.mockResolvedValue({
      perQuestion: [{ questionId: "q_sa", verdict: "correct", correctIndex: null }],
      autoScore: { correct: 1, gradeable: 1 },
    });
    const { user } = renderQuiz(SHORT_ANSWER_PART);

    await user.type(screen.getByRole("textbox", { name: "Answer for question 1" }), "hola");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
    expect(submitFn.mock.calls[0]?.[0]).toEqual({
      partId: "p_quiz",
      answers: [{ questionId: "q_sa", kind: "short_answer", text: "hola" }],
    });

    expect(await screen.findByText("Correct")).toBeInTheDocument();
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    // The CTA flips to Re-submit once a verdict is in hand.
    expect(screen.getByRole("button", { name: "Re-submit" })).toBeInTheDocument();
  });
});

describe("QuizPart ScoreSummary gradeable === 0", () => {
  it("reads 'no auto-graded questions' when nothing is gradeable", async () => {
    submitFn.mockResolvedValue({
      perQuestion: [{ questionId: "q_mc", verdict: "no_key", correctIndex: null }],
      autoScore: { correct: 0, gradeable: 0 },
    });
    const { user } = renderQuiz(MC_NO_KEY_PART);

    // Pick any option so the submit isn't gated by the empty-answer warning.
    await user.click(screen.getByRole("radio", { name: "A" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(
      await screen.findByText("Submitted — this quiz has no auto-graded questions."),
    ).toBeInTheDocument();
    // The "N of M graded correct" summary must NOT render in this branch.
    expect(screen.queryByText(/graded correct/)).not.toBeInTheDocument();
  });
});

describe("QuizPart verdict rehydration on mount", () => {
  it("re-grades from persisted answers and shows the verdict without a submit", async () => {
    verdictFn.mockResolvedValue({
      perQuestion: [{ questionId: "q_sa", verdict: "correct", correctIndex: null }],
      autoScore: { correct: 1, gradeable: 1 },
    });
    renderWithProviders(
      <QuizPart
        activityId="a_test"
        part={SHORT_ANSWER_PART}
        partState={{
          kind: "quiz",
          completed: false,
          answers: [{ questionId: "q_sa", kind: "short_answer", text: "hola" }],
        }}
        canParticipate={true}
      />,
    );

    // The grade appears with no submit click, and the CTA reflects a prior grade.
    expect(await screen.findByText("Correct")).toBeInTheDocument();
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-submit" })).toBeInTheDocument();
    // A mount-time re-grade is a read — it must not POST.
    expect(submitFn).not.toHaveBeenCalled();
  });

  it("clears a rehydrated verdict when the learner edits an answer", async () => {
    verdictFn.mockResolvedValue({
      perQuestion: [{ questionId: "q_sa", verdict: "incorrect", correctIndex: null }],
      autoScore: { correct: 0, gradeable: 1 },
    });
    const { user } = renderWithProviders(
      <QuizPart
        activityId="a_test"
        part={SHORT_ANSWER_PART}
        partState={{
          kind: "quiz",
          completed: false,
          answers: [{ questionId: "q_sa", kind: "short_answer", text: "wrong" }],
        }}
        canParticipate={true}
      />,
    );
    expect(await screen.findByText("Not quite")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Answer for question 1" }), "x");
    expect(screen.queryByText("Not quite")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("surfaces a retry when the verdict re-grade fails with no grade in hand", async () => {
    verdictFn.mockRejectedValue(new Error("network"));
    const { user } = renderQuiz(SHORT_ANSWER_PART);

    expect(await screen.findByText("Couldn't load your earlier grade.")).toBeInTheDocument();

    // A successful submit makes the failed re-grade moot — the notice clears.
    submitFn.mockResolvedValue({
      perQuestion: [{ questionId: "q_sa", verdict: "correct", correctIndex: null }],
      autoScore: { correct: 1, gradeable: 1 },
    });
    await user.type(screen.getByRole("textbox", { name: "Answer for question 1" }), "hola");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Correct")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load your earlier grade.")).not.toBeInTheDocument();
  });
});

describe("QuizPart verdict-clears-on-edit", () => {
  it("drops the prior grading the moment the learner edits an answer", async () => {
    submitFn.mockResolvedValue({
      perQuestion: [{ questionId: "q_sa", verdict: "incorrect", correctIndex: null }],
      autoScore: { correct: 0, gradeable: 1 },
    });
    const { user } = renderQuiz(SHORT_ANSWER_PART);
    const input = screen.getByRole("textbox", { name: "Answer for question 1" });

    await user.type(input, "wrong");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Not quite")).toBeInTheDocument();

    // Editing the answer invalidates the stale verdict — it clears immediately,
    // and the CTA reverts to a fresh "Submit".
    await user.type(input, "x");
    expect(screen.queryByText("Not quite")).not.toBeInTheDocument();
    expect(screen.queryByText(/graded correct/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });
});
