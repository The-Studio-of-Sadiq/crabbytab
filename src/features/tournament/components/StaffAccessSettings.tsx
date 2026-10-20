"use client";

import React, { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { AssistantAccessLevel, PrivateBallotConfirmation, Tournament } from "@/types";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select, Switch } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { ASSISTANT_ACCESS_LABELS, ASSISTANT_ACCESS_LEVELS, resolveAssistantAccess } from "@/lib/staffPermissions";

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
      setStatus({ tone: "success", text: "Saved on this device. Upload the tournament for staff and participants to get the change." });
    } catch (error) {
      setStatus({ tone: "danger", text: error instanceof Error ? error.message : "Could not save the settings." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck aria-hidden="true" />}
        title="Staff access and private-URL ballots"
        description="What data-entry staff can reach, and how ballots from adjudicators' private URLs are confirmed."
      />
      <CardBody className="space-y-4">
        <Select
          label="Data-entry staff access"
          help="Tabbycat's assistant access. Lower levels hide unreleased draws and motions from staff; “No access” switches every data-entry account off."
          value={access}
          onChange={(event) => setAccess(resolveAssistantAccess(event.target.value))}
          wrapperClassName="max-w-md"
        >
          {ASSISTANT_ACCESS_LEVELS.map((level) => (
            <option key={level} value={level}>{ASSISTANT_ACCESS_LABELS[level]}</option>
          ))}
        </Select>
        <Select
          label="Ballots submitted through private URLs"
          help="With “The chair”, a chair's ballot (or a complete set of individual ballots) counts at once. With “The tab room”, every private-URL ballot waits until the tab room or data-entry staff confirm it."
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value === "tab_room" ? "tab_room" : "chair")}
          wrapperClassName="max-w-md"
        >
          <option value="chair">The chair confirms (default)</option>
          <option value="tab_room">The tab room confirms</option>
        </Select>
        <Switch
          checked={individualBallots}
          onCheckedChange={setIndividualBallots}
          disabled={!votingUsed}
          label="Individual ballots from every voting adjudicator"
          description={votingUsed
            ? "Voting rounds: each voting adjudicator submits their own scoresheet; the latest sheet of each is merged into one voting ballot."
            : "Only for two-team tournaments that use voting ballots (Scoring & ballots)."}
        />
        {status && <Alert role={status.tone === "danger" ? "alert" : "status"} tone={status.tone}>{status.text}</Alert>}
        <div>
          <Button variant="primary" size="sm" loading={saving} disabled={!changed} onClick={() => void save()}>
            Save settings
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
