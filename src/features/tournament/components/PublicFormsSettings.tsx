"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { ClipboardList } from "lucide-react";
import type { Tournament } from "@/types";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Switch } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { useI18n } from "@/components/i18n/I18nProvider";
import { MIN_PUBLIC_FORMS_PASSWORD_LENGTH } from "@/lib/publicFormsPasswordRules";

type Status = { tone: "success" | "danger" | "warning"; text: string };

/**
 * Tabbycat's `participant_ballots` / `participant_feedback` "public" modes and
 * `public_use_password` / `public_password` (docs/public-pages-and-notifications.md, "Public
 * forms"). The switches are tournament preferences (they reach the server with the next upload);
 * the password is saved on the server at once and only its hash is kept.
 */
export function PublicFormsSettings({
  tournament,
  user,
  onSave,
}: {
  tournament: Tournament;
  user: User;
  onSave: (tournament: Tournament) => Promise<void>;
}) {
  const { t } = useI18n();
  const preferences = tournament.preferences;
  const [ballotForm, setBallotForm] = useState(preferences.publicBallotForm === true);
  const [feedbackForm, setFeedbackForm] = useState(preferences.publicFeedbackForm === true);
  const [usePassword, setUsePassword] = useState(preferences.publicFormsUsePassword === true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<Status | null>(null);

  useEffect(() => {
    setBallotForm(preferences.publicBallotForm === true);
    setFeedbackForm(preferences.publicFeedbackForm === true);
    setUsePassword(preferences.publicFormsUsePassword === true);
  }, [preferences.publicBallotForm, preferences.publicFeedbackForm, preferences.publicFormsUsePassword]);

  const endpoint = `/api/tournaments/${encodeURIComponent(tournament.id)}/public-forms`;
  const loadPassword = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store" });
      const body = (await response.json()) as { passwordSet?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "");
      setPasswordSet(body.passwordSet === true);
    } catch (caught) {
      setPasswordSet(null);
      setPasswordStatus({ tone: "danger", text: caught instanceof Error && caught.message ? caught.message : t("setup.publicForms.passwordLoadError") });
    }
  }, [endpoint, t, user]);

  useEffect(() => {
    void loadPassword();
  }, [loadPassword]);

  const changed =
    ballotForm !== (preferences.publicBallotForm === true) ||
    feedbackForm !== (preferences.publicFeedbackForm === true) ||
    usePassword !== (preferences.publicFormsUsePassword === true);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await onSave({
        ...tournament,
        preferences: {
          ...preferences,
          publicBallotForm: ballotForm,
          publicFeedbackForm: feedbackForm,
          publicFormsUsePassword: usePassword,
        },
      });
      setStatus({ tone: "success", text: t("setup.publicForms.saved") });
    } catch (caught) {
      setStatus({ tone: "danger", text: caught instanceof Error && caught.message ? caught.message : t("setup.publicForms.saveError") });
    } finally {
      setSaving(false);
    }
  };

  const storePassword = async (password: string | null) => {
    setPasswordBusy(true);
    setPasswordStatus(null);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json()) as { passwordSet?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "");
      setPasswordSet(body.passwordSet === true);
      setNewPassword("");
      setPasswordStatus({ tone: "success", text: password === null ? t("setup.publicForms.passwordRemoved") : t("setup.publicForms.passwordSaved") });
    } catch (caught) {
      setPasswordStatus({ tone: "danger", text: caught instanceof Error && caught.message ? caught.message : t("setup.publicForms.passwordSaveError") });
    } finally {
      setPasswordBusy(false);
    }
  };

  const formsOn = ballotForm || feedbackForm;
  return (
    <Card>
      <CardHeader
        icon={<ClipboardList aria-hidden="true" />}
        title={t("setup.publicForms.title")}
        description={t("setup.publicForms.description")}
      />
      <CardBody className="space-y-4">
        <Switch
          checked={ballotForm}
          onCheckedChange={setBallotForm}
          label={t("setup.publicForms.ballotLabel")}
          description={t("setup.publicForms.ballotHelp")}
        />
        <Switch
          checked={feedbackForm}
          onCheckedChange={setFeedbackForm}
          disabled={preferences.feedbackEnabled === false}
          label={t("setup.publicForms.feedbackLabel")}
          description={preferences.feedbackEnabled === false ? t("setup.publicForms.feedbackOffHelp") : t("setup.publicForms.feedbackHelp")}
        />
        <Switch
          checked={usePassword}
          onCheckedChange={setUsePassword}
          label={t("setup.publicForms.usePasswordLabel")}
          description={t("setup.publicForms.usePasswordHelp")}
        />
        {formsOn && preferences.privateUrlBallots !== false && ballotForm && (
          <Alert tone="info">{t("setup.publicForms.privateUrlsNote")}</Alert>
        )}
        {usePassword && passwordSet === false && (
          <Alert tone="warning" role="alert">{t("setup.publicForms.passwordMissingWarning")}</Alert>
        )}
        {status && <Alert role={status.tone === "danger" ? "alert" : "status"} tone={status.tone}>{status.text}</Alert>}
        <div>
          <Button variant="primary" size="sm" loading={saving} disabled={!changed} onClick={() => void save()}>
            {t("setup.publicForms.save")}
          </Button>
        </div>

        <form
          className="space-y-2 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void storePassword(newPassword);
          }}
        >
          <p className="text-[13px] text-fg">
            {passwordSet === null
              ? t("setup.publicForms.passwordUnknown")
              : passwordSet
                ? t("setup.publicForms.passwordIsSet")
                : t("setup.publicForms.passwordNotSet")}
          </p>
          <Input
            label={passwordSet ? t("setup.publicForms.passwordChangeLabel") : t("setup.publicForms.passwordSetLabel")}
            help={t("setup.publicForms.passwordFieldHelp", { min: MIN_PUBLIC_FORMS_PASSWORD_LENGTH })}
            type="password"
            autoComplete="new-password"
            minLength={MIN_PUBLIC_FORMS_PASSWORD_LENGTH}
            maxLength={128}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            wrapperClassName="max-w-sm"
          />
          {passwordStatus && <Alert role={passwordStatus.tone === "danger" ? "alert" : "status"} tone={passwordStatus.tone}>{passwordStatus.text}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" size="sm" loading={passwordBusy} disabled={newPassword.length < MIN_PUBLIC_FORMS_PASSWORD_LENGTH}>
              {t("setup.publicForms.passwordSave")}
            </Button>
            {passwordSet && (
              <Button variant="ghost" size="sm" disabled={passwordBusy} onClick={() => void storePassword(null)}>
                {t("setup.publicForms.passwordRemove")}
              </Button>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
