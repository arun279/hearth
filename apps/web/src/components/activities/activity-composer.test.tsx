import type { LearningActivity } from "@hearth/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityComposer } from "./activity-composer.tsx";

/**
 * SSR-level coverage for the static render of the composer's short-answer
 * answer-key editor and the destructive / required affordances. The
 * interactive flows (adding an accept row, toggling the note, the
 * submit-error field binding) need a real DOM and live in the deferred
 * jsdom component-test layer + the m10 e2e.
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
