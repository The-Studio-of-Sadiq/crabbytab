"use client";

import React, { useState } from "react";
import { FileDown } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/PageHeader";
import { csvFileStem } from "@/lib/csv/exporters";
import { downloadCsv } from "@/lib/csv/download";
import {
  adjudicatorsCsv,
  availabilityCsv,
  breakEligibilityCsv,
  conflictsCsv,
  institutionsCsv,
  speakersCsv,
  teamsCsv,
} from "@/lib/csv/participantExports";

interface ExportItem {
  key: string;
  label: string;
  description: string;
  build(): string;
}

/**
 * Tournament data as CSV (Tabbycat's participant, availability, break-eligibility and conflict
 * exports). Built in the browser from the working copy; nothing is sent anywhere. Standings,
 * draws and feedback have their own export buttons on their pages.
 */
export default function ExportsPage() {
  const {
    tournament,
    isOwnerOrAdmin,
    loading,
    teams,
    adjudicators,
    institutions,
    venues,
    rounds,
    breakCategories,
  } = useTournament();
  const [message, setMessage] = useState("");

  if (loading) return <p className="p-6 text-sm text-fg-muted">Loading…</p>;
  if (!tournament || !isOwnerOrAdmin) {
    return <p role="alert" className="p-6 text-sm text-danger">Only tournament administrators can export tournament data.</p>;
  }

  const speakerCategories = tournament.preferences?.speakerCategories ?? [];
  const context = { institutions, breakCategories, speakerCategories };
  const groups: Array<{ title: string; items: ExportItem[] }> = [
    {
      title: "Participants",
      items: [
        { key: "teams", label: "Teams", description: "One row per team with its speakers, institution and break categories.", build: () => teamsCsv(teams, context) },
        { key: "speakers", label: "Speakers", description: "One row per speaker with team, institution, email and speaker categories.", build: () => speakersCsv(teams, context) },
        { key: "adjudicators", label: "Adjudicators", description: "Scores, trainee/independent status, adjudication core and breaking flags.", build: () => adjudicatorsCsv(adjudicators, context) },
        { key: "institutions", label: "Institutions", description: "Name, code, region and how many teams and adjudicators each has.", build: () => institutionsCsv(institutions, teams, adjudicators) },
      ],
    },
    {
      title: "Rounds and breaks",
      items: [
        {
          key: "availability",
          label: "Availability",
          description: "Who is available in each round (check-ins with their expiry, round availability, venues).",
          build: () => availabilityCsv({ rounds, teams, adjudicators, venues, checkInExpiresAfterHours: tournament.preferences?.checkInExpiresAfterHours }),
        },
        { key: "break-eligibility", label: "Break eligibility", description: "Each team's eligibility, overrides and speaker-category rule per break category.", build: () => breakEligibilityCsv(teams, breakCategories, speakerCategories) },
        { key: "conflicts", label: "Conflicts", description: "Adjudicator and team conflicts, in the format the conflicts import reads.", build: () => conflictsCsv({ adjudicators, teams, institutions }) },
      ],
    },
  ];

  const download = (item: ExportItem) => {
    downloadCsv(csvFileStem(tournament.shortName || tournament.name, item.key), item.build());
    setMessage(`${item.label} exported.`);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Data exports"
        description="CSV files for spreadsheets and other tools. They hold participant details (including email addresses), so share them carefully. Private URL keys and passcodes are never exported."
      />
      {message && <Alert tone="success" role="status">{message}</Alert>}
      {groups.map((group) => (
        <Card key={group.title}>
          <CardHeader title={group.title} icon={<FileDown aria-hidden="true" />} />
          <CardBody className="divide-y divide-border p-0">
            {group.items.map((item) => (
              <div key={item.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{item.label}</p>
                  <p className="text-xs text-fg-muted">{item.description}</p>
                </div>
                <Button size="sm" onClick={() => download(item)} aria-label={`Export ${item.label} as CSV`}>
                  <FileDown aria-hidden="true" />
                  Export CSV
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
