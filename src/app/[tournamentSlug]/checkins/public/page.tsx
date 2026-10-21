"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicShell } from "@/components/public/PublicShell";
import { Alert } from "@/components/ui/Feedback";
import { StatusPill } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";

// Sentinel for "no server message": translated at render time so a language switch applies to it.
const LOAD_ERROR = "__load_error__";

interface PublicRoundStatus {
  id: string;
  name: string;
  teamsPresent: number;
  teamsTotal: number;
  adjudicatorsPresent: number;
  adjudicatorsTotal: number;
}

interface PublicPersonStatus {
  name: string;
  /** Round id -> checked in (available) for that round. */
  present: Record<string, boolean>;
}

interface PublicCheckInStatus {
  tournamentName: string;
  updatedAt: string;
  rounds: PublicRoundStatus[];
  /** Per-person list; present only when the participants list is public too. */
  people?: { teams: PublicPersonStatus[]; adjudicators: PublicPersonStatus[] };
}

/** One table of the per-person list (teams or adjudicators) for the chosen round. */
function PeopleTable({
  caption,
  people,
  roundId,
  query,
}: {
  caption: string;
  people: PublicPersonStatus[];
  roundId: string;
  query: string;
}) {
  const { t } = useI18n();
  const needle = query.trim().toLowerCase();
  const shown = people.filter((person) => !needle || person.name.toLowerCase().includes(needle));
  return (
    <TableContainer>
      <Table className="text-start">
        <caption className="px-3 py-2 text-start text-[13px] font-semibold text-fg">{caption}</caption>
        <THead>
          <TR>
            <TH className="text-start">{t("publicCheckins.col.name")}</TH>
            <TH className="text-end">{t("publicCheckins.col.status")}</TH>
          </TR>
        </THead>
        <TBody>
          {shown.length === 0 && <TableEmpty colSpan={2}>{t("public.noRows")}</TableEmpty>}
          {shown.map((person, index) => (
            <TR key={`${person.name}-${index}`}>
              <TD>{person.name || <span className="italic text-fg-muted">{t("public.noPublicName")}</span>}</TD>
              <TD className="text-end">
                {person.present[roundId] ? (
                  <StatusPill tone="success">{t("publicCheckins.checkedIn")}</StatusPill>
                ) : (
                  <StatusPill tone="neutral">{t("publicCheckins.notCheckedIn")}</StatusPill>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableContainer>
  );
}

export default function PublicCheckinsPage() {
  const params = useParams<{ tournamentSlug: string }>();
  const [status, setStatus] = useState<PublicCheckInStatus | null>(null);
  const [error, setError] = useState("");
  const [roundChoice, setRoundChoice] = useState("");
  const [query, setQuery] = useState("");
  const { t, formatTime, formatNumber } = useI18n();
  // The chosen round, else the latest one (Tabbycat shows the current check-in window).
  const listRoundId = useMemo(() => {
    const rounds = status?.rounds ?? [];
    return rounds.some((round) => round.id === roundChoice) ? roundChoice : rounds[rounds.length - 1]?.id ?? "";
  }, [status?.rounds, roundChoice]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/public/tournaments/${encodeURIComponent(params.tournamentSlug)}/checkins`,
          { cache: "no-store" }
        );
        const result = await response.json() as PublicCheckInStatus & { error?: string };
        if (!response.ok) throw new Error(result.error || LOAD_ERROR);
        if (active) {
          setStatus(result);
          setError("");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : LOAD_ERROR);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [params.tournamentSlug]);

  const errorMessage = error === LOAD_ERROR ? t("publicCheckins.loadError") : error;
  const tournamentName = status?.tournamentName || t("common.tournament");

  return (
    <PublicShell
      width="narrow"
      title={tournamentName}
      backHref={`/${params.tournamentSlug}/public`}
      backLabel={t("publicCheckins.back")}
    >
      <PageHeader
        title={status ? t("publicCheckins.heading", { tournament: tournamentName }) : t("publicCheckins.title")}
        description={status?.people ? t("publicCheckins.descriptionPeople") : t("publicCheckins.description")}
      />
      {error && <Alert role="alert" tone="warning">{errorMessage}</Alert>}
      {!status ? (
        !error && <p role="status" className="text-[13px] text-fg-muted">{t("publicCheckins.loading")}</p>
      ) : (
        <>
          <TableContainer>
            <Table className="text-start">
              <THead>
                <TR>
                  <TH className="text-start">{t("publicCheckins.col.round")}</TH>
                  <TH className="text-end">{t("publicCheckins.col.teams")}</TH>
                  <TH className="text-end">{t("publicCheckins.col.adjudicators")}</TH>
                </TR>
              </THead>
              <TBody>
                {status.rounds.length === 0 && <TableEmpty colSpan={3}>{t("public.noRows")}</TableEmpty>}
                {status.rounds.map((round) => (
                  <TR key={round.id}>
                    <TH scope="row" className="border-b border-border bg-transparent text-start text-[13px] font-medium normal-case tracking-normal text-fg">
                      {round.name}
                    </TH>
                    <TD numeric className="text-end">
                      {t("publicCheckins.ratio", { present: formatNumber(round.teamsPresent), total: formatNumber(round.teamsTotal) })}
                    </TD>
                    <TD numeric className="text-end">
                      {t("publicCheckins.ratio", {
                        present: formatNumber(round.adjudicatorsPresent),
                        total: formatNumber(round.adjudicatorsTotal),
                      })}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
          {status.people && listRoundId && (
            <section aria-labelledby="public-checkins-people" className="space-y-3">
              <h2 id="public-checkins-people" className="text-sm font-semibold text-fg">
                {t("publicCheckins.peopleTitle")}
              </h2>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  label={t("publicCheckins.col.round")}
                  value={listRoundId}
                  onChange={(event) => setRoundChoice(event.target.value)}
                  className="w-auto min-w-40"
                >
                  {status.rounds.map((round) => (
                    <option key={round.id} value={round.id}>{round.name}</option>
                  ))}
                </Select>
                <Input
                  type="search"
                  label={t("publicCheckins.search")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  wrapperClassName="w-56"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <PeopleTable caption={t("publicCheckins.teamsList")} people={status.people.teams} roundId={listRoundId} query={query} />
                <PeopleTable
                  caption={t("publicCheckins.adjudicatorsList")}
                  people={status.people.adjudicators}
                  roundId={listRoundId}
                  query={query}
                />
              </div>
            </section>
          )}
          <p className="text-xs text-fg-muted">{t("publicCheckins.updated", { time: formatTime(status.updatedAt) })}</p>
        </>
      )}
    </PublicShell>
  );
}
