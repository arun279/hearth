import type { ActivityPart, LearningActivity } from "@hearth/domain";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityComposerPayload } from "../../hooks/use-activities.ts";
import { installFetchSpy } from "../../test/fetch-spy.ts";
import { renderWithProviders } from "../../test/render.tsx";

/**
 * The interactive composer flows an SSR-string test can't drive: the
 * add-accept-row flow (a blank accepted-answer row is dropped before the wire,
 * never sent), the Match-exactly toggle swapping the worked-example note, and
 * the submit-error field binding (a coherence failure sets aria-invalid +
 * aria-describedby on the correct-answer Input and moves focus to it).
 *
 * The composer's two data hooks (library list + track people) are stubbed so a
 * quiz-focused test doesn't depend on the network; `onSubmit` is a spy that
 * captures the serialized payload.
 */

vi.mock("../../hooks/use-library.ts", () => ({
  useLibraryList: () => ({ data: undefined, isLoading: false, isError: false }),
}));
vi.mock("../../hooks/use-tracks.ts", () => ({
  useTrackPeople: () => ({ data: undefined, isLoading: false, isError: false }),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { ActivityComposer } from "./activity-composer.tsx";

let fetchSpy: ReturnType<typeof installFetchSpy>;

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  fetchSpy = installFetchSpy();
});

afterEach(() => {
  fetchSpy.restore();
});

function shortAnswerActivity(shape: {
  correctAnswer?: string;
  alsoAccept?: string[];
  exactMatch?: boolean;
}): LearningActivity {
  return {
    id: "a_1" as LearningActivity["id"],
    trackId: "t_1" as LearningActivity["trackId"],
    title: "Greetings",
    description: null,
    parts: [
      {
        kind: "quiz",
        id: "p_quiz",
        questions: [
          {
            id: "q_sa",
            prompt: "How do you say yes?",
            shape: {
              kind: "short_answer",
              alsoAccept: [],
              exactMatch: false,
              ...shape,
            },
          },
        ],
      },
    ],
    flow: { prereqs: [], displayOrder: ["p_quiz"] },
    audience: { kind: "everyone_enrolled" },
    window: null,
    postClosePolicy: null,
    completionRule: { kind: "manual_mark" },
    participationMode: "individual",
    libraryRefs: [],
    prerequisiteActivityIds: [],
    suggestedNextActivityIds: [],
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
  };
}

/** A typed `onSubmit` spy so `mock.calls[n][0]` is the serialized payload. */
function makeOnSubmit(result: LearningActivity) {
  return vi.fn<(p: ActivityComposerPayload) => Promise<LearningActivity>>(async () => result);
}

function renderComposer(
  activity: LearningActivity,
  onSubmit: (p: ActivityComposerPayload) => Promise<LearningActivity>,
) {
  return renderWithProviders(
    <ActivityComposer
      open
      onClose={() => {}}
      trackId="t_1"
      groupId="g_1"
      siblings={[]}
      activity={activity}
      onSubmit={onSubmit}
    />,
  );
}

/**
 * Find a `<button>` by the trimmed text it renders. The composer's
 * icon+label buttons (the Part palette, "Add question", "Add accepted answer")
 * carry an `aria-hidden` lucide icon; happy-dom's accessible-name computation
 * mishandles those, so a role+name query is unreliable for them. The visible
 * text is the stable selector.
 */
function buttonByText(text: string): HTMLButtonElement {
  const match = screen.getAllByRole("button").find((b) => (b.textContent ?? "").trim() === text);
  if (!match) throw new Error(`no button with text "${text}"`);
  return match as HTMLButtonElement;
}

function firstQuestionShape(payload: ActivityComposerPayload) {
  const part = payload.parts[0] as ActivityPart;
  if (part.kind !== "quiz") throw new Error("expected quiz part");
  const shape = part.questions[0]?.shape;
  if (shape?.kind !== "short_answer") throw new Error("expected short_answer shape");
  return shape;
}

describe("ActivityComposer add-accept-row", () => {
  it("drops a blank accepted-answer row before the wire — it never reaches onSubmit", async () => {
    const onSubmit = makeOnSubmit(shortAnswerActivity({ correctAnswer: "sí" }));
    const { user } = renderComposer(shortAnswerActivity({ correctAnswer: "sí" }), onSubmit);

    // Add an extra accepted-answer row and leave it blank.
    await user.click(buttonByText("Add accepted answer"));
    expect(screen.getByRole("textbox", { name: "Accepted answer 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]?.[0];
    if (!payload) throw new Error("onSubmit not called");
    // The blank row is an optional extra, not a gate: the sanitizer drops it,
    // so the server never sees an empty `acceptedAnswer` that would 400.
    expect(firstQuestionShape(payload).alsoAccept).toEqual([]);
  });

  it("keeps a filled accepted-answer row but still drops a blank sibling", async () => {
    const onSubmit = makeOnSubmit(shortAnswerActivity({ correctAnswer: "sí" }));
    const { user } = renderComposer(shortAnswerActivity({ correctAnswer: "sí" }), onSubmit);

    await user.click(buttonByText("Add accepted answer"));
    await user.type(screen.getByRole("textbox", { name: "Accepted answer 1" }), "si");
    await user.click(buttonByText("Add accepted answer"));
    // Second row left blank.

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0]?.[0];
    if (!payload) throw new Error("onSubmit not called");
    expect(firstQuestionShape(payload).alsoAccept).toEqual(["si"]);
  });
});

describe("ActivityComposer Match-exactly note swap", () => {
  it("swaps the worked-example note when Match exactly toggles", async () => {
    const onSubmit = makeOnSubmit(shortAnswerActivity({ correctAnswer: "sí" }));
    const { user } = renderComposer(shortAnswerActivity({ correctAnswer: "sí" }), onSubmit);

    // Off by default: the forgiving-grading note is shown.
    expect(screen.getByText(/Answers match regardless of capitalization/)).toBeInTheDocument();
    expect(screen.queryByText(/Answers must match exactly/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Match exactly/ }));

    expect(screen.getByText(/Answers must match exactly/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Answers match regardless of capitalization/),
    ).not.toBeInTheDocument();
  });
});

describe("ActivityComposer submit-error field binding", () => {
  it("binds an alsoAccept-without-correctAnswer failure to the correct-answer Input and focuses it", async () => {
    // alsoAccept set but no correct answer: the coherence gate fires on submit.
    const onSubmit = makeOnSubmit(shortAnswerActivity({ alsoAccept: ["si"] }));
    const { user } = renderComposer(shortAnswerActivity({ alsoAccept: ["si"] }), onSubmit);

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // The gate short-circuits the submit — nothing is sent.
    expect(onSubmit).not.toHaveBeenCalled();

    const correctInput = screen.getByRole("textbox", { name: /Correct answer/ });
    await waitFor(() => expect(correctInput).toHaveAttribute("aria-invalid", "true"));
    // The error message is wired to the input via aria-describedby (WCAG 3.3.1).
    const describedBy = correctInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const describer = document.getElementById(describedBy ?? "");
    expect(describer).not.toBeNull();
    expect(describer?.textContent ?? "").toMatch(/add a correct answer/i);
    // Focus is moved to the gating field.
    expect(correctInput).toHaveFocus();
  });

  it("clears the field error once the gating value is supplied", async () => {
    const onSubmit = makeOnSubmit(shortAnswerActivity({ alsoAccept: ["si"] }));
    const { user } = renderComposer(shortAnswerActivity({ alsoAccept: ["si"] }), onSubmit);

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const correctInput = screen.getByRole("textbox", { name: /Correct answer/ });
    await waitFor(() => expect(correctInput).toHaveAttribute("aria-invalid", "true"));

    // Typing into the gating field clears the submit error (the draft-change
    // effect resets it).
    await user.type(correctInput, "sí");
    await waitFor(() => expect(correctInput).not.toHaveAttribute("aria-invalid"));
  });
});
