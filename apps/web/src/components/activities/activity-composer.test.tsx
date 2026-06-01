import { type ActivityPart, activityPartSchema, type LearningActivity } from "@hearth/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityComposer, findIncompletePart, sanitizePartForWire } from "./activity-composer.tsx";

/**
 * SSR-level coverage for the static render of the composer's short-answer
 * answer-key editor and the destructive / required affordances. The
 * interactive flows need a real DOM and live in the deferred jsdom
 * component-test layer + the m10 e2e.
 *
 * TODO(test): add jsdom component coverage for the deferred DOM behaviors —
 * the add-accept-row flow (and that a blank accept row is dropped, never
 * reaching the server), the Match-exactly toggle swapping the worked-example
 * note, and the submit-error field binding (a coherence failure sets
 * aria-invalid + aria-describedby on the correct-answer Input and focuses it).
 */

const SHORT_ANSWER_ACTIVITY: LearningActivity = {
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
            correctAnswer: "sí",
            alsoAccept: ["si"],
            exactMatch: false,
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

function render(activity: LearningActivity | null) {
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <ActivityComposer
        open
        onClose={() => {}}
        trackId="t_1"
        groupId="g_1"
        siblings={[]}
        activity={activity}
        onSubmit={async () => activity ?? SHORT_ANSWER_ACTIVITY}
      />
    </QueryClientProvider>,
  );
}

describe("<ActivityComposer> short-answer key editor", () => {
  it("renders the non-regex answer-key controls, never a regex field", () => {
    const html = render(SHORT_ANSWER_ACTIVITY);
    expect(html).toContain("Correct answer");
    expect(html).toContain("Add accepted answer");
    expect(html).toContain("Match exactly");
    expect(html).not.toMatch(/RE2|regex/i);
  });

  it("shows the forgiving-grading note while Match exactly is off", () => {
    const html = render(SHORT_ANSWER_ACTIVITY);
    expect(html).toContain("regardless of capitalization");
  });

  it("labels the accepted-answer remove control accessibly", () => {
    const html = render(SHORT_ANSWER_ACTIVITY);
    expect(html).toContain('aria-label="Remove accepted answer 1"');
  });

  it("marks the Title field required with a visible pill", () => {
    const html = render(null);
    expect(html).toContain("Required");
    expect(html).toContain("required");
  });
});

/**
 * A short-answer quiz Part with one question, used to exercise the wire
 * sanitizer and the pre-submit completeness gate. The server's
 * `acceptedAnswer` is `z.string().trim().min(1)` for both `correctAnswer` and
 * every `alsoAccept` entry, so `activityPartSchema` is the same oracle the API
 * route applies — "no server error reached" == `safeParse(...).success`.
 */
function shortAnswerPart(shape: {
  correctAnswer?: string;
  alsoAccept: string[];
  exactMatch?: boolean;
}): ActivityPart {
  return {
    kind: "quiz",
    id: "p_quiz",
    questions: [
      {
        id: "q_sa",
        prompt: "How do you say yes?",
        shape: { kind: "short_answer", exactMatch: false, ...shape },
      },
    ],
  };
}

function sanitizedShortAnswerShape(part: ActivityPart) {
  const sanitized = sanitizePartForWire(part);
  if (sanitized.kind !== "quiz") throw new Error("expected quiz part");
  const shape = sanitized.questions[0]?.shape;
  if (shape?.kind !== "short_answer") throw new Error("expected short_answer shape");
  return shape;
}

describe("sanitizePartForWire (short-answer answer key)", () => {
  it("drops blank/whitespace-only alsoAccept rows so a half-filled extra never 400s", () => {
    const part = shortAnswerPart({ correctAnswer: "sí", alsoAccept: ["si", "  ", ""] });
    expect(sanitizedShortAnswerShape(part).alsoAccept).toEqual(["si"]);
    // The unsanitized part would be rejected by the server schema; the
    // sanitized one passes — the blank row is an optional extra, not a gate.
    expect(activityPartSchema.safeParse(part).success).toBe(false);
    expect(activityPartSchema.safeParse(sanitizePartForWire(part)).success).toBe(true);
  });

  it("treats a whitespace-only correct answer as ungraded (undefined), not a sent blank", () => {
    const part = shortAnswerPart({ correctAnswer: "   ", alsoAccept: [] });
    expect(sanitizedShortAnswerShape(part).correctAnswer).toBeUndefined();
    expect(activityPartSchema.safeParse(part).success).toBe(false);
    expect(activityPartSchema.safeParse(sanitizePartForWire(part)).success).toBe(true);
  });

  it("trims a kept correct answer", () => {
    const part = shortAnswerPart({ correctAnswer: "  sí  ", alsoAccept: [] });
    expect(sanitizedShortAnswerShape(part).correctAnswer).toBe("sí");
  });
});

describe("findIncompletePart (short-answer coherence binds to the field)", () => {
  it("flags alsoAccept-without-correctAnswer and binds the error to the correct-answer input", () => {
    const part = shortAnswerPart({ alsoAccept: ["si"] });
    const result = findIncompletePart([part]);
    expect(result?.partIndex).toBe(0);
    expect(result?.field).toEqual({ kind: "quiz-correct-answer", questionIndex: 0 });
    expect(result?.message).toMatch(/add a correct answer/i);
  });

  it("treats a whitespace-only correct answer as no primary answer for the coherence gate", () => {
    const part = shortAnswerPart({ correctAnswer: "   ", alsoAccept: ["si"] });
    expect(findIncompletePart([part])?.field).toEqual({
      kind: "quiz-correct-answer",
      questionIndex: 0,
    });
  });

  it("passes a fully ungraded short-answer question (no correct answer, no accepts)", () => {
    expect(findIncompletePart([shortAnswerPart({ alsoAccept: [] })])).toBeNull();
  });

  it("passes a graded short-answer question", () => {
    expect(
      findIncompletePart([shortAnswerPart({ correctAnswer: "sí", alsoAccept: [] })]),
    ).toBeNull();
  });
});
