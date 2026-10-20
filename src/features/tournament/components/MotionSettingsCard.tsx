"use client";

import React, { useState } from "react";
import Link from "next/link";
import { BarChart3, Settings2 } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select, Switch } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { buttonClasses } from "@/components/ui/Button";
import type { TournamentPreferences } from "@/types";

/** Motion preferences that are not about scoring: public order and ranked motion preferences. */
export function MotionSettingsCard() {
  const { tournament, isOwnerOrAdmin, saveTournament } = useTournament();
  const [error, setError] = useState("");
  if (!tournament || !isOwnerOrAdmin) return null;
  const preferences = tournament.preferences;

  const save = async (patch: Partial<TournamentPreferences>) => {
    setError("");
    try {
      await saveTournament({ ...tournament, preferences: { ...preferences, ...patch } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the motion settings.");
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<Settings2 aria-hidden="true" />}
        title="Motion settings"
        actions={
          <Link href="/tournaments/motions" className={buttonClasses({ variant: "ghost", size: "sm" })}>
            <BarChart3 aria-hidden="true" />
            Statistics across your tournaments
          </Link>
        }
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        {error && <Alert tone="danger" role="alert" className="sm:col-span-2">{error}</Alert>}
        <Select
          label="Public motions order"
          help="Order of rounds on the public motions tab."
          value={preferences.publicMotionsOrder ?? "reverse"}
          onChange={(event) => void save({ publicMotionsOrder: event.target.value as "forward" | "reverse" })}
        >
          <option value="reverse">Latest round first</option>
          <option value="forward">Earliest round first</option>
        </Select>
        <Switch
          id="motion-preferences"
          checked={preferences.enableMotionPreferences === true}
          onCheckedChange={(checked) => void save({ enableMotionPreferences: checked })}
          label="Record ranked motion preferences"
          description="Ballots record each team's motion ranking (most preferred first) alongside vetoes, for motion statistics."
        />
      </CardBody>
    </Card>
  );
}
