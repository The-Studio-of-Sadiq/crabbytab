"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicShell } from "@/components/public/PublicShell";
import { Alert } from "@/components/ui/Feedback";
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

interface PublicCheckInStatus {
  tournamentName: string;
  updatedAt: string;
  rounds: PublicRoundStatus[];
}

export default function PublicCheckinsPage() {
  const params = useParams<{ tournamentSlug: string }>();
  const [status, setStatus] = useState<PublicCheckInStatus | null>(null);
  const [error, setError] = useState("");
  const { t, formatTime, formatNumber } = useI18n();

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
        description={t("publicCheckins.description")}
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
          <p className="text-xs text-fg-muted">{t("publicCheckins.updated", { time: formatTime(status.updatedAt) })}</p>
        </>
      )}
    </PublicShell>
  );
}
