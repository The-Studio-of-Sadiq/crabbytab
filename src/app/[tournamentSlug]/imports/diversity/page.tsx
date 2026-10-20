"use client";

import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { Adjudicator, Speaker, Team } from "@/types";
import { formatDiversityCounts, panelDiversitySummary, participantRegion } from "@/lib/adjudicators/diversity";
import { buildAdminDiversity } from "@/lib/publicView/derived";
import { createPublicNamer } from "@/lib/publicView/names";
import { DiversityPanel } from "@/features/tournament/components/public/PublicSitePanels";
import { InstitutionGenderTable } from "@/features/tournament/components/InstitutionGenderTable";

type Kind = "speakers" | "adjudicators";

interface DiversityInputProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  disabled: boolean;
  onSave(value: string | undefined): Promise<void>;
}

/** Saves on blur, only when the trimmed value changed. */
function DiversityInput({ label, value, placeholder, disabled, onSave }: DiversityInputProps) {
  return (
    <Input
      key={value ?? ""}
      type="text"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      onBlur={(event) => {
        const next = event.target.value.trim() || undefined;
        if (next !== (value?.trim() || undefined)) void onSave(next);
      }}
      className="h-7 text-xs"
    />
  );
}

export default function DiversityPage() {
  const { t, richPlural } = useI18n();
  const {
    tournament,
    rounds,
    debates,
    ballots,
    feedback,
    teams,
    adjudicators,
    institutions,
    updateTeam,
    updateAdjudicator,
    isOwnerOrAdmin,
  } = useTournament();
  const statistics = useMemo(
    () =>
      tournament
        ? buildAdminDiversity(
            tournament,
            { rounds, teams, adjudicators, debates, ballots, institutions, feedback },
            createPublicNamer(teams, adjudicators, { teamCodeNames: "off", participantCodeNames: "off" })
          )
        : undefined,
    [tournament, rounds, teams, adjudicators, debates, ballots, institutions, feedback]
  );
  const [kind, setKind] = useState<Kind>("speakers");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const institutionsById = useMemo(
    () => new Map(institutions.map((institution) => [institution.id, institution])),
    [institutions]
  );

  const speakerRows = useMemo(
    () =>
      teams.flatMap((team) => team.speakers.map((speaker) => ({ team, speaker })))
        .filter(({ team, speaker }) =>
          `${speaker.name} ${team.name}`.toLowerCase().includes(query.trim().toLowerCase())
        ),
    [teams, query]
  );
  const adjudicatorRows = useMemo(
    () => adjudicators.filter((adjudicator) =>
      `${adjudicator.name} ${adjudicator.institutionName ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
    ),
    [adjudicators, query]
  );
  const summary = useMemo(
    () =>
      kind === "speakers"
        ? panelDiversitySummary(
            teams.flatMap((team) => team.speakers.map((speaker) => ({ ...speaker, institutionId: team.institutionId }))),
            institutionsById
          )
        : panelDiversitySummary(adjudicators, institutionsById),
    [kind, teams, adjudicators, institutionsById]
  );

  const run = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("setup.importsExtra.diversity.saveError"));
    }
  };

  const saveSpeaker = (team: Team, speaker: Speaker, patch: Partial<Pick<Speaker, "gender" | "region">>) =>
    run(() =>
      updateTeam({
        ...team,
        speakers: team.speakers.map((item) => (item.id === speaker.id ? { ...item, ...patch } : item)),
      })
    );
  const saveAdjudicator = (adjudicator: Adjudicator, patch: Partial<Pick<Adjudicator, "gender" | "region">>) =>
    run(() => updateAdjudicator({ ...adjudicator, ...patch }));

  const rowCount = kind === "speakers" ? speakerRows.length : adjudicatorRows.length;
  // The counts are organiser-entered gender/region labels, shown as they are.
  const summaryValues = {
    genders: formatDiversityCounts(summary.genders) || "—",
    regions: formatDiversityCounts(summary.regions) || "—",
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("setup.importsExtra.diversity.title")} description={t("setup.importsExtra.diversity.description")} />

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label={t("setup.importsExtra.diversity.kindLabel")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "speakers", label: t("setup.importsExtra.diversity.speakers") },
            { value: "adjudicators", label: t("setup.importsExtra.diversity.adjudicators") },
          ]}
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("setup.importsExtra.diversity.searchPlaceholder")}
          aria-label={t("setup.importsExtra.diversity.search")}
          leadingIcon={<Search />}
          wrapperClassName="ms-auto w-full sm:w-56"
          className="w-full"
        />
      </div>

      <p className="text-xs text-fg-muted">
        {richPlural(
          kind === "speakers" ? "setup.importsExtra.diversity.summarySpeakers" : "setup.importsExtra.diversity.summaryAdjudicators",
          summary.size,
          { b: (text) => <span className="font-semibold text-fg">{text}</span> },
          summaryValues
        )}
      </p>
      {!isOwnerOrAdmin && <Alert tone="info">{t("setup.importsExtra.diversity.adminOnly")}</Alert>}
      {error && <Alert tone="danger" role="alert">{error}</Alert>}

      <TableContainer>
        <Table>
          <THead>
            <TR>
              <TH>{t("setup.common.name")}</TH>
              <TH>{kind === "speakers" ? t("setup.importsExtra.diversity.team") : t("setup.importsExtra.diversity.institution")}</TH>
              <TH className="w-48">{t("setup.importsExtra.diversity.gender")}</TH>
              <TH className="w-48">{t("setup.importsExtra.diversity.region")}</TH>
            </TR>
          </THead>
          <TBody>
            {kind === "speakers"
              ? speakerRows.map(({ team, speaker }) => (
                  <TR key={`${team.id}-${speaker.id}`}>
                    <TD className="text-xs font-semibold">{speaker.name}</TD>
                    <TD className="text-xs text-fg-muted">{team.name}</TD>
                    <TD>
                      <DiversityInput
                        label={t("setup.importsExtra.diversity.genderOf", { name: speaker.name })}
                        value={speaker.gender}
                        disabled={!isOwnerOrAdmin}
                        onSave={(gender) => saveSpeaker(team, speaker, { gender })}
                      />
                    </TD>
                    <TD>
                      <DiversityInput
                        label={t("setup.importsExtra.diversity.regionOf", { name: speaker.name })}
                        value={speaker.region}
                        placeholder={participantRegion({ institutionId: team.institutionId }, institutionsById)}
                        disabled={!isOwnerOrAdmin}
                        onSave={(region) => saveSpeaker(team, speaker, { region })}
                      />
                    </TD>
                  </TR>
                ))
              : adjudicatorRows.map((adjudicator) => (
                  <TR key={adjudicator.id}>
                    <TD className="text-xs font-semibold">{adjudicator.name}</TD>
                    <TD className="text-xs text-fg-muted">
                      {adjudicator.institutionName ?? t("setup.importsExtra.diversity.independent")}
                    </TD>
                    <TD>
                      <DiversityInput
                        label={t("setup.importsExtra.diversity.genderOf", { name: adjudicator.name })}
                        value={adjudicator.gender}
                        disabled={!isOwnerOrAdmin}
                        onSave={(gender) => saveAdjudicator(adjudicator, { gender })}
                      />
                    </TD>
                    <TD>
                      <DiversityInput
                        label={t("setup.importsExtra.diversity.regionOf", { name: adjudicator.name })}
                        value={adjudicator.region}
                        placeholder={participantRegion({ institutionId: adjudicator.institutionId }, institutionsById)}
                        disabled={!isOwnerOrAdmin}
                        onSave={(region) => saveAdjudicator(adjudicator, { region })}
                      />
                    </TD>
                  </TR>
                ))}
            {rowCount === 0 && (
              <TableEmpty colSpan={4}>
                {kind === "speakers" ? t("setup.importsExtra.diversity.noSpeakers") : t("setup.importsExtra.diversity.noAdjudicators")}
              </TableEmpty>
            )}
          </TBody>
        </Table>
      </TableContainer>

      <Section
        title={t("setup.importsExtra.genderByInstitution.title")}
        description={t("setup.importsExtra.genderByInstitution.description")}
      >
        <InstitutionGenderTable institutions={institutions} teams={teams} adjudicators={adjudicators} />
      </Section>

      {tournament && (
        <Section title={t("setup.importsExtra.diversity.statistics")} description={t("setup.importsExtra.diversity.statisticsHelp")}>
          {statistics && <DiversityPanel diversity={statistics} />}
        </Section>
      )}
    </div>
  );
}
