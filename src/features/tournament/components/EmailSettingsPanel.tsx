"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select, Switch, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import {
  TEMPLATE_EVENT_INFO,
  TEMPLATE_EVENTS,
  type EmailTemplate,
  type TemplateEvent,
  type TournamentEmailSettings,
} from "@/lib/email/settings";

const COMMON_VARIABLES = ["name", "email", "tournament", "round", "institution"];

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
  /** Manual events (private URL, feedback URL) are sent from the compose form. */
  onUseTemplate?: (template: EmailTemplate) => void;
}) {
  const [settings, setSettings] = useState<TournamentEmailSettings | null>(null);
  const [defaults, setDefaults] = useState<Record<TemplateEvent, EmailTemplate> | null>(null);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [event, setEvent] = useState<TemplateEvent>("draw_teams");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

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
      if (!response.ok || !result.settings || !result.defaults) throw new Error(result.error || "Could not load email settings.");
      setSettings(result.settings);
      setDefaults(result.defaults);
      setWebhookConfigured(result.webhookConfigured === true);
    } catch (error) {
      setStatus({ tone: "danger", text: error instanceof Error ? error.message : "Could not load email settings." });
    }
  }, [tournamentId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings || !defaults) {
    return (
      <Card>
        <CardHeader icon={<FileText aria-hidden="true" />} title="Email settings and templates" />
        <CardBody>
          {status ? <Alert role="alert" tone="danger">{status.text}</Alert> : <p role="status" className="text-xs text-fg-muted">Loading email settings…</p>}
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
      if (!response.ok || !result.settings) throw new Error(result.error || "Could not save email settings.");
      setSettings({ ...result.settings, templates: result.settings.templates ?? {} });
      setStatus({ tone: "success", text: "Email settings saved. They apply to the next email sent." });
    } catch (error) {
      setStatus({ tone: "danger", text: error instanceof Error ? error.message : "Could not save email settings." });
    } finally {
      setSaving(false);
    }
  };

  const info = TEMPLATE_EVENT_INFO[event];
  return (
    <Card>
      <CardHeader
        icon={<FileText aria-hidden="true" />}
        title="Email settings and templates"
        description="Reply-To for every email from this tournament, and the wording of each automatic email."
      />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Reply-To name"
            value={settings.replyToName}
            maxLength={100}
            placeholder="Tabulation Team"
            onChange={(eventObject) => setSettings({ ...settings, replyToName: eventObject.target.value })}
          />
          <Input
            label="Reply-To address"
            type="email"
            value={settings.replyToAddress}
            placeholder="tab@example.org"
            help="Replies from participants go here instead of the sending address. Leave empty to use the sender."
            onChange={(eventObject) => setSettings({ ...settings, replyToAddress: eventObject.target.value })}
          />
        </div>
        <Switch
          checked={settings.registrationEmails}
          onCheckedChange={(checked) => setSettings({ ...settings, registrationEmails: checked })}
          label="Email registrants"
          description="Send “Registration received” when someone registers and “Registration approved” when the tab room approves it."
        />
        <Select
          label="Template"
          value={event}
          onChange={(eventObject) => setEvent(eventObject.target.value as TemplateEvent)}
          wrapperClassName="max-w-md"
          help={info.when}
        >
          {TEMPLATE_EVENTS.map((item) => (
            <option key={item} value={item}>
              {TEMPLATE_EVENT_INFO[item].label}{settings.templates[item] ? " (customised)" : ""}
            </option>
          ))}
        </Select>
        <Input
          label="Subject"
          value={template.subject}
          maxLength={200}
          onChange={(eventObject) => setTemplate({ ...template, subject: eventObject.target.value })}
        />
        <Textarea
          label="Message"
          rows={9}
          value={template.body}
          onChange={(eventObject) => setTemplate({ ...template, body: eventObject.target.value })}
          help={`Variables: ${[...COMMON_VARIABLES, ...info.variables].map((name) => `{{${name}}}`).join(" ")}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>Save email settings</Button>
          {onUseTemplate && (event === "private_url" || event === "feedback_url") && (
            <Button variant="secondary" size="sm" onClick={() => onUseTemplate(template)}>
              Use in the compose form
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={!customised || saving} onClick={() => setTemplate(undefined)}>
            Reset this template to the default
          </Button>
        </div>
        <p className="text-xs text-fg-muted">
          Delivery status from the email provider: {webhookConfigured
            ? "the signed webhook is configured; campaign history shows each address's latest status."
            : "not configured (set EMAIL_WEBHOOK_SECRET on the server and point the provider at /api/email/webhook)."}
        </p>
        {status && <Alert role={status.tone === "danger" ? "alert" : "status"} tone={status.tone}>{status.text}</Alert>}
      </CardBody>
    </Card>
  );
}
