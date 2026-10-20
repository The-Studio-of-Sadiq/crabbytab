"use client";

import type { FeedbackAnswer, FeedbackQuestion } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { integerScaleChoices } from "@/lib/feedback/questions";
import { cn } from "@/components/ui/cn";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";

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
      <legend className="text-xs font-semibold text-fg">{t("feedbackQuestions.legend")}</legend>
      {questions.map((question) => {
        const id = `feedback-question-${question.id}`;
        const answer = answers[question.id];
        const requiredMark = question.required ? " *" : "";
        if (question.type === "checkbox") {
          return (
            <Checkbox
              key={question.id}
              id={id}
              required={question.required}
              checked={answer === true}
              onChange={(event) => onChange(question.id, event.target.checked)}
              label={`${question.label}${requiredMark}`}
            />
          );
        }
        if (question.type === "integer_scale") {
          return (
            <fieldset key={question.id} className="space-y-1.5">
              <legend className="block text-xs font-medium text-fg">
                {question.label}
                {requiredMark}
              </legend>
              <div id={id} className="flex flex-wrap gap-1.5">
                {integerScaleChoices(question).map((value) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs text-fg",
                      "focus-within:ring-2 focus-within:ring-accent",
                      answer === value ? "border-accent bg-accent-subtle" : "border-border-strong bg-surface hover:bg-muted"
                    )}
                  >
                    <input
                      type="radio"
                      name={id}
                      value={value}
                      required={question.required}
                      checked={answer === value}
                      onChange={() => onChange(question.id, value)}
                      className="accent-[rgb(var(--color-accent))] focus:outline-none"
                    />
                    {value}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        if (question.type === "select_many") {
          const selected = Array.isArray(answer) ? (answer as string[]) : [];
          return (
            <fieldset key={question.id} className="space-y-1.5">
              <legend className="block text-xs font-medium text-fg">
                {question.label}
                {requiredMark}
              </legend>
              <div id={id} className="space-y-1">
                {question.options?.map((option) => (
                  <Checkbox
                    key={option}
                    label={option}
                    checked={selected.includes(option)}
                    onChange={(event) =>
                      onChange(
                        question.id,
                        event.target.checked ? [...selected, option] : selected.filter((value) => value !== option)
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
          );
        }
        // Field primitives add the visible "*" for required controls themselves.
        const label = question.label;
        const textValue = typeof answer === "string" ? answer : "";
        const numberValue = typeof answer === "number" ? answer : "";
        switch (question.type) {
          case "text":
            return (
              <Input
                key={question.id}
                id={id}
                label={label}
                required={question.required}
                value={textValue}
                onChange={(event) => onChange(question.id, event.target.value)}
              />
            );
          case "textarea":
            return (
              <Textarea
                key={question.id}
                id={id}
                label={label}
                required={question.required}
                value={textValue}
                onChange={(event) => onChange(question.id, event.target.value)}
                rows={3}
              />
            );
          case "scale":
            return (
              <Input
                key={question.id}
                id={id}
                label={label}
                required={question.required}
                type="number"
                min={question.min}
                max={question.max}
                step="any"
                value={numberValue}
                onChange={(event) => onChange(question.id, numberAnswer(event.target.value))}
              />
            );
          case "integer":
          case "float":
            return (
              <Input
                key={question.id}
                id={id}
                label={label}
                required={question.required}
                type="number"
                inputMode={question.type === "integer" ? "numeric" : "decimal"}
                step={question.type === "integer" ? 1 : "any"}
                min={question.min}
                max={question.max}
                value={numberValue}
                onChange={(event) => onChange(question.id, numberAnswer(event.target.value))}
              />
            );
          case "yes_no":
            return (
              <Select
                key={question.id}
                id={id}
                label={label}
                required={question.required}
                value={typeof answer === "boolean" ? String(answer) : ""}
                onChange={(event) =>
                  onChange(question.id, event.target.value === "" ? null : event.target.value === "true")
                }
              >
                <option value="">{t("feedbackQuestions.choose")}</option>
                <option value="true">{t("feedbackQuestions.yes")}</option>
                <option value="false">{t("feedbackQuestions.no")}</option>
              </Select>
            );
          case "select_one":
            return (
              <Select
                key={question.id}
                id={id}
                label={label}
                required={question.required}
                value={textValue}
                onChange={(event) => onChange(question.id, event.target.value)}
              >
                <option value="">{t("feedbackQuestions.choose")}</option>
                {question.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            );
          default:
            return null;
        }
      })}
    </fieldset>
  );
}
