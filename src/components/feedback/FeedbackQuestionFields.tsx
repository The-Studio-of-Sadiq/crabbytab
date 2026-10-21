"use client";

import type { FeedbackAnswer, FeedbackQuestion } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { integerScaleChoices } from "@/lib/feedback/questions";
import { controlClasses } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

const labelClasses = "block text-xs font-medium text-fg";
const fieldClasses = cn(controlClasses, "h-8 px-2.5");
const choiceInputClasses = "h-4 w-4 shrink-0 cursor-pointer accent-[rgb(var(--color-accent))]";

function RequiredMark({ required }: { required?: boolean }) {
  return required ? <span className="ms-0.5 text-fg-muted">*</span> : null;
}

/** An empty box clears the answer; anything else is kept as typed so validation can name the problem. */
function numberAnswer(value: string): FeedbackAnswer {
  return value === "" ? null : Number(value);
}

export function FeedbackQuestionFields({
  questions,
  answers,
  onChange,
}: {
  questions: FeedbackQuestion[];
  answers: Record<string, FeedbackAnswer>;
  onChange: (questionId: string, value: FeedbackAnswer) => void;
}) {
  const { t } = useI18n();
  if (questions.length === 0) return null;

  return (
    <fieldset className="space-y-3 border-t border-border pt-3">
      <legend className="text-[13px] font-semibold text-fg">{t("feedbackQuestions.legend")}</legend>
      {questions.map((question) => question.type === "checkbox" ? (
        <label key={question.id} className="flex items-start gap-2 text-[13px] font-medium text-fg">
          <input
            id={`feedback-question-${question.id}`}
            type="checkbox"
            required={question.required}
            checked={answers[question.id] === true}
            onChange={(event) => onChange(question.id, event.target.checked)}
            className={cn(choiceInputClasses, "mt-0.5", focusRing)}
          />
          <span>{question.label}<RequiredMark required={question.required} /></span>
        </label>
      ) : question.type === "integer_scale" ? (
        <fieldset key={question.id} className="space-y-1.5">
          <legend className={labelClasses}>
            {question.label}<RequiredMark required={question.required} />
          </legend>
          <div id={`feedback-question-${question.id}`} className="flex flex-wrap gap-1.5">
            {integerScaleChoices(question).map((value) => (
              <label
                key={value}
                className="flex h-8 min-w-8 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 font-mono text-xs text-fg hover:bg-muted has-[:checked]:border-accent has-[:checked]:bg-accent-subtle focus-within:ring-2 focus-within:ring-accent"
              >
                <input
                  type="radio"
                  name={`feedback-question-${question.id}`}
                  value={value}
                  required={question.required}
                  checked={answers[question.id] === value}
                  onChange={() => onChange(question.id, value)}
                  className={cn(choiceInputClasses, "focus:outline-none")}
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <div key={question.id} className="space-y-1.5">
          <label htmlFor={`feedback-question-${question.id}`} className={labelClasses}>
            {question.label}<RequiredMark required={question.required} />
          </label>
          {question.type === "text" && (
            <input
              id={`feedback-question-${question.id}`}
              required={question.required}
              value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""}
              onChange={(event) => onChange(question.id, event.target.value)}
              className={fieldClasses}
            />
          )}
          {question.type === "textarea" && (
            <textarea
              id={`feedback-question-${question.id}`}
              required={question.required}
              value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""}
              onChange={(event) => onChange(question.id, event.target.value)}
              rows={3}
              className={cn(controlClasses, "px-2.5 py-2")}
            />
          )}
          {question.type === "scale" && (
            <input
              id={`feedback-question-${question.id}`}
              required={question.required}
              type="number"
              min={question.min}
              max={question.max}
              step="any"
              value={typeof answers[question.id] === "number" ? answers[question.id] as number : ""}
              onChange={(event) => onChange(question.id, numberAnswer(event.target.value))}
              className={fieldClasses}
            />
          )}
          {(question.type === "integer" || question.type === "float") && (
            <input
              id={`feedback-question-${question.id}`}
              required={question.required}
              type="number"
              inputMode={question.type === "integer" ? "numeric" : "decimal"}
              step={question.type === "integer" ? 1 : "any"}
              min={question.min}
              max={question.max}
              value={typeof answers[question.id] === "number" ? answers[question.id] as number : ""}
              onChange={(event) => onChange(question.id, numberAnswer(event.target.value))}
              className={fieldClasses}
            />
          )}
          {question.type === "yes_no" && (
            <select
              id={`feedback-question-${question.id}`}
              required={question.required}
              value={typeof answers[question.id] === "boolean" ? String(answers[question.id]) : ""}
              onChange={(event) => onChange(
                question.id,
                event.target.value === "" ? null : event.target.value === "true"
              )}
              className={cn(controlClasses, "h-8 pe-8 ps-2.5")}
            >
              <option value="">{t("feedbackQuestions.choose")}</option>
              <option value="true">{t("feedbackQuestions.yes")}</option>
              <option value="false">{t("feedbackQuestions.no")}</option>
            </select>
          )}
          {question.type === "select_one" && (
            <select
              id={`feedback-question-${question.id}`}
              required={question.required}
              value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""}
              onChange={(event) => onChange(question.id, event.target.value)}
              className={cn(controlClasses, "h-8 pe-8 ps-2.5")}
            >
              <option value="">{t("feedbackQuestions.choose")}</option>
              {question.options?.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          )}
          {question.type === "select_many" && (
            <div id={`feedback-question-${question.id}`} className="space-y-1">
              {question.options?.map((option) => {
                const selected = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : [];
                return (
                  <label key={option} className="flex items-center gap-2 text-[13px] text-fg">
                    <input
                      type="checkbox"
                      checked={selected.includes(option)}
                      onChange={(event) => onChange(
                        question.id,
                        event.target.checked ? [...selected, option] : selected.filter((value) => value !== option)
                      )}
                      className={cn(choiceInputClasses, focusRing)}
                    />
                    {option}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </fieldset>
  );
}
