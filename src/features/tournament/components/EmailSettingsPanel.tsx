"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Switch, Textarea } from "@/components/ui/Field";
import { Alert, Skeleton } from "@/components/ui/Feedback";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  TEMPLATE_EVENT_INFO,
  TEMPLATE_EVENTS,
  type EmailTemplate,
  type TemplateEvent,
  type TournamentEmailSettings,
} from "@/lib/email/settings";

/** Events with no automatic trigger: their templates are sent from the compose form. */
export type ManualTemplateEvent = "private_url" | "feedback_url" | "team_registration";

function isManualTemplateEvent(event: TemplateEvent): event is ManualTemplateEvent {
  return event === "private_url" || event === "feedback_url" || event === "team_registration";
}

const COMMON_VARIABLES = ["name", "email", "tournament", "round", "institution"];

/** Translated labels for TEMPLATE_EVENT_INFO; the English originals there are used by the server. */
const EVENT_LABELS: Record<TemplateEvent, { label: MessageKey; when: MessageKey }> = {
  draw_teams: { label: "setup.email.eventDrawTeams", when: "setup.email.eventDrawTeamsWhen" },
  draw_adjudicators: { label: "setup.email.eventDrawAdjudicators", when: "setup.email.eventDrawAdjudicatorsWhen" },
  team_points: { label: "setup.email.eventTeamPoints", when: "setup.email.eventTeamPointsWhen" },
  ballot_receipt: { label: "setup.email.eventBallotReceipt", when: "setup.email.eventBallotReceiptWhenAll" },
  ballot_confirmed: { label: "setup.email.eventBallotConfirmed", when: "setup.email.eventBallotConfirmedWhen" },
  motions_released: { label: "setup.email.eventMotionsReleased", when: "setup.email.eventMotionsReleasedWhen" },
  private_url: { label: "setup.email.eventPrivateUrl", when: "setup.email.eventPrivateUrlWhen" },
  feedback_url: { label: "setup.email.eventFeedbackUrl", when: "setup.email.eventFeedbackUrlWhen" },
  team_registration: { label: "setup.email.eventTeamRegistration", when: "setup.email.eventTeamRegistrationWhen" },
  registration_received: {
    label: "setup.email.eventRegistrationReceived",
    when: "setup.email.eventRegistrationReceivedWhen",
  },
  registration_approved: {
    label: "setup.email.eventRegistrationApproved",
    when: "setup.email.eventRegistrationApprovedWhen",
  },
  slots_allocated: { label: "setup.email.eventSlotsAllocated", when: "setup.email.eventSlotsAllocatedWhen" },
  institution_registered: {
    label: "setup.email.eventInstitutionRegistered",
    when: "setup.email.eventInstitutionRegisteredWhen",
  },
};

/**
 * Reply-To and the saved template of every automatic email (docs/email-notifications.md). Saved on
 * the server at once; nothing here waits for an upload.
 */
export function EmailSettingsPanel({
  tournamentId,
  user,
  onUseTemplate,
}: {
  tournamentId: string;
  user: User;
  /** Manual events (private URL, feedback URL, team registration) are sent from the compose form. */
  onUseTemplate?: (template: EmailTemplate, event: ManualTemplateEvent) => void;
}) {
  const [settings, setSettings] = useState<TournamentEmailSettings | null>(null);
  const [defaults, setDefaults] = useState<Record<TemplateEvent, EmailTemplate> | null>(null);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [event, setEvent] = useState<TemplateEvent>("draw_teams");
  const [saving, setSaving] = useState(false);
  // `text` is a server message shown as written; without one the translated `fallback` is shown.
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string; fallback: MessageKey } | null>(null);
  const { t } = useI18n();

  const load = useCallback(async () => {
    setStatus(null);
    try {
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournamentId)}/email/settings`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        cache: "no-store",
      });
      const result = await response.json() as {
        error?: string;
        settings?: TournamentEmailSettings;
        defaults?: Record<TemplateEvent, EmailTemplate>;
        webhookConfigured?: boolean;
      };
      if (!response.ok || !result.settings || !result.defaults) throw new Error(result.error || "");
      setSettings(result.settings);
      setDefaults(result.defaults);
      setWebhookConfigured(result.webhookConfigured === true);
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "",
        fallback: "setup.email.settingsLoadFailed",
      });
    }
  }, [tournamentId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings || !defaults) {
    return (
      <Card>
        <CardHeader icon={<FileText aria-hidden="true" />} title={t("setup.email.settingsTitle")} />
        <CardBody>
          {status ? (
            <Alert role="alert" tone="danger">{status.text || t(status.fallback)}</Alert>
          ) : (
            <div className="space-y-2">
              <p role="status" className="text-xs text-fg-muted">{t("setup.email.settingsLoading")}</p>
              <Skeleton className="h-8 max-w-md" />
              <Skeleton className="h-24" />
            </div>
          )}
        </CardBody>
      </Card>
    );
  }

  const template = settings.templates[event] ?? defaults[event];
  const customised = Boolean(settings.templates[event]);
  const setTemplate = (next: EmailTemplate | undefined) =>
    setSettings((current) => {
      if (!current) return current;
      const templates = { ...current.templates };
      if (next) templates[event] = next;
      else delete templates[event];
      return { ...current, templates };
    });

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournamentId)}/email/settings`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          replyToName: settings.replyToName,
          replyToAddress: settings.replyToAddress,
          registrationEmails: settings.registrationEmails,
          templates: settings.templates,
        }),
      });
      const result = await response.json() as { error?: string; settings?: TournamentEmailSettings };
      if (!response.ok || !result.settings) throw new Error(result.error || "");
      setSettings({ ...result.settings, templates: result.settings.templates ?? {} });
      setStatus({ tone: "success", text: "", fallback: "setup.email.settingsSaved" });
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "",
        fallback: "setup.email.settingsSaveFailed",
      });
    } finally {
      setSaving(false);
    }
  };

  const info = TEMPLATE_EVENT_INFO[event];
  const variables = [...COMMON_VARIABLES, ...info.variables].map((name) => `{{${name}}}`).join(" ");
  return (
    <Card>
      <CardHeader
        icon={<FileText aria-hidden="true" />}
        title={t("setup.email.settingsTitle")}
        description={t("setup.email.settingsDescription")}
      />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t("setup.email.replyToName")}
            value={settings.replyToName}
            maxLength={100}
            placeholder={t("setup.email.replyToNamePlaceholder")}
            onChange={(eventObject) => setSettings({ ...settings, replyToName: eventObject.target.value })}
          />
          <Input
            label={t("setup.email.replyToAddress")}
            type="email"
            value={settings.replyToAddress}
            placeholder="tab@example.org"
            help={t("setup.email.replyToAddressHelp")}
            onChange={(eventObject) => setSettings({ ...settings, replyToAddress: eventObject.target.value })}
          />
        </div>
        <Switch
          checked={settings.registrationEmails}
          onCheckedChange={(checked) => setSettings({ ...settings, registrationEmails: checked })}
          label={t("setup.email.registrationEmails")}
          description={t("setup.email.registrationEmailsHelp")}
        />
        <Select
          label={t("setup.email.templateLabel")}
          value={event}
          onChange={(eventObject) => setEvent(eventObject.target.value as TemplateEvent)}
          wrapperClassName="max-w-md"
          help={t(EVENT_LABELS[event].when)}
        >
          {TEMPLATE_EVENTS.map((item) => (
            <option key={item} value={item}>
              {settings.templates[item]
                ? t("setup.email.templateCustomised", { label: t(EVENT_LABELS[item].label) })
                : t(EVENT_LABELS[item].label)}
            </option>
          ))}
        </Select>
        <Input
          label={t("setup.email.subjectLabel")}
          value={template.subject}
          maxLength={200}
          onChange={(eventObject) => setTemplate({ ...template, subject: eventObject.target.value })}
        />
        <Textarea
          label={t("setup.email.messageLabel")}
          rows={9}
          value={template.body}
          onChange={(eventObject) => setTemplate({ ...template, body: eventObject.target.value })}
          help={t("setup.email.variablesList", { variables })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>{t("setup.email.saveSettings")}</Button>
          {onUseTemplate && isManualTemplateEvent(event) && (
            <Button variant="secondary" size="sm" onClick={() => onUseTemplate(template, event)}>
              {t("setup.email.useInCompose")}
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={!customised || saving} onClick={() => setTemplate(undefined)}>
            {t("setup.email.resetTemplate")}
          </Button>
        </div>
        <p className="text-xs text-fg-muted">
          {webhookConfigured ? t("setup.email.webhookConfigured") : t("setup.email.webhookMissing")}
        </p>
        {status && (
          <Alert role={status.tone === "danger" ? "alert" : "status"} tone={status.tone}>
            {status.text || t(status.fallback)}
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}
