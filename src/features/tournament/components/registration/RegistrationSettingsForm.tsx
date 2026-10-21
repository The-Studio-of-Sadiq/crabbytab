"use client";

import React, { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import type { FeedbackQuestion, FeedbackQuestionType } from "@/types";
import type { PersonField, RegistrationConfirmation, RegistrationSettings, TeamRegistrationField } from "@/lib/registration/types";
import type { CodeNameGenerator, TeamNameGenerator } from "@/lib/registration/names";
import { askedPersonFields, openRegistration, representativeRegistration } from "@/lib/registration/access";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Input, Select, Switch, Textarea } from "@/components/ui/Field";

const QUESTION_TYPES: Array<{ value: FeedbackQuestionType; label: MessageKey }> = [
  { value: "text", label: "setup.registration.qTypeText" },
  { value: "textarea", label: "setup.registration.qTypeTextarea" },
  { value: "yes_no", label: "setup.registration.qTypeYesNo" },
  { value: "select_one", label: "setup.registration.qTypeSelectOne" },
  { value: "select_many", label: "setup.registration.qTypeSelectMany" },
  { value: "scale", label: "setup.registration.qTypeScale" },
];

const CONFIRMATION_OPTIONS: Array<{ value: RegistrationConfirmation; label: MessageKey }> = [
  { value: "always", label: "setup.registration.confirmAlways" },
  { value: "open", label: "setup.registration.confirmOpen" },
  { value: "never", label: "setup.registration.confirmNever" },
];

const TEAM_NAME_OPTIONS: Array<{ value: TeamNameGenerator; label: MessageKey }> = [
  { value: "user", label: "setup.registration.teamNameUser" },
  { value: "alphabetical", label: "setup.registration.teamNameAlphabetical" },
  { value: "numerical", label: "setup.registration.teamNameNumerical" },
  { value: "initials", label: "setup.registration.teamNameInitials" },
];

const CODE_NAME_OPTIONS: Array<{ value: CodeNameGenerator; label: MessageKey }> = [
  { value: "user", label: "setup.registration.codeNameUser" },
  { value: "emoji", label: "setup.registration.codeNameEmoji" },
  { value: "last_names", label: "setup.registration.codeNameLastNames" },
];

const TEAM_FIELD_OPTIONS: Array<{ value: TeamRegistrationField; label: MessageKey }> = [
  { value: "use_institution_prefix", label: "setup.registration.teamFieldPrefix" },
  { value: "break_categories", label: "setup.registration.teamFieldBreakCategories" },
  { value: "seed", label: "setup.registration.teamFieldSeed" },
  { value: "emoji", label: "setup.registration.teamFieldEmoji" },
];

/** Tabbycat's "Customizable team fields" (reg_team_fields). */
function TeamFieldsEditor({
  settings,
  onChange,
}: {
  settings: RegistrationSettings;
  onChange: (fields: TeamRegistrationField[]) => void;
}) {
  const { t } = useI18n();
  const fields = settings.teamFields ?? [];
  const toggle = (field: TeamRegistrationField, checked: boolean) =>
    onChange(checked ? [...fields.filter((item) => item !== field), field] : fields.filter((item) => item !== field));
  const help: Partial<Record<TeamRegistrationField, string>> = {
    use_institution_prefix:
      (settings.teamNameGenerator ?? "user") === "user"
        ? t("setup.registration.teamFieldPrefixHelp")
        : t("setup.registration.teamFieldPrefixGenerated"),
    break_categories: t("setup.registration.teamFieldBreakCategoriesHelp", {
      count: (settings.teamBreakCategories ?? []).length,
    }),
    seed: t(settings.teamSeedMode === "title" ? "setup.registration.teamFieldSeedTitleHelp" : "setup.registration.teamFieldSeedHelp"),
    emoji: t("setup.registration.teamFieldEmojiHelp"),
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-fg">{t("setup.registration.teamFields")}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {TEAM_FIELD_OPTIONS.map((option) => (
          <Checkbox
            key={option.value}
            label={t(option.label)}
            description={help[option.value]}
            checked={fields.includes(option.value)}
            onChange={(event) => toggle(option.value, event.target.checked)}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Tabbycat's reg_speaker_fields / reg_adjudicator_fields: email (and categories) can be switched off. */
function PersonFieldsEditor({
  legend,
  fields,
  onChange,
  email,
  onEmailChange,
  categories,
  onCategoriesChange,
}: {
  legend: string;
  fields: PersonField[];
  onChange: (fields: PersonField[]) => void;
  email: boolean;
  onEmailChange: (asked: boolean) => void;
  categories?: boolean;
  onCategoriesChange?: (asked: boolean) => void;
}) {
  const { t } = useI18n();
  const toggle = (field: PersonField, checked: boolean) =>
    onChange(checked ? [...fields.filter((item) => item !== field), field] : fields.filter((item) => item !== field));
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-fg">{legend}</legend>
      <div className="flex flex-wrap gap-6">
        <Checkbox label={t("setup.registration.emailField")} checked={email} onChange={(event) => onEmailChange(event.target.checked)} />
        {categories !== undefined && onCategoriesChange && (
          <Checkbox
            label={t("setup.registration.categoriesField")}
            checked={categories}
            onChange={(event) => onCategoriesChange(event.target.checked)}
          />
        )}
        <Checkbox label={t("setup.registration.phoneNumber")} checked={fields.includes("phone")} onChange={(event) => toggle("phone", event.target.checked)} />
        <Checkbox label={t("setup.registration.genderSelfDescribed")} checked={fields.includes("gender")} onChange={(event) => toggle("gender", event.target.checked)} />
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
  const { t } = useI18n();
  const update = (index: number, change: Partial<FeedbackQuestion>) =>
    onChange(questions.map((question, position) => (position === index ? { ...question, ...change } : question)));
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold text-fg">{title}</legend>
      {questions.length === 0 && <p className="text-xs text-fg-muted">{t("setup.registration.noQuestions")}</p>}
      {questions.map((question, index) => (
        <div key={question.id} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_10rem_auto]">
          <Input label={t("setup.registration.question")} value={question.label} maxLength={200} onChange={(event) => update(index, { label: event.target.value })} />
          <Select
            label={t("setup.registration.answerType")}
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
              <option key={option.value} value={option.value}>{t(option.label)}</option>
            ))}
          </Select>
          <div className="flex items-end">
            <IconButton icon={<Trash2 />} label={t("setup.registration.removeQuestion", { number: index + 1 })} onClick={() => onChange(questions.filter((_, position) => position !== index))} />
          </div>
          {(question.type === "select_one" || question.type === "select_many") && (
            <Input
              label={t("setup.registration.optionsComma")}
              wrapperClassName="sm:col-span-2"
              value={(question.options ?? []).join(", ")}
              onChange={(event) => update(index, { options: event.target.value.split(",").map((option) => option.trim()) })}
            />
          )}
          {question.type === "scale" && (
            <div className="flex gap-2 sm:col-span-2">
              <Input label={t("setup.registration.minimum")} type="number" value={question.min ?? ""} onChange={(event) => update(index, { min: Number(event.target.value) })} />
              <Input label={t("setup.registration.maximum")} type="number" value={question.max ?? ""} onChange={(event) => update(index, { max: Number(event.target.value) })} />
            </div>
          )}
          <Checkbox
            label={t("setup.common.required")}
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
        {t("setup.registration.addQuestion")}
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
  const { t } = useI18n();
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
        coachQuestions: clean(settings.coachQuestions ?? []),
        speakerQuestions: clean(settings.speakerQuestions ?? []),
      });
      setMessage(t("setup.registration.settingsSaved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("setup.registration.settingsSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <Card>
        <CardHeader title={t("setup.registration.publicTitle")} description={t("setup.registration.publicDescription")} />
        <CardBody className="space-y-4">
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
            label={t("setup.registration.acceptRegistrations")}
            description={t("setup.registration.acceptRegistrationsHelp")}
          />
          {publicLink && (
            <div className="flex flex-wrap items-end gap-2">
              <Input label={t("setup.registration.publicForm")} readOnly value={publicLink} wrapperClassName="min-w-0 flex-1" onFocus={(event) => event.currentTarget.select()} />
              <Button onClick={() => void navigator.clipboard?.writeText(publicLink)}>
                <Copy aria-hidden="true" />
                {t("setup.common.copy")}
              </Button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t("setup.registration.opens")}
              type="datetime-local"
              help={t("setup.registration.opensHelp")}
              value={toLocalInput(settings.opensAt)}
              onChange={(event) => set({ opensAt: fromLocalInput(event.target.value) })}
            />
            <Input
              label={t("setup.registration.closes")}
              type="datetime-local"
              help={t("setup.registration.closesHelp")}
              value={toLocalInput(settings.closesAt)}
              onChange={(event) => set({ closesAt: fromLocalInput(event.target.value) })}
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <Checkbox label={t("setup.registration.teamsCanRegister")} checked={settings.teamRegistration} onChange={(event) => set({ teamRegistration: event.target.checked })} />
            <Checkbox
              label={t("setup.registration.adjudicatorsCanRegister")}
              checked={settings.adjudicatorRegistration}
              onChange={(event) => set({ adjudicatorRegistration: event.target.checked })}
            />
            <Checkbox
              label={t("setup.registration.institutionsCanRegister")}
              description={t("setup.registration.institutionsCanRegisterHelp")}
              checked={settings.institutionRegistration === true}
              onChange={(event) => set({ institutionRegistration: event.target.checked })}
            />
          </div>
          {/* Tabbycat open_team_registration / open_adj_registration / institution_participant_registration. */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-fg">{t("setup.registration.channelsLegend")}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Checkbox
                label={t("setup.registration.openTeamRegistration")}
                description={t("setup.registration.openTeamRegistrationHelp")}
                checked={openRegistration(settings, "team")}
                onChange={(event) => set({ openTeamRegistration: event.target.checked })}
              />
              <Checkbox
                label={t("setup.registration.openAdjudicatorRegistration")}
                description={t("setup.registration.openAdjudicatorRegistrationHelp")}
                checked={openRegistration(settings, "adjudicator")}
                onChange={(event) => set({ openAdjudicatorRegistration: event.target.checked })}
              />
              <Checkbox
                label={t("setup.registration.institutionParticipantRegistration")}
                description={t("setup.registration.institutionParticipantRegistrationHelp")}
                checked={representativeRegistration(settings)}
                onChange={(event) => set({ institutionParticipantRegistration: event.target.checked })}
              />
            </div>
          </fieldset>
          <Textarea
            label={t("setup.registration.instructions")}
            rows={3}
            maxLength={4000}
            value={settings.instructions}
            onChange={(event) => set({ instructions: event.target.value })}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("setup.registration.limitsTitle")} description={t("setup.registration.limitsDescription")} />
        <CardBody className="grid gap-3 sm:grid-cols-3">
          <Input label={t("setup.registration.minSpeakers")} type="number" min={1} max={6} value={settings.minSpeakers} onChange={(event) => set({ minSpeakers: number(event.target.value) })} />
          <Input label={t("setup.registration.maxSpeakers")} type="number" min={1} max={6} value={settings.maxSpeakers} onChange={(event) => set({ maxSpeakers: number(event.target.value) })} />
          <Input
            label={t("setup.registration.speakerCategories")}
            help={t("setup.registration.speakerCategoriesHelp")}
            value={categories}
            onChange={(event) => setCategories(event.target.value)}
          />
          <Input label={t("setup.registration.teamsPerInstitution")} type="number" min={0} value={settings.teamQuotaPerInstitution} onChange={(event) => set({ teamQuotaPerInstitution: number(event.target.value) })} />
          <Input
            label={t("setup.registration.adjudicatorsPerInstitution")}
            type="number"
            min={0}
            value={settings.adjudicatorQuotaPerInstitution}
            onChange={(event) => set({ adjudicatorQuotaPerInstitution: number(event.target.value) })}
          />
          <span className="hidden sm:block" />
          <Input label={t("setup.registration.maxTeams")} type="number" min={0} value={settings.maxTeams} onChange={(event) => set({ maxTeams: number(event.target.value) })} />
          <Input label={t("setup.registration.maxAdjudicators")} type="number" min={0} value={settings.maxAdjudicators} onChange={(event) => set({ maxAdjudicators: number(event.target.value) })} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("setup.registration.acceptanceTitle")} description={t("setup.registration.acceptanceDescription")} />
        <CardBody className="space-y-4">
          <Select
            label={t("setup.registration.confirmation")}
            help={t("setup.registration.confirmationHelp")}
            value={settings.confirmation ?? "always"}
            onChange={(event) => set({ confirmation: event.target.value as RegistrationConfirmation })}
          >
            {CONFIRMATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{t(option.label)}</option>
            ))}
          </Select>
          <Checkbox
            label={t("setup.registration.blockOverAllocation")}
            description={t("setup.registration.blockOverAllocationHelp")}
            checked={settings.blockOverAllocation !== false}
            onChange={(event) => set({ blockOverAllocation: event.target.checked })}
          />
          <Checkbox
            label={t("setup.registration.slotTransfers")}
            description={t("setup.registration.slotTransfersHelp")}
            checked={settings.slotTransfers === true}
            onChange={(event) => set({ slotTransfers: event.target.checked })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={t("setup.registration.teamNames")} value={settings.teamNameGenerator ?? "user"} onChange={(event) => set({ teamNameGenerator: event.target.value as TeamNameGenerator })}>
              {TEAM_NAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{t(option.label)}</option>
              ))}
            </Select>
            <Select label={t("setup.registration.codeNames")} value={settings.codeNameGenerator ?? "user"} onChange={(event) => set({ codeNameGenerator: event.target.value as CodeNameGenerator })}>
              {CODE_NAME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{t(option.label)}</option>
              ))}
            </Select>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("setup.registration.fieldsTitle")} description={t("setup.registration.fieldsDescription")} />
        <CardBody className="space-y-4">
          <TeamFieldsEditor settings={settings} onChange={(teamFields) => set({ teamFields })} />
          <PersonFieldsEditor
            legend={t("setup.registration.speakers")}
            fields={settings.speakerFields ?? []}
            onChange={(speakerFields) => set({ speakerFields })}
            email={askedPersonFields(settings).speakerEmail}
            onEmailChange={(askSpeakerEmail) => set({ askSpeakerEmail })}
            categories={askedPersonFields(settings).speakerCategories}
            onCategoriesChange={(askSpeakerCategories) => set({ askSpeakerCategories })}
          />
          <PersonFieldsEditor
            legend={t("setup.registration.adjudicators")}
            fields={settings.adjudicatorFields ?? []}
            onChange={(adjudicatorFields) => set({ adjudicatorFields })}
            email={askedPersonFields(settings).adjudicatorEmail}
            onEmailChange={(askAdjudicatorEmail) => set({ askAdjudicatorEmail })}
          />
          <Checkbox
            label={t("setup.registration.institutionRegion")}
            checked={settings.institutionRegion === true}
            onChange={(event) => set({ institutionRegion: event.target.checked })}
          />
          <Textarea label={t("setup.registration.teamMessage")} rows={2} maxLength={4000} value={settings.teamMessage ?? ""} onChange={(event) => set({ teamMessage: event.target.value })} />
          <Textarea
            label={t("setup.registration.adjudicatorMessage")}
            rows={2}
            maxLength={4000}
            value={settings.adjudicatorMessage ?? ""}
            onChange={(event) => set({ adjudicatorMessage: event.target.value })}
          />
          <Textarea
            label={t("setup.registration.institutionMessage")}
            rows={2}
            maxLength={4000}
            value={settings.institutionMessage ?? ""}
            onChange={(event) => set({ institutionMessage: event.target.value })}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("setup.registration.questionsTitle")} description={t("setup.registration.questionsDescription")} />
        <CardBody className="space-y-5">
          <QuestionsEditor title={t("setup.registration.questionsTeam")} questions={settings.teamQuestions} onChange={(teamQuestions) => set({ teamQuestions })} />
          <QuestionsEditor
            title={t("setup.registration.questionsAdjudicator")}
            questions={settings.adjudicatorQuestions}
            onChange={(adjudicatorQuestions) => set({ adjudicatorQuestions })}
          />
          <QuestionsEditor
            title={t("setup.registration.questionsSpeaker")}
            questions={settings.speakerQuestions ?? []}
            onChange={(speakerQuestions) => set({ speakerQuestions })}
          />
          <QuestionsEditor
            title={t("setup.registration.questionsInstitution")}
            questions={settings.institutionQuestions ?? []}
            onChange={(institutionQuestions) => set({ institutionQuestions })}
          />
          <QuestionsEditor
            title={t("setup.registration.questionsCoach")}
            questions={settings.coachQuestions ?? []}
            onChange={(coachQuestions) => set({ coachQuestions })}
          />
        </CardBody>
      </Card>

      {error && <Alert tone="danger" role="alert">{error}</Alert>}
      {message && <Alert tone="success" role="status">{message}</Alert>}
      <Button type="submit" variant="primary" loading={saving}>{t("setup.registration.saveSettings")}</Button>
    </form>
  );
}
