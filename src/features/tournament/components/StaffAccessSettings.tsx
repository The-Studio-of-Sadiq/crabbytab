"use client";

import React, { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { AssistantAccessLevel, PrivateBallotConfirmation, Tournament } from "@/types";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select, Switch } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";
import { ASSISTANT_ACCESS_LEVELS, resolveAssistantAccess } from "@/lib/staffPermissions";

const ACCESS_LEVEL_KEYS: Record<AssistantAccessLevel, MessageKey> = {
  all_areas: "setup.staff.accessLevelAllAreas",
  results_draw: "setup.staff.accessLevelResultsDraw",
  results_only: "setup.staff.accessLevelResultsOnly",
  none: "setup.staff.accessLevelNone",
};

/**
 * Tournament-wide staff access and private-URL ballot settings (docs/staff-access.md). They live in
 * the tournament's preferences, so they reach the server, and so take effect for staff and
 * participants, with the next upload of the tournament.
 */
export function StaffAccessSettings({
  tournament,
  onSave,
}: {
  tournament: Tournament;
  onSave: (tournament: Tournament) => Promise<void>;
}) {
  const { t } = useI18n();
  const preferences = tournament.preferences;
  const [access, setAccess] = useState<AssistantAccessLevel>(resolveAssistantAccess(preferences.assistantAccess));
  const [individualBallots, setIndividualBallots] = useState(preferences.individualBallots === true);
  const [confirmation, setConfirmation] = useState<PrivateBallotConfirmation>(
    preferences.privateBallotConfirmation === "tab_room" ? "tab_room" : "chair"
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    setAccess(resolveAssistantAccess(preferences.assistantAccess));
    setIndividualBallots(preferences.individualBallots === true);
    setConfirmation(preferences.privateBallotConfirmation === "tab_room" ? "tab_room" : "chair");
  }, [preferences.assistantAccess, preferences.individualBallots, preferences.privateBallotConfirmation]);

  const votingUsed = tournament.format !== "bp" &&
    (preferences.ballotMode === "voting" || preferences.eliminationBallotMode === "voting");
  const changed =
    access !== resolveAssistantAccess(preferences.assistantAccess) ||
    individualBallots !== (preferences.individualBallots === true) ||
    confirmation !== (preferences.privateBallotConfirmation === "tab_room" ? "tab_room" : "chair");

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await onSave({
        ...tournament,
        preferences: {
          ...preferences,
          assistantAccess: access,
          individualBallots,
          privateBallotConfirmation: confirmation,
        },
      });
      setStatus({ tone: "success", text: t("setup.staff.accessSaved") });
    } catch (error) {
      setStatus({ tone: "danger", text: error instanceof Error ? error.message : t("setup.staff.accessSaveError") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck aria-hidden="true" />}
        title={t("setup.staff.accessTitle")}
        description={t("setup.staff.accessDescription")}
      />
      <CardBody className="space-y-4">
        <Select
          label={t("setup.staff.accessLevelLabel")}
          help={t("setup.staff.accessLevelHelp")}
          value={access}
          onChange={(event) => setAccess(resolveAssistantAccess(event.target.value))}
          wrapperClassName="max-w-md"
        >
          {ASSISTANT_ACCESS_LEVELS.map((level) => (
            <option key={level} value={level}>{t(ACCESS_LEVEL_KEYS[level])}</option>
          ))}
        </Select>
        <Select
          label={t("setup.staff.ballotConfirmLabel")}
          help={t("setup.staff.ballotConfirmHelp")}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value === "tab_room" ? "tab_room" : "chair")}
          wrapperClassName="max-w-md"
        >
          <option value="chair">{t("setup.staff.ballotConfirmChair")}</option>
          <option value="tab_room">{t("setup.staff.ballotConfirmTabRoom")}</option>
        </Select>
        <Switch
          checked={individualBallots}
          onCheckedChange={setIndividualBallots}
          disabled={!votingUsed}
          label={t("setup.staff.individualBallotsLabel")}
          description={votingUsed
            ? t("setup.staff.individualBallotsOn")
            : t("setup.staff.individualBallotsOff")}
        />
        {status && <Alert role={status.tone === "danger" ? "alert" : "status"} tone={status.tone}>{status.text}</Alert>}
        <div>
          <Button variant="primary" size="sm" loading={saving} disabled={!changed} onClick={() => void save()}>
            {t("setup.staff.accessSave")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
