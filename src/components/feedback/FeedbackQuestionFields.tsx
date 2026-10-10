"use client";

import type { FeedbackAnswer, FeedbackQuestion } from "@/types";

export function FeedbackQuestionFields({
  questions,
  answers,
  onChange,
}: {
  questions: FeedbackQuestion[];
  answers: Record<string, FeedbackAnswer>;
  onChange: (questionId: string, value: FeedbackAnswer) => void;
}) {
  if (questions.length === 0) return null;

  return (
    <fieldset className="space-y-3 border-t border-gray-100 pt-3">
      <legend className="text-xs font-bold text-gray-800">Tournament questions</legend>
      {questions.map((question) => (
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
              value={typeof answers[question.id] === "number" ? answers[question.id] as number : ""}
              onChange={(event) => onChange(question.id, event.target.value === "" ? null : Number(event.target.value))}
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
              <option value="">Choose…</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
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
              <option value="">Choose…</option>
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
