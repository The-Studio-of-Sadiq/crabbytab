"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Key } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Feedback";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { hasCodeName } from "@/lib/codeNames";
import { translatedSideName } from "@/lib/sideNames";
import { SCORE_DISPLAY_OPTIONS } from "@/lib/scoreDisplay";
import { adminTeamRecord, teamConflicts, teamFeedback, type AdminTeamRecordRow } from "@/lib/participants/teamRecord";
import { speakerCategoryNames, speakerCategoryRefs, effectiveSpeakerCategories } from "@/lib/speakerCategories";
import type { MessageKey } from "@/lib/i18n";

const CONFLICT_REASON: Record<ReturnType<typeof teamConflicts>[number]["reason"], MessageKey> = {
  personal: "setup.importsExtra.teamRecord.conflictPersonal",
  institution: "setup.importsExtra.teamRecord.conflictInstitution",
  team_institution: "setup.importsExtra.teamRecord.conflictTeamInstitution",
};

/**
 * Admin team record (Tabbycat participants-team-record): everything the tab room knows about one
 * team, whatever the public settings say, including unreleased results and the private URL.
 */
export default function AdminTeamRecordPage() {
  const params = useParams<{ tournamentSlug: string; teamId: string }>();
  const { tournament, teams, rounds, debates, ballots, adjudicators, feedback, breakCategories, isOwnerOrAdmin, loading } =
    useTournament();
  const { t, formatList, formatNumber, formatDecimal, formatDateTime } = useI18n();
  const team = teams.find((item) => item.id === params.teamId);

  const rows = useMemo(
    () => (team ? adminTeamRecord(team.id, { rounds, debates, ballots, adjudicators }) : []),
    [team, rounds, debates, ballots, adjudicators]
  );
  const conflicts = useMemo(() => (team ? teamConflicts(team, adjudicators) : []), [team, adjudicators]);
  const feedbackLists = useMemo(() => (team ? teamFeedback(team.id, feedback) : { submitted: [], received: [] }), [team, feedback]);
  const speakerCategories = useMemo(
    () => effectiveSpeakerCategories(tournament?.preferences.speakerCategories, teams),
    [tournament?.preferences.speakerCategories, teams]
  );
  const roundName = (roundId: string) => rounds.find((round) => round.id === roundId)?.name ?? "—";

  const backLink = (
    <Link
      href={`/${params.tournamentSlug}/imports/teams`}
      className={buttonClasses({ variant: "ghost", size: "sm", className: "-ms-2.5" })}
    >
      <ArrowLeft className="rtl:-scale-x-100" aria-hidden="true" />
      {t("setup.importsExtra.teamRecord.back")}
    </Link>
  );

  if (!loading && !isOwnerOrAdmin) {
    return (
      <div className="space-y-4">
        {backLink}
        <Alert tone="warning" role="alert" title={t("setup.importsExtra.teamRecord.adminOnly")} />
      </div>
    );
  }
  if (!team) {
    return (
      <div className="space-y-4">
        {backLink}
        <Alert tone="warning" role="alert" title={loading ? t("setup.importsExtra.teamRecord.loading") : t("setup.importsExtra.teamRecord.notFound")} />
      </div>
    );
  }

  const isBP = tournament?.format === "bp";
  const resultText = (row: AdminTeamRecordRow) => {
    if (row.bye) return t("setup.importsExtra.teamRecord.bye");
    if (!row.result) return row.status === "unconfirmed" ? t("setup.importsExtra.teamRecord.unconfirmed") : "—";
    const outcome = row.result.forfeit
      ? t("setup.importsExtra.teamRecord.forfeit")
      : (isBP || tournament?.format === "poly") && row.result.rank !== undefined
        ? t("setup.importsExtra.teamRecord.rank", { rank: row.result.rank })
        : tournament?.format === "poly"
          // N teams per room without a rank: advancing (results only) or scores only.
          ? row.result.win ? t("results.ballot.advances") : "—"
          : row.result.win
          ? t("setup.importsExtra.teamRecord.win")
          : t("setup.importsExtra.teamRecord.loss");
    return row.result.speakerTotal !== undefined
      ? t("setup.importsExtra.teamRecord.outcomeWithSpeaks", { outcome, speaks: formatNumber(row.result.speakerTotal, SCORE_DISPLAY_OPTIONS) })
      : outcome;
  };
  const categoryNames = (team.breakCategories ?? [])
    .map((id) => breakCategories.find((category) => category.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {backLink}
        <PageHeader
          title={team.emoji ? `${team.emoji} ${team.name}` : team.name}
          description={team.institutionName ?? t("setup.importsExtra.teamRecord.unaffiliated")}
          meta={hasCodeName(team) ? <Badge tone="accent">{t("setup.importsExtra.teamRecord.codeName", { name: team.codeName!.trim() })}</Badge> : undefined}
          actions={
            team.privateUrlKey ? (
              <Link
                href={`/${params.tournamentSlug}/private/team/${team.privateUrlKey}`}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({ variant: "secondary" })}
              >
                <Key aria-hidden="true" />
                {t("setup.importsExtra.teamRecord.privateUrl")}
              </Link>
            ) : undefined
          }
        />
      </div>

      <Card>
        <CardHeader title={t("setup.importsExtra.teamRecord.details")} />
        <CardBody className="space-y-2 text-[13px]">
          <p>
            <span className="font-medium">{t("setup.importsExtra.teamRecord.breakCategories")}</span>{" "}
            {categoryNames.length > 0 ? formatList(categoryNames) : "—"}
          </p>
          <ul className="space-y-1">
            {team.speakers.map((speaker) => {
              const categories = speakerCategoryNames(speakerCategoryRefs(speaker, team), speakerCategories);
              return (
                <li key={speaker.id}>
                  <span className="font-medium">{speaker.name || "—"}</span>
                  {speaker.pronoun && <span className="ms-1 text-fg-muted">({speaker.pronoun})</span>}
                  {speaker.email && <span className="ms-2 text-xs text-fg-muted">{speaker.email}</span>}
                  {categories.length > 0 && <span className="ms-2 text-xs text-fg-muted">{formatList(categories)}</span>}
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={t("setup.importsExtra.teamRecord.debates")} description={t("setup.importsExtra.teamRecord.debatesHelp")} />
        <TableContainer className="rounded-none border-0">
          <Table>
            <THead>
              <TR>
                <TH>{t("setup.importsExtra.teamRecord.colRound")}</TH>
                <TH>{t("setup.importsExtra.teamRecord.colSide")}</TH>
                <TH>{t("setup.importsExtra.teamRecord.colOpponents")}</TH>
                <TH>{t("setup.importsExtra.teamRecord.colPanel")}</TH>
                <TH>{t("setup.importsExtra.teamRecord.colResult")}</TH>
                <TH>{t("setup.importsExtra.teamRecord.colSpeeches")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.debateId}>
                  <TD className="font-medium">
                    {row.roundName}
                    {!row.released && row.status !== "none" && (
                      <Badge className="ms-2" tone="warning">{t("setup.importsExtra.teamRecord.unreleased")}</Badge>
                    )}
                  </TD>
                  <TD className="text-xs">{row.bye ? "—" : translatedSideName(t, row.side, tournament?.preferences)}</TD>
                  <TD className="text-xs">
                    {row.opponents.length > 0 ? formatList(row.opponents) : "—"}
                    {row.venueName && <span className="block text-[11px] text-fg-muted">{row.venueName}</span>}
                  </TD>
                  <TD className="text-xs text-fg-muted">
                    {[
                      ...(row.panel.chair ? [t("setup.importsExtra.teamRecord.chair", { name: row.panel.chair })] : []),
                      ...row.panel.panellists,
                      ...row.panel.trainees.map((name) => t("setup.importsExtra.teamRecord.trainee", { name })),
                    ].join(", ") || "—"}
                  </TD>
                  <TD className="text-xs">
                    {row.status === "confirmed" || row.bye ? (
                      resultText(row)
                    ) : (
                      <StatusPill tone={row.status === "unconfirmed" ? "warning" : "neutral"}>{resultText(row)}</StatusPill>
                    )}
                  </TD>
                  <TD className="font-mono text-xs">
                    {row.speeches.length === 0
                      ? "—"
                      : row.speeches
                          .map((speech) =>
                            `${speech.speakerName} ${formatNumber(speech.score, SCORE_DISPLAY_OPTIONS)}${speech.ghost ? "*" : ""}`
                          )
                          .join(" · ")}
                  </TD>
                </TR>
              ))}
              {rows.length === 0 && <TableEmpty colSpan={6}>{t("setup.importsExtra.teamRecord.noDebates")}</TableEmpty>}
            </TBody>
          </Table>
        </TableContainer>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={t("setup.importsExtra.teamRecord.conflicts")} />
        <TableContainer className="rounded-none border-0">
          <Table>
            <TBody>
              {conflicts.map((conflict) => (
                <TR key={conflict.adjudicatorId}>
                  <TD className="font-medium">{conflict.adjudicatorName}</TD>
                  <TD className="text-xs text-fg-muted">{t(CONFLICT_REASON[conflict.reason])}</TD>
                </TR>
              ))}
              {conflicts.length === 0 && <TableEmpty colSpan={2}>{t("setup.importsExtra.teamRecord.noConflicts")}</TableEmpty>}
            </TBody>
          </Table>
        </TableContainer>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title={t("setup.importsExtra.teamRecord.feedbackSubmitted")} />
        <TableContainer className="rounded-none border-0">
          <Table>
            <THead>
              <TR>
                <TH>{t("setup.importsExtra.teamRecord.colRound")}</TH>
                <TH>{t("setup.importsExtra.teamRecord.colOn")}</TH>
                <TH align="right">{t("setup.importsExtra.teamRecord.colScore")}</TH>
                <TH>{t("setup.importsExtra.teamRecord.colWhen")}</TH>
                <TH>{t("setup.importsExtra.teamRecord.colStatus")}</TH>
              </TR>
            </THead>
            <TBody>
              {feedbackLists.submitted.map((item) => (
                <TR key={item.id}>
                  <TD>{roundName(item.roundId)}</TD>
                  <TD>{item.targetAdjudicatorName || item.targetTeamName || "—"}</TD>
                  <TD numeric>{formatDecimal(item.score, 1)}</TD>
                  <TD className="text-xs text-fg-muted">{formatDateTime(item.timestamp) || item.timestamp}</TD>
                  <TD className="text-xs">
                    {item.ignored
                      ? t("setup.importsExtra.teamRecord.feedbackIgnored")
                      : item.confirmed
                        ? t("setup.importsExtra.teamRecord.feedbackConfirmed")
                        : t("setup.importsExtra.teamRecord.feedbackUnconfirmed")}
                  </TD>
                </TR>
              ))}
              {feedbackLists.submitted.length === 0 && (
                <TableEmpty colSpan={5}>{t("setup.importsExtra.teamRecord.noFeedback")}</TableEmpty>
              )}
            </TBody>
          </Table>
        </TableContainer>
      </Card>
    </div>
  );
}
