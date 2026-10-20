"use client";

import type { FeedbackAnswer, FeedbackQuestion } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { integerScaleChoices } from "@/lib/feedback/questions";

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
    <fieldset className="space-y-3 border-t border-gray-100 pt-3">
      <legend className="text-xs font-bold text-gray-800">{t("feedbackQuestions.legend")}</legend>
      {questions.map((question) => question.type === "checkbox" ? (
        <label key={question.id} className="flex items-start gap-2 text-xs font-semibold text-gray-700">
          <input
            id={`feedback-question-${question.id}`}
            type="checkbox"
            required={question.required}
            checked={answers[question.id] === true}
            onChange={(event) => onChange(question.id, event.target.checked)}
            className="mt-0.5"
          />
          <span>{question.label}{question.required ? " *" : ""}</span>
        </label>
      ) : question.type === "integer_scale" ? (
        <fieldset key={question.id} className="space-y-1">
          <legend className="block text-xs font-semibold text-gray-700">
            {question.label}{question.required ? " *" : ""}
          </legend>
          <div id={`feedback-question-${question.id}`} className="flex flex-wrap gap-1.5">
            {integerScaleChoices(question).map((value) => (
              <label
                key={value}
                className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs font-mono focus-within:ring-2 focus-within:ring-blue-500"
              >
                <input
                  type="radio"
                  name={`feedback-question-${question.id}`}
                  value={value}
                  required={question.required}
                  checked={answers[question.id] === value}
                  onChange={() => onChange(question.id, value)}
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <div key={question.id} className="space-y-1">
          <label htmlFor={`feedback-question-${question.id}`} className="block text-xs font-semibold text-gray-700">
            {question.label}{question.required ? " *" : ""}
          </label>
          {question.type === "text" && (
            <input
              id={`feedback-question-${question.id}`}
              required={question.required}
              value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""}
              onChange={(event) => onChange(question.id, event.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-xs"
            />
          )}
          {question.type === "textarea" && (
            <textarea
              id={`feedback-question-${question.id}`}
              required={question.required}
              value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""}
              onChange={(event) => onChange(question.id, event.target.value)}
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-xs"
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
              className="w-full rounded border border-gray-300 px-3 py-2 text-xs"
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
              className="w-full rounded border border-gray-300 px-3 py-2 text-xs"
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
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-xs"
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
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-xs"
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
                  <label key={option} className="flex items-center gap-2 text-xs font-normal">
                    <input
                      type="checkbox"
                      checked={selected.includes(option)}
                      onChange={(event) => onChange(
                        question.id,
                        event.target.checked ? [...selected, option] : selected.filter((value) => value !== option)
                      )}
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
