"use client";

import React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n/I18nProvider";
import { useTournament } from "@/contexts/TournamentContext";
import { translatedSideName } from "@/lib/sideNames";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { Badge } from "@/components/ui/Badge";
import { SCORE_DISPLAY_OPTIONS } from "@/lib/scoreDisplay";
import type { BallotSubmission, Debate, DebateSide, Round, SpeakerScoreEntry, Team } from "@/types";
import type {
  PublicAdjudicatorTab,
  PublicDiversity,
  PublicDiversityAverage,
  PublicDiversityCount,
  PublicDerived,
  PublicSideAllocations,
} from "@/lib/publicView/derived";
import { bracketRounds, type BracketRound } from "@/lib/publicBracket";
import type { PublicDebateMotion } from "@/lib/publicRecords";

/**
 * Panels for the public-site features of waves 4–5. They render only what the public projection
 * published (names are already public names: code names or empty for redacted people).
 */

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} />
      {children}
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-[13px] text-fg-muted">{children}</p>;
}

/** Link to a public record page. */
export const publicRecordLinkClass = cn("rounded-sm hover:underline", focusRing);


/** A published person's name: "Redacted" for anonymous people, a placeholder for a missing code name. */
export function PublicPersonName({ name, anonymous }: { name?: string; anonymous?: boolean }) {
  const { t } = useI18n();
  if (anonymous) return <span className="italic text-fg-muted">{t("public.redacted")}</span>;
  return <>{name || t("public.noPublicName")}</>;
}

/**
 * A team as published: optional emoji, the public name (code-name tooltip in "all-tooltips" mode)
 * and a link to its record page when record pages are public.
 */
export function PublicTeamName({
  team,
  name,
  recordHref,
}: {
  team?: Pick<Team, "name" | "codeName" | "emoji">;
  name?: string;
  recordHref?: string;
}) {
  const { t } = useI18n();
  const label = name ?? team?.name ?? "";
  const shown = label || t("public.noPublicName");
  const content = (
    <>
      {team?.emoji && <span aria-hidden="true" className="me-1">{team.emoji}</span>}
      {team?.codeName ? (
        <abbr title={t("public.codeNameTooltip", { code: team.codeName })} className="no-underline">
          {shown}
        </abbr>
      ) : (
        shown
      )}
    </>
  );
  if (!recordHref) return content;
  return (
    <Link
      href={recordHref}
      className={publicRecordLinkClass}
      aria-label={t("public.recordLink", { name: shown })}
    >
      {content}
    </Link>
  );
}

/**
 * The motion a debate was held on (Tabbycat `show_motions_in_results`): its reference, with the
 * full text in a tooltip and for screen readers.
 */
export function PublicDebateMotionLabel({ motion }: { motion?: PublicDebateMotion }) {
  const { t } = useI18n();
  if (!motion) return <>—</>;
  const reference = motion.reference || t("public.motionFallback");
  return (
    <abbr title={motion.text} className="no-underline">
      <span aria-hidden="true">{reference}</span>
      <span className="sr-only">{reference}: {motion.text}</span>
    </abbr>
  );
}

export function WelcomePanel({ message, staff }: { message: string; staff: string }) {
  const { t } = useI18n();
  if (!message && !staff) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {message && (
        <Panel title={t("public.welcomeTitle")}>
          <p className="p-4 text-sm text-fg whitespace-pre-line">{message}</p>
        </Panel>
      )}
      {staff && (
        <Panel title={t("public.staffTitle")}>
          <p className="p-4 text-sm text-fg whitespace-pre-line">{staff}</p>
        </Panel>
      )}
    </div>
  );
}

type PublicBallot = BallotSubmission & { splitAdjudicatorIds?: string[] };

export function splittingAdjudicators(ballot: BallotSubmission | undefined): Set<string> {
  return new Set((ballot as PublicBallot | undefined)?.splitAdjudicatorIds ?? []);
}

/** Marks an adjudicator who voted for the losing team. */
export function SplitMarker() {
  const { t } = useI18n();
  return (
    <span title={t("public.splitHint")} className="ms-1 rounded border border-warning-border bg-warning-subtle px-1 text-[11px] font-semibold text-warning">
      {t("public.split")}
    </span>
  );
}

function SpeechRows({ entries, replyPosition }: { entries: SpeakerScoreEntry[]; replyPosition?: number }) {
  const { t, formatNumber } = useI18n();
  return (
    <>
      {entries.map((entry, index) => (
        <TR key={`${entry.speakerId}-${entry.position}-${index}`}>
          <TD className="text-xs text-fg-muted">
            {replyPosition !== undefined && entry.position === replyPosition
              ? t("public.scoresheet.reply")
              : t("public.scoresheet.speech", { position: entry.position })}
          </TD>
          <TD className="text-xs text-fg">
            <PublicPersonName name={entry.speakerName} anonymous={(entry as { anonymous?: boolean }).anonymous} />
          </TD>
          <TD className="text-end font-mono text-xs">{formatNumber(entry.score, SCORE_DISPLAY_OPTIONS)}</TD>
        </TR>
      ))}
    </>
  );
}

/**
 * One debate's scoresheets: each adjudicator's sheet for voting ballots, otherwise the panel's
 * ballot. Rendered from the stored structure (sides -> speeches), so sheets with extra score fields
 * still show their speeches and totals.
 */
export function ScoresheetsPanel({
  debate,
  ballot,
  sides,
  teamName,
  replyPosition,
}: {
  debate: Debate;
  ballot?: BallotSubmission;
  sides: DebateSide[];
  teamName: (side: DebateSide) => string;
  replyPosition?: number;
}) {
  const { t, formatNumber } = useI18n();
  const { tournament } = useTournament();
  const splits = splittingAdjudicators(ballot);
  const sheets = ballot?.sheets?.length
    ? ballot.sheets.map((sheet) => ({
        key: sheet.adjudicatorId,
        title: t("public.scoresheet.adjudicator", { name: sheet.adjudicatorName || t("public.redacted") }),
        split: splits.has(sheet.adjudicatorId),
        speakerScores: sheet.speakerScores,
      }))
    : ballot && Object.keys(ballot.speakerScores || {}).length > 0
      ? [{ key: "panel", title: t("public.scoresheet.panel"), split: false, speakerScores: ballot.speakerScores }]
      : [];
  return (
    <div className="border-t border-border bg-muted p-3" aria-label={t("public.scoresheetsFor", { debate: debate.venueName || debate.id })}>
      {sheets.length === 0 ? (
        <p className="text-xs text-fg-muted">{t("public.scoresheet.none")}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sheets.map((sheet) => (
            <div key={sheet.key} className="rounded border border-border bg-surface">
              <p className="border-b border-border px-3 py-2 text-xs font-semibold text-fg">
                {sheet.title}
                {sheet.split && <SplitMarker />}
              </p>
              <div className="grid gap-2 p-2 sm:grid-cols-2">
                {sides.map((side) => {
                  const entries = (sheet.speakerScores?.[side] || []) as SpeakerScoreEntry[];
                  const total = entries
                    .filter((entry) => !entry.ghost)
                    .reduce((sum, entry) => sum + (Number.isFinite(entry.score) ? entry.score : 0), 0);
                  return (
                    <Table key={side} className="text-start">
                      <caption className="text-start text-[11px] font-semibold text-fg-muted pb-1">
                        {translatedSideName(t, side, tournament?.preferences)} · {teamName(side)}
                      </caption>
                      <TBody>
                        <SpeechRows entries={entries} replyPosition={replyPosition} />
                        <TR>
                          <TD colSpan={2} className="text-xs font-semibold">{t("public.scoresheet.total")}</TD>
                          <TD className="text-end font-mono text-xs font-semibold">{formatNumber(total, SCORE_DISPLAY_OPTIONS)}</TD>
                        </TR>
                      </TBody>
                    </Table>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdjudicatorTabPanel({ tab, recordHref }: { tab: PublicAdjudicatorTab; recordHref?: (id: string) => string | undefined }) {
  const { t, formatDecimal } = useI18n();
  const showBase = tab.shows !== "final";
  const showFinal = tab.shows !== "test";
  return (
    <Panel title={t("public.adjudicatorTabTitle")}>
      {tab.rows.length === 0 ? (
        <Empty>{t("public.adjudicatorTabEmpty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-start">
            <THead>
              <TR>
                <TH scope="col">{t("lists.col.adjudicator")}</TH>
                <TH scope="col">{t("lists.col.institution")}</TH>
                {tab.showUnaccredited && <TH scope="col">{t("lists.col.alwaysTrainee")}</TH>}
                {showBase && <TH scope="col" className="text-end">{t("public.col.baseScore")}</TH>}
                {tab.rounds.map((round) => (
                  <TH key={round.id} scope="col" className="text-end">{round.name}</TH>
                ))}
                {showFinal && <TH scope="col" className="text-end">{t("public.col.finalScore")}</TH>}
                {showFinal && <TH scope="col" className="text-end">{t("public.col.feedbackCount")}</TH>}
              </TR>
            </THead>
            <TBody>
              {tab.rows.map((row) => {
                const href = row.anonymous ? undefined : recordHref?.(row.adjudicatorId);
                const name = <PublicPersonName name={row.name} anonymous={row.anonymous} />;
                return (
                  <TR key={row.adjudicatorId}>
                    <TD className="text-xs font-semibold text-fg">
                      {href ? <Link href={href} className={publicRecordLinkClass}>{name}</Link> : name}
                    </TD>
                    <TD className="text-xs text-fg-muted">{row.institutionName || "—"}</TD>
                    {tab.showUnaccredited && <TD className="text-xs text-fg-muted">{row.trainee ? t("lists.alwaysTraineeYes") : "—"}</TD>}
                    {showBase && <TD className="text-end font-mono text-xs">{row.baseScore !== undefined ? formatDecimal(row.baseScore, 2) : "—"}</TD>}
                    {tab.rounds.map((round) => (
                      <TD key={round.id} className="text-end font-mono text-xs text-fg-muted">
                        {row.roundScores?.[round.id] !== undefined ? formatDecimal(row.roundScores[round.id], 2) : "—"}
                      </TD>
                    ))}
                    {showFinal && <TD className="text-end font-mono text-xs font-semibold text-accent-text">{row.finalScore !== undefined ? formatDecimal(row.finalScore, 2) : "—"}</TD>}
                    {showFinal && <TD className="text-end font-mono text-xs text-fg-muted">{row.feedbackCount ?? 0}</TD>}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

export function SideAllocationsPanel({
  allocations,
  teamsById,
}: {
  allocations: PublicSideAllocations;
  teamsById: Map<string, Team>;
}) {
  const { t } = useI18n();
  const { tournament } = useTournament();
  const teamIds = Object.keys(allocations.teams).sort((left, right) =>
    (teamsById.get(left)?.name ?? "").localeCompare(teamsById.get(right)?.name ?? "") || left.localeCompare(right)
  );
  return (
    <Panel title={t("public.sidesTitle")}>
      {teamIds.length === 0 ? (
        <Empty>{t("public.sidesEmpty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-start">
            <THead>
              <TR>
                <TH scope="col">{t("public.col.team")}</TH>
                {allocations.rounds.map((round) => <TH key={round.id} scope="col">{round.name}</TH>)}
              </TR>
            </THead>
            <TBody>
              {teamIds.map((teamId) => (
                <TR key={teamId}>
                  <TD className="text-xs font-semibold text-fg"><PublicTeamName team={teamsById.get(teamId)} /></TD>
                  {allocations.rounds.map((round) => {
                    const side = allocations.teams[teamId]?.[round.id];
                    return <TD key={round.id} className="text-xs">{side ? translatedSideName(t, side, tournament?.preferences) : "—"}</TD>;
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

function BracketColumn({ round, teamHref }: { round: BracketRound; teamHref?: (teamId: string) => string | undefined }) {
  const { t } = useI18n();
  return (
    <div className="min-w-[220px] flex-1 space-y-2">
      <h3 className="text-xs font-semibold uppercase text-fg-muted">{round.name}</h3>
      {round.matches.map((match) => (
        <div key={match.debateId} className="rounded border border-border bg-surface">
          {match.teams.map((team) => (
            <div
              key={`${match.debateId}-${team.side}`}
              className={`flex items-center justify-between gap-2 px-2 py-1.5 text-xs border-b last:border-b-0 border-border ${
                team.advanced ? "font-semibold text-fg" : "text-fg-muted"
              }`}
            >
              <span className="min-w-0 truncate">
                {team.seed !== undefined && <span className="me-1 font-mono text-[11px] text-fg-muted">{team.seed}</span>}
                <PublicTeamName name={team.name} team={team.team} recordHref={teamHref?.(team.teamId)} />
              </span>
              {team.advanced && <Badge tone="success">{t("public.advances")}</Badge>}
            </div>
          ))}
          {match.venueName && <p className="px-2 py-1 text-[11px] text-fg-muted">{match.venueName}</p>}
        </div>
      ))}
    </div>
  );
}

export function BracketPanel({
  rounds,
  debates,
  ballots,
  teamsById,
  isBP,
  teamHref,
}: {
  rounds: Round[];
  debates: Debate[];
  ballots: BallotSubmission[];
  teamsById: Map<string, Team>;
  isBP: boolean;
  teamHref?: (teamId: string) => string | undefined;
}) {
  const { t } = useI18n();
  const columns = bracketRounds(rounds, debates, ballots, teamsById, isBP);
  return (
    <Panel title={t("public.bracketTitle")}>
      {columns.length === 0 ? (
        <Empty>{t("public.bracketEmpty")}</Empty>
      ) : (
        <div className="flex gap-4 overflow-x-auto p-3">
          {columns.map((round) => <BracketColumn key={round.id} round={round} teamHref={teamHref} />)}
        </div>
      )}
    </Panel>
  );
}

function DiversityTable({ title, rows, total }: { title: string; rows: PublicDiversityCount[]; total?: number }) {
  const { t, formatNumber } = useI18n();
  const sum = total ?? rows.reduce((value, row) => value + row.count, 0);
  return (
    <div>
      <h3 className="px-3 pt-3 text-[11px] font-semibold uppercase text-fg-muted">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-fg-muted">{t("public.diversity.empty")}</p>
      ) : (
        <Table className="text-start">
          <TBody>
            {rows.map((row) => (
              <TR key={row.label ?? "unspecified"}>
                <TD className="text-xs">{row.label ?? t("public.diversity.unspecified")}</TD>
                <TD className="text-end font-mono text-xs">{row.count}</TD>
                <TD className="text-end font-mono text-xs text-fg-muted">
                  {sum > 0 ? formatNumber(row.count / sum, { style: "percent", maximumFractionDigits: 0 }) : "—"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

function AverageTable({ title, rows }: { title: string; rows: PublicDiversityAverage[] }) {
  const { t, formatDecimal } = useI18n();
  return (
    <div>
      <h3 className="px-3 pt-3 text-[11px] font-semibold uppercase text-fg-muted">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-fg-muted">{t("public.diversity.empty")}</p>
      ) : (
        <Table className="text-start">
          <THead>
            <TR>
              <TH scope="col">{t("public.diversity.gender")}</TH>
              <TH scope="col" className="text-end">{t("public.diversity.count")}</TH>
              <TH scope="col" className="text-end">{t("public.diversity.average")}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.label ?? "unspecified"}>
                <TD className="text-xs">{row.label ?? t("public.diversity.unspecified")}</TD>
                <TD className="text-end font-mono text-xs">{row.count}</TD>
                <TD className="text-end font-mono text-xs">{formatDecimal(row.average, 2)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

export function DiversityPanel({ diversity }: { diversity: PublicDiversity }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={t("public.diversity.speakers", { count: diversity.speakers.total })}>
        <DiversityTable title={t("public.diversity.gender")} rows={diversity.speakers.gender} />
        <DiversityTable title={t("public.diversity.region")} rows={diversity.speakers.region} />
        {diversity.speakers.categories.length > 0 && (
          <DiversityTable title={t("public.diversity.categories")} rows={diversity.speakers.categories} total={diversity.speakers.total} />
        )}
        <AverageTable title={t("public.diversity.speakerScores")} rows={diversity.speakerScores} />
      </Panel>
      <Panel title={t("public.diversity.adjudicators", { count: diversity.adjudicators.total })}>
        <DiversityTable title={t("public.diversity.gender")} rows={diversity.adjudicators.gender} />
        <DiversityTable title={t("public.diversity.region")} rows={diversity.adjudicators.region} />
        {diversity.adjudicators.roles
          .filter((role) => role.role !== "all")
          .map((role) => (
            <DiversityTable key={role.role} title={t(`public.diversity.role.${role.role}`)} rows={role.gender} />
          ))}
        <AverageTable title={t("public.diversity.feedbackReceived")} rows={diversity.feedbackReceived} />
        <AverageTable title={t("public.diversity.feedbackGiven")} rows={diversity.feedbackGiven} />
      </Panel>
    </div>
  );
}

export function FeedbackProgressPanel({ progress }: { progress: NonNullable<PublicDerived["feedbackProgress"]> }) {
  const { t, plural } = useI18n();
  return (
    <Panel title={t("public.feedbackProgressTitle")} description={t("public.feedbackProgressHint")}>
      {progress.rows.length === 0 ? (
        <Empty>{t("public.feedbackProgressEmpty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-start">
            <THead>
              <TR>
                <TH scope="col">{t("lists.col.team")} / {t("lists.col.adjudicator")}</TH>
                <TH scope="col" className="text-end">{t("public.col.submitted")}</TH>
                <TH scope="col" className="text-end">{t("public.col.owed")}</TH>
              </TR>
            </THead>
            <TBody>
              {progress.rows.map((row) => {
                const owed = row.expected - row.submitted;
                return (
                  <TR key={`${row.sourceType}-${row.sourceId}`}>
                    <TD className="text-xs">
                      <span className="me-2 text-[11px] uppercase text-fg-muted">
                        {row.sourceType === "team" ? t("lists.col.team") : t("lists.col.adjudicator")}
                      </span>
                      <span className="font-semibold text-fg"><PublicPersonName name={row.name} /></span>
                    </TD>
                    <TD className="text-end font-mono text-xs">
                      {row.submitted} / {row.expected}
                      {row.unexpected ? (
                        <span className="ms-2 text-fg-muted" title={plural("public.feedbackUnexpected", row.unexpected)}>
                          <span aria-hidden="true">+{row.unexpected}?</span>
                          <span className="sr-only">{plural("public.feedbackUnexpected", row.unexpected)}</span>
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-end text-xs">
                      {owed === 0 ? <Badge tone="success">{t("public.feedbackComplete")}</Badge> : <Badge tone="warning">{owed}</Badge>}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
