import type {
  PartProgressState,
  QuizAnswer,
  QuizAnswerResponseInput,
  QuizPart as QuizPartDef,
} from "@hearth/domain";
import { Button, Input } from "@hearth/ui";
import { Check, Minus, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useSavePartProgress, useSubmitQuiz } from "../../../../hooks/use-activity-record.ts";
import { PartCompleteButton } from "../part-complete-button.tsx";

type Response = QuizAnswerResponseInput;

/**
 * Quiz Part. Questions (prompt + options) come from the activity; the answer
 * key never ships — grading is server-side and the per-question verdict,
 * correct-option reveal, and explanation arrive in `progress.answers`.
 * Re-submission is allowed; editing an answer clears its stale feedback until
 * the next submit. Submitting grades; marking complete is the separate
 * honor-system flag and preserves the latest graded answers.
 */
export function QuizPart({
  activityId,
  part,
  progress,
  canEdit,
  lockReason,
}: {
  readonly activityId: string;
  readonly part: QuizPartDef;
  readonly progress: PartProgressState | null;
  readonly canEdit: boolean;
  readonly lockReason: string | null;
}) {
  const graded = progress?.kind === "quiz" ? progress.answers : [];
  const completed = progress?.kind === "quiz" ? progress.completed : false;
  const gradedById = new Map(graded.map((a) => [a.questionId, a]));
  const submit = useSubmitQuiz(activityId);
  const save = useSavePartProgress(activityId);

  // Completion preserves the latest graded answers (read through a ref) so a
  // complete-toggle never clobbers a grade the participant just submitted.
  const answersRef = useRef(graded);
  answersRef.current = graded;

  const [responses, setResponses] = useState<Record<string, Response>>(() => {
    const seed: Record<string, Response> = {};
    for (const answer of graded) seed[answer.questionId] = answer.response;
    return seed;
  });

  const setResponse = (questionId: string, response: Response) =>
    setResponses((prev) => ({ ...prev, [questionId]: response }));

  const onSubmit = () => {
    const answers = part.questions
      .map((q) => ({ questionId: q.id, response: responses[q.id] }))
      .filter((a): a is { questionId: string; response: Response } => a.response !== undefined);
    if (answers.length === 0) {
      toast.message("Answer at least one question first.");
      return;
    }
    submit.mutate({ partId: part.id, answers }, { onError: () => toast.error("Couldn't submit.") });
  };

  const gradeable = graded.filter((a) => a.result !== "no_key").length;
  const correct = graded.filter((a) => a.result === "correct").length;

  return (
    <div className="max-w-2xl space-y-5">
      {part.questions.map((question, qi) => {
        const response = responses[question.id];
        const gradedAnswer = gradedById.get(question.id);
        // Feedback only when the current answer is the one that was graded.
        const feedback =
          gradedAnswer && responsesEqual(response, gradedAnswer.response) ? gradedAnswer : null;
        return (
          <fieldset
            key={question.id}
            className="space-y-2 border-[var(--color-rule)] border-b pb-4 last:border-b-0"
            disabled={!canEdit}
          >
            <legend className="text-[14px] text-[var(--color-ink-1)]">
              <span className="text-[var(--color-ink-3)]">{qi + 1}.</span> {question.prompt}
            </legend>

            {question.shape.kind === "multiple_choice" ? (
              <div className="space-y-1.5">
                {question.shape.options.map((option, oi) => {
                  const isCorrectOption = feedback?.correctIndex === oi;
                  return (
                    <label
                      key={`${question.id}-${oi}`}
                      className={`flex items-center gap-2 text-[13px] ${
                        isCorrectOption ? "text-[var(--color-good)]" : "text-[var(--color-ink-1)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`q-${question.id}`}
                        checked={
                          response?.kind === "multiple_choice" && response.selectedIndex === oi
                        }
                        onChange={() =>
                          setResponse(question.id, { kind: "multiple_choice", selectedIndex: oi })
                        }
                      />
                      {option}
                      {isCorrectOption ? (
                        <Check size={13} strokeWidth={2} aria-label="correct answer" />
                      ) : null}
                    </label>
                  );
                })}
              </div>
            ) : (
              <Input
                aria-label="Your answer"
                value={response?.kind === "short_answer" ? response.text : ""}
                onChange={(e) =>
                  setResponse(question.id, { kind: "short_answer", text: e.target.value })
                }
              />
            )}

            {feedback ? <QuestionFeedback answer={feedback} /> : null}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {graded.length > 0 ? (
          <span className="text-[12px] text-[var(--color-ink-2)]">
            {gradeable > 0
              ? `${correct} of ${gradeable} graded correct`
              : "Submitted — these answers aren't auto-graded"}
          </span>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={!canEdit || submit.isPending}
        >
          {submit.isPending ? "Submitting…" : graded.length > 0 ? "Resubmit" : "Submit answers"}
        </Button>
      </div>

      <div className="border-[var(--color-rule)] border-t pt-4">
        <PartCompleteButton
          completed={completed}
          disabled={!canEdit}
          pending={save.isPending}
          hint={lockReason ?? undefined}
          onToggle={() =>
            save.mutate(
              {
                partId: part.id,
                state: { kind: "quiz", completed: !completed, answers: answersRef.current },
              },
              { onError: () => toast.error("Couldn't update completion.") },
            )
          }
        />
      </div>
    </div>
  );
}

function QuestionFeedback({ answer }: { readonly answer: QuizAnswer }) {
  const icon =
    answer.result === "correct" ? (
      <Check size={13} strokeWidth={2} className="text-[var(--color-good)]" aria-hidden="true" />
    ) : answer.result === "incorrect" ? (
      <X size={13} strokeWidth={2} className="text-[var(--color-ink-2)]" aria-hidden="true" />
    ) : (
      <Minus size={13} strokeWidth={2} className="text-[var(--color-ink-3)]" aria-hidden="true" />
    );
  const label =
    answer.result === "correct"
      ? "Correct"
      : answer.result === "incorrect"
        ? "Not quite"
        : "Submitted";
  return (
    <div className="space-y-1 text-[12px]">
      <span className="inline-flex items-center gap-1.5 text-[var(--color-ink-2)]">
        {icon}
        {label}
      </span>
      {answer.explanation ? (
        <p className="text-[var(--color-ink-2)] leading-relaxed">{answer.explanation}</p>
      ) : null}
    </div>
  );
}

function responsesEqual(a: Response | undefined, b: Response): boolean {
  if (a === undefined) return false;
  if (a.kind === "multiple_choice" && b.kind === "multiple_choice") {
    return a.selectedIndex === b.selectedIndex;
  }
  if (a.kind === "short_answer" && b.kind === "short_answer") return a.text === b.text;
  return false;
}
