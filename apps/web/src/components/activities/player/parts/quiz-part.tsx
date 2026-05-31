import type {
  PartProgressState,
  QuizAnswer,
  QuizPart as QuizPartT,
  QuizQuestion,
} from "@hearth/domain";
import { Badge, Button, Input, RadioGroup, type RadioOption } from "@hearth/ui";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type QuizSubmitResult, useSubmitQuiz } from "../../../../hooks/use-activity-record.ts";
import { asUserMessage } from "../../../../lib/problem.ts";

type Props = {
  readonly activityId: string;
  readonly part: QuizPartT;
  readonly partState: PartProgressState | null;
  readonly canParticipate: boolean;
};

type Verdict = QuizSubmitResult["perQuestion"][number];

function blankAnswer(q: QuizQuestion): QuizAnswer {
  return q.shape.kind === "multiple_choice"
    ? { questionId: q.id, kind: "multiple_choice", selectedIndex: null }
    : { questionId: q.id, kind: "short_answer", text: "" };
}

export function initialAnswers(
  part: QuizPartT,
  partState: PartProgressState | null,
): Record<string, QuizAnswer> {
  const stored = partState?.kind === "quiz" ? partState.answers : [];
  const byId = new Map(stored.map((a) => [a.questionId, a]));
  const out: Record<string, QuizAnswer> = {};
  for (const q of part.questions) {
    const prior = byId.get(q.id);
    out[q.id] = prior && prior.kind === q.shape.kind ? prior : blankAnswer(q);
  }
  return out;
}

export function QuizPart({ activityId, part, partState, canParticipate }: Props) {
  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>(() =>
    initialAnswers(part, partState),
  );
  const [feedback, setFeedback] = useState<Map<string, Verdict> | null>(null);
  const [score, setScore] = useState<QuizSubmitResult["autoScore"] | null>(null);
  const submit = useSubmitQuiz(activityId);

  // Editing any answer invalidates the prior grading — clear it so the
  // learner re-submits to see fresh feedback.
  const updateAnswer = (next: QuizAnswer) => {
    setAnswers((prev) => ({ ...prev, [next.questionId]: next }));
    if (feedback !== null) {
      setFeedback(null);
      setScore(null);
    }
  };

  const onSubmit = () => {
    const payload = part.questions.map((q) => answers[q.id] ?? blankAnswer(q));
    submit.mutate(
      { partId: part.id, answers: payload },
      {
        onSuccess: (res) => {
          setFeedback(new Map(res.perQuestion.map((v) => [v.questionId, v])));
          setScore(res.autoScore);
        },
        onError: (err) => toast.error(asUserMessage(err, "Couldn't submit your answers.")),
      },
    );
  };

  return (
    <div className="flex flex-col gap-3.5">
      {part.questions.map((q, idx) => (
        <QuestionCard
          key={q.id}
          index={idx}
          question={q}
          answer={answers[q.id] ?? blankAnswer(q)}
          onChange={updateAnswer}
          verdict={feedback?.get(q.id) ?? null}
          disabled={!canParticipate}
        />
      ))}

      {canParticipate ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={onSubmit} disabled={submit.isPending} size="sm">
            {submit.isPending ? "Submitting…" : feedback ? "Re-submit" : "Submit"}
          </Button>
          {score ? <ScoreSummary score={score} /> : null}
        </div>
      ) : (
        <p className="text-[13px] text-[var(--color-ink-2)]">
          Only enrolled participants can submit answers.
        </p>
      )}
    </div>
  );
}

function ScoreSummary({ score }: { readonly score: QuizSubmitResult["autoScore"] }) {
  // role="status" announces the result to screen-reader users when it mounts
  // on submit — the visual badges per question aren't announced on their own.
  if (score.gradeable === 0) {
    return (
      <span role="status" className="text-[12px] text-[var(--color-ink-2)]">
        Submitted — this quiz has no auto-graded questions.
      </span>
    );
  }
  return (
    <span role="status" className="text-[12px] text-[var(--color-ink-2)]">
      <span className="font-medium text-[var(--color-ink)]">
        {score.correct} of {score.gradeable}
      </span>{" "}
      graded correct
    </span>
  );
}

// Once a quiz is graded, tint each multiple-choice option on the option itself:
// the keyed-correct option reads "good", the learner's wrong pick reads "danger".
// Tone is paired with a check/cross icon + sr-only text so the outcome is never
// colour alone (WCAG 1.4.1). Ungraded (no answer key) → no tint. Editing an answer
// clears the verdict upstream, so the tint clears on re-answer.
export function gradedMcOptions(
  options: readonly string[],
  chosenIndex: number | null,
  verdict: Verdict | null,
): ReadonlyArray<RadioOption<string>> {
  return options.map((label, i): RadioOption<string> => {
    if (!verdict || verdict.correctIndex === null) return { value: String(i), label };
    if (i === verdict.correctIndex) {
      return {
        value: String(i),
        label,
        tone: "good",
        adornment: (
          <span className="flex items-center gap-1 text-[var(--color-good)]">
            <Check size={14} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Correct answer</span>
          </span>
        ),
      };
    }
    if (i === chosenIndex) {
      return {
        value: String(i),
        label,
        tone: "danger",
        adornment: (
          <span className="flex items-center gap-1 text-[var(--color-danger)]">
            <X size={14} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Your answer, incorrect</span>
          </span>
        ),
      };
    }
    return { value: String(i), label };
  });
}

function QuestionCard({
  index,
  question,
  answer,
  onChange,
  verdict,
  disabled,
}: {
  readonly index: number;
  readonly question: QuizQuestion;
  readonly answer: QuizAnswer;
  readonly onChange: (next: QuizAnswer) => void;
  readonly verdict: Verdict | null;
  readonly disabled: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-3.5">
      <p className="mb-2.5 font-medium text-[13px] text-[var(--color-ink)]">
        <span className="text-[var(--color-ink-2)]">{index + 1}.</span> {question.prompt}
      </p>
      {question.shape.kind === "multiple_choice" ? (
        <RadioGroup
          legend={`Answer for question ${index + 1}`}
          legendHidden
          value={
            answer.kind === "multiple_choice" && answer.selectedIndex !== null
              ? String(answer.selectedIndex)
              : null
          }
          onValueChange={(v) =>
            onChange({ questionId: question.id, kind: "multiple_choice", selectedIndex: Number(v) })
          }
          disabled={disabled}
          options={gradedMcOptions(
            question.shape.options,
            answer.kind === "multiple_choice" ? answer.selectedIndex : null,
            verdict,
          )}
        />
      ) : (
        <Input
          aria-label={`Answer for question ${index + 1}`}
          value={answer.kind === "short_answer" ? answer.text : ""}
          onChange={(e) =>
            onChange({ questionId: question.id, kind: "short_answer", text: e.target.value })
          }
          disabled={disabled}
          placeholder="Your answer"
        />
      )}
      {verdict ? <Feedback verdict={verdict} question={question} /> : null}
    </div>
  );
}

function Feedback({
  verdict,
  question,
}: {
  readonly verdict: Verdict;
  readonly question: QuizQuestion;
}) {
  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      {/* Wrap the badge in a row so it hugs its label (a bare Badge in the
          flex-col would stretch full width). For multiple choice, the keyed
          correct answer is shown inline on the option itself (good tint +
          check), so it isn't repeated here. */}
      <div className="flex flex-wrap items-center gap-2">
        {verdict.verdict === "correct" ? (
          <Badge tone="good">Correct</Badge>
        ) : verdict.verdict === "incorrect" ? (
          <Badge tone="danger">Not quite</Badge>
        ) : (
          <Badge tone="neutral">Submitted</Badge>
        )}
      </div>
      {question.explainAfterAnswer ? (
        <p className="text-[12px] text-[var(--color-ink-2)] leading-relaxed">
          {question.explainAfterAnswer}
        </p>
      ) : null}
    </div>
  );
}
