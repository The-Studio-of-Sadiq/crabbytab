"use client";

import React, { useState } from "react";
import { FileDown } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/PageHeader";
import { useI18n } from "@/components/i18n/I18nProvider";
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
  const { t } = useI18n();
  const [message, setMessage] = useState("");

  if (loading) return <p className="p-6 text-sm text-fg-muted">{t("setup.common.loading")}</p>;
  if (!tournament || !isOwnerOrAdmin) {
    return <p role="alert" className="p-6 text-sm text-danger">{t("setup.data.exports.adminOnly")}</p>;
  }

  const speakerCategories = tournament.preferences?.speakerCategories ?? [];
  const context = { institutions, breakCategories, speakerCategories };
  const groups: Array<{ title: string; items: ExportItem[] }> = [
    {
      title: t("setup.data.exports.groupParticipants"),
      items: [
        { key: "teams", label: t("setup.data.exports.teams"), description: t("setup.data.exports.teamsHelp"), build: () => teamsCsv(teams, context) },
        { key: "speakers", label: t("setup.data.exports.speakers"), description: t("setup.data.exports.speakersHelp"), build: () => speakersCsv(teams, context) },
        { key: "adjudicators", label: t("setup.data.exports.adjudicators"), description: t("setup.data.exports.adjudicatorsHelp"), build: () => adjudicatorsCsv(adjudicators, context) },
        { key: "institutions", label: t("setup.data.exports.institutions"), description: t("setup.data.exports.institutionsHelp"), build: () => institutionsCsv(institutions, teams, adjudicators) },
      ],
    },
    {
      title: t("setup.data.exports.groupRounds"),
      items: [
        {
          key: "availability",
          label: t("setup.data.exports.availability"),
          description: t("setup.data.exports.availabilityHelp"),
          build: () => availabilityCsv({ rounds, teams, adjudicators, venues, checkInExpiresAfterHours: tournament.preferences?.checkInExpiresAfterHours }),
        },
        { key: "break-eligibility", label: t("setup.data.exports.breakEligibility"), description: t("setup.data.exports.breakEligibilityHelp"), build: () => breakEligibilityCsv(teams, breakCategories, speakerCategories) },
        { key: "conflicts", label: t("setup.data.exports.conflicts"), description: t("setup.data.exports.conflictsHelp"), build: () => conflictsCsv({ adjudicators, teams, institutions }) },
      ],
    },
  ];

  const download = (item: ExportItem) => {
    downloadCsv(csvFileStem(tournament.shortName || tournament.name, item.key), item.build());
    setMessage(t("setup.data.exports.exported", { label: item.label }));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={t("setup.data.exports.title")}
        description={t("setup.data.exports.description")}
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
                <Button size="sm" onClick={() => download(item)} aria-label={t("setup.data.exports.exportLabel", { label: item.label })}>
                  <FileDown aria-hidden="true" />
                  {t("setup.data.exports.exportCsv")}
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
