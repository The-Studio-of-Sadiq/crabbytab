"use client";

import React, { useState } from "react";
import { Printer } from "lucide-react";
import type { Tournament } from "@/types";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Checkbox, Input } from "@/components/ui/Field";

export { returnLocation } from "@/lib/printOptions";

/**
 * Printed-form options (Tabbycat score_return_location, feedback_return_location,
 * ballots_confirm_digits, ballots_hide_motions), saved in the tournament's preferences.
 */
export function PrintOptionsCard({
  tournament,
  onSave,
  kind,
}: {
  tournament: Tournament;
  onSave: (tournament: Tournament) => Promise<void>;
  kind: "ballots" | "feedback";
}) {
  const preferences = tournament.preferences;
  const [returnTo, setReturnTo] = useState(
    (kind === "ballots" ? preferences.ballotReturnLocation : preferences.feedbackReturnLocation) ?? ""
  );
  const [digits, setDigits] = useState(preferences.ballotsConfirmDigits === true);
  const [hideMotions, setHideMotions] = useState(preferences.ballotsHideMotions === true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await onSave({
        ...tournament,
        preferences: {
          ...preferences,
          ...(kind === "ballots"
            ? { ballotReturnLocation: returnTo.trim(), ballotsConfirmDigits: digits, ballotsHideMotions: hideMotions }
            : { feedbackReturnLocation: returnTo.trim() }),
        },
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={<Printer aria-hidden="true" />} title="Print options" />
      <CardBody className="space-y-3">
        <Input
          label={kind === "ballots" ? "Return scoresheets to" : "Return feedback forms to"}
          help="Printed at the bottom of each sheet. Leave empty (or TBA) to hide."
          maxLength={120}
          value={returnTo}
          onChange={(event) => setReturnTo(event.target.value)}
          wrapperClassName="max-w-md"
        />
        {kind === "ballots" && (
          <>
            <Checkbox
              label="Ask adjudicators to circle each score's digits"
              description="Adds a digit strip next to every score, to check bad handwriting."
              checked={digits}
              onChange={(event) => setDigits(event.target.checked)}
            />
            <Checkbox
              label="Leave the motion blank on printed scoresheets"
              description="For printing before motions are released; adjudicators write the motion in."
              checked={hideMotions}
              onChange={(event) => setHideMotions(event.target.checked)}
            />
          </>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" loading={saving} onClick={() => void save()}>Save print options</Button>
          {saved && <span role="status" className="text-xs text-fg-muted">Saved.</span>}
        </div>
      </CardBody>
    </Card>
  );
}
