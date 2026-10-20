"use client";

import React, { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { FeedbackQuestion, FeedbackQuestionType } from "@/types";
import type { PersonField, RegistrationConfirmation, RegistrationSettings } from "@/lib/registration/types";
import type { CodeNameGenerator, TeamNameGenerator } from "@/lib/registration/names";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Input, Select, Switch, Textarea } from "@/components/ui/Field";

const QUESTION_TYPES: Array<{ value: FeedbackQuestionType; label: string }> = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "yes_no", label: "Yes / no" },
  { value: "select_one", label: "Choose one" },
  { value: "select_many", label: "Choose several" },
  { value: "scale", label: "Number scale" },
];

const CONFIRMATION_OPTIONS: Array<{ value: RegistrationConfirmation; label: string }> = [
  { value: "always", label: "Always: every registration waits in the queue" },
  { value: "open", label: "Only open registrations: representative-link registrations are accepted at once" },
  { value: "never", label: "Never: every team and adjudicator registration is accepted at once" },
];

const TEAM_NAME_OPTIONS: Array<{ value: TeamNameGenerator; label: string }> = [
  { value: "user", label: "As registered" },
  { value: "alphabetical", label: "Institution + letter (Oxford A, Oxford B, …)" },
  { value: "numerical", label: "Institution + number (Oxford 1, Oxford 2, …)" },
  { value: "initials", label: "Institution + speaker initials (Oxford SJ, …)" },
];

const CODE_NAME_OPTIONS: Array<{ value: CodeNameGenerator; label: string }> = [
  { value: "user", label: "None (set by hand)" },
  { value: "emoji", label: "Emoji" },
  { value: "last_names", label: "Speakers' last names (Jones & Smith)" },
];

function PersonFieldsEditor({
  legend,
  fields,
  onChange,
}: {
  legend: string;
  fields: PersonField[];
  onChange: (fields: PersonField[]) => void;
}) {
  const toggle = (field: PersonField, checked: boolean) =>
    onChange(checked ? [...fields.filter((item) => item !== field), field] : fields.filter((item) => item !== field));
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-fg">{legend}</legend>
      <div className="flex flex-wrap gap-6">
        <Checkbox label="Phone number" checked={fields.includes("phone")} onChange={(event) => toggle("phone", event.target.checked)} />
        <Checkbox label="Gender (self-described)" checked={fields.includes("gender")} onChange={(event) => toggle("gender", event.target.checked)} />
      </div>
    </fieldset>
  );
}

/** ISO time → value for <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function QuestionsEditor({
  title,
  questions,
  onChange,
}: {
  title: string;
  questions: FeedbackQuestion[];
  onChange: (questions: FeedbackQuestion[]) => void;
}) {
  const update = (index: number, change: Partial<FeedbackQuestion>) =>
    onChange(questions.map((question, position) => (position === index ? { ...question, ...change } : question)));
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold text-fg">{title}</legend>
      {questions.length === 0 && <p className="text-xs text-fg-muted">No extra questions.</p>}
      {questions.map((question, index) => (
        <div key={question.id} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_10rem_auto]">
          <Input label="Question" value={question.label} maxLength={200} onChange={(event) => update(index, { label: event.target.value })} />
          <Select
            label="Answer type"
            value={question.type}
            onChange={(event) => {
              const type = event.target.value as FeedbackQuestionType;
              update(index, {
                type,
                options: type === "select_one" || type === "select_many" ? question.options ?? [] : undefined,
                min: type === "scale" ? question.min ?? 1 : undefined,
                max: type === "scale" ? question.max ?? 5 : undefined,
              });
            }}
          >
            {QUESTION_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <div className="flex items-end">
            <IconButton icon={<Trash2 />} label={`Remove question ${index + 1}`} onClick={() => onChange(questions.filter((_, position) => position !== index))} />
          </div>
          {(question.type === "select_one" || question.type === "select_many") && (
            <Input
              label="Options (comma-separated)"
              wrapperClassName="sm:col-span-2"
              value={(question.options ?? []).join(", ")}
              onChange={(event) => update(index, { options: event.target.value.split(",").map((option) => option.trim()) })}
            />
          )}
          {question.type === "scale" && (
            <div className="flex gap-2 sm:col-span-2">
              <Input label="Minimum" type="number" value={question.min ?? ""} onChange={(event) => update(index, { min: Number(event.target.value) })} />
              <Input label="Maximum" type="number" value={question.max ?? ""} onChange={(event) => update(index, { max: Number(event.target.value) })} />
            </div>
          )}
          <Checkbox
            label="Required"
            checked={question.required}
            onChange={(event) => update(index, { required: event.target.checked })}
          />
        </div>
      ))}
      <Button
        size="sm"
        onClick={() =>
          onChange([
            ...questions,
            { id: `q${Date.now().toString(36)}`, label: "", type: "text", required: false },
          ])
        }
      >
        <Plus aria-hidden="true" />
        Add question
      </Button>
    </fieldset>
  );
}

export function RegistrationSettingsForm({
  initial,
  publicLink,
  onSave,
}: {
  initial: RegistrationSettings;
  publicLink: string;
  onSave: (settings: RegistrationSettings) => Promise<void>;
}) {
  const [settings, setSettings] = useState<RegistrationSettings>(initial);
  const [categories, setCategories] = useState(initial.speakerCategories.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const set = (change: Partial<RegistrationSettings>) => setSettings((current) => ({ ...current, ...change }));
  const number = (value: string) => (value === "" ? 0 : Number(value));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      // Options typed with trailing commas leave empty entries; drop them before validation.
      const clean = (questions: FeedbackQuestion[]) =>
        questions.map((question) => (question.options ? { ...question, options: question.options.filter(Boolean) } : question));
      await onSave({
        ...settings,
        speakerCategories: categories.split(",").map((item) => item.trim()).filter(Boolean),
        teamQuestions: clean(settings.teamQuestions),
        adjudicatorQuestions: clean(settings.adjudicatorQuestions),
        institutionQuestions: clean(settings.institutionQuestions ?? []),
        speakerQuestions: clean(settings.speakerQuestions ?? []),
      });
      setMessage("Registration settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save registration settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <Card>
        <CardHeader title="Public registration" description="Registrations wait in the review queue; nothing is added to the tournament until an administrator approves it." />
        <CardBody className="space-y-4">
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
            label="Accept registrations"
            description="While off, the public form says registration is not open."
          />
          {publicLink && (
            <div className="flex flex-wrap items-end gap-2">
              <Input label="Public form" readOnly value={publicLink} wrapperClassName="min-w-0 flex-1" onFocus={(event) => event.currentTarget.select()} />
              <Button onClick={() => void navigator.clipboard?.writeText(publicLink)}>
                <Copy aria-hidden="true" />
                Copy
              </Button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Opens"
              type="datetime-local"
              help="Empty: open as soon as registration is accepted."
              value={toLocalInput(settings.opensAt)}
              onChange={(event) => set({ opensAt: fromLocalInput(event.target.value) })}
            />
            <Input
              label="Closes"
              type="datetime-local"
              help="Empty: open until switched off."
              value={toLocalInput(settings.closesAt)}
              onChange={(event) => set({ closesAt: fromLocalInput(event.target.value) })}
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <Checkbox label="Teams can register" checked={settings.teamRegistration} onChange={(event) => set({ teamRegistration: event.target.checked })} />
            <Checkbox
              label="Adjudicators can register"
              checked={settings.adjudicatorRegistration}
              onChange={(event) => set({ adjudicatorRegistration: event.target.checked })}
            />
            <Checkbox
              label="Institutions can register"
              description="An institution (or its coach) asks for places; approving gives the places and sends the coach a representative link."
              checked={settings.institutionRegistration === true}
              onChange={(event) => set({ institutionRegistration: event.target.checked })}
            />
            <Checkbox
              label="Institution representatives only"
              description="Only people with a representative link can register."
              checked={settings.representativesOnly}
              onChange={(event) => set({ representativesOnly: event.target.checked })}
            />
          </div>
          <Textarea
            label="Instructions shown on the form"
            rows={3}
            maxLength={4000}
            value={settings.instructions}
            onChange={(event) => set({ instructions: event.target.value })}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Teams and limits" description="Limits count submissions that are not rejected. 0 means no limit." />
        <CardBody className="grid gap-3 sm:grid-cols-3">
          <Input label="Minimum speakers" type="number" min={1} max={6} value={settings.minSpeakers} onChange={(event) => set({ minSpeakers: number(event.target.value) })} />
          <Input label="Maximum speakers" type="number" min={1} max={6} value={settings.maxSpeakers} onChange={(event) => set({ maxSpeakers: number(event.target.value) })} />
          <Input
            label="Speaker categories"
            help="Comma-separated, e.g. ESL, Novice"
            value={categories}
            onChange={(event) => setCategories(event.target.value)}
          />
          <Input label="Teams per institution" type="number" min={0} value={settings.teamQuotaPerInstitution} onChange={(event) => set({ teamQuotaPerInstitution: number(event.target.value) })} />
          <Input
            label="Adjudicators per institution"
            type="number"
            min={0}
            value={settings.adjudicatorQuotaPerInstitution}
            onChange={(event) => set({ adjudicatorQuotaPerInstitution: number(event.target.value) })}
          />
          <span className="hidden sm:block" />
          <Input label="Maximum teams" type="number" min={0} value={settings.maxTeams} onChange={(event) => set({ maxTeams: number(event.target.value) })} />
          <Input label="Maximum adjudicators" type="number" min={0} value={settings.maxAdjudicators} onChange={(event) => set({ maxAdjudicators: number(event.target.value) })} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Acceptance, places and names" description="How registrations are confirmed, how institution places work, and how teams are named." />
        <CardBody className="space-y-4">
          <Select
            label="Registration confirmation"
            help="Accepted registrations are added to the tournament by the server straight away (cloud tournaments with live updates)."
            value={settings.confirmation ?? "always"}
            onChange={(event) => set({ confirmation: event.target.value as RegistrationConfirmation })}
          >
            {CONFIRMATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <Checkbox
            label="Refuse registrations above an institution's places"
            description="Off: registrations above the places are accepted into the queue and flagged, and the tournament-wide limits still apply."
            checked={settings.blockOverAllocation !== false}
            onChange={(event) => set({ blockOverAllocation: event.target.checked })}
          />
          <Checkbox
            label="Representatives can transfer places"
            description="A representative can ask to give team or adjudicator places to another institution; you approve each transfer."
            checked={settings.slotTransfers === true}
            onChange={(event) => set({ slotTransfers: event.target.checked })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Team names" value={settings.teamNameGenerator ?? "user"} onChange={(event) => set({ teamNameGenerator: event.target.value as TeamNameGenerator })}>
              {TEAM_NAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
            <Select label="Code names" value={settings.codeNameGenerator ?? "user"} onChange={(event) => set({ codeNameGenerator: event.target.value as CodeNameGenerator })}>
              {CODE_NAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Form fields and messages" description="Extra person fields are copied to the speaker or adjudicator on approval (phone for contact; gender for the diversity page)." />
        <CardBody className="space-y-4">
          <PersonFieldsEditor legend="Speakers" fields={settings.speakerFields ?? []} onChange={(speakerFields) => set({ speakerFields })} />
          <PersonFieldsEditor legend="Adjudicators" fields={settings.adjudicatorFields ?? []} onChange={(adjudicatorFields) => set({ adjudicatorFields })} />
          <Checkbox
            label="Ask institutions for their region"
            checked={settings.institutionRegion === true}
            onChange={(event) => set({ institutionRegion: event.target.checked })}
          />
          <Textarea label="Message on the team form" rows={2} maxLength={4000} value={settings.teamMessage ?? ""} onChange={(event) => set({ teamMessage: event.target.value })} />
          <Textarea
            label="Message on the adjudicator form"
            rows={2}
            maxLength={4000}
            value={settings.adjudicatorMessage ?? ""}
            onChange={(event) => set({ adjudicatorMessage: event.target.value })}
          />
          <Textarea
            label="Message on the institution form"
            rows={2}
            maxLength={4000}
            value={settings.institutionMessage ?? ""}
            onChange={(event) => set({ institutionMessage: event.target.value })}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Custom questions" description="Asked on the public form in addition to names, emails and conflicts." />
        <CardBody className="space-y-5">
          <QuestionsEditor title="Team registration" questions={settings.teamQuestions} onChange={(teamQuestions) => set({ teamQuestions })} />
          <QuestionsEditor
            title="Adjudicator registration"
            questions={settings.adjudicatorQuestions}
            onChange={(adjudicatorQuestions) => set({ adjudicatorQuestions })}
          />
          <QuestionsEditor
            title="Each speaker (asked once per speaker on the team form)"
            questions={settings.speakerQuestions ?? []}
            onChange={(speakerQuestions) => set({ speakerQuestions })}
          />
          <QuestionsEditor
            title="Institution registration"
            questions={settings.institutionQuestions ?? []}
            onChange={(institutionQuestions) => set({ institutionQuestions })}
          />
        </CardBody>
      </Card>

      {error && <Alert tone="danger" role="alert">{error}</Alert>}
      {message && <Alert tone="success" role="status">{message}</Alert>}
      <Button type="submit" variant="primary" loading={saving}>Save registration settings</Button>
    </form>
  );
}
