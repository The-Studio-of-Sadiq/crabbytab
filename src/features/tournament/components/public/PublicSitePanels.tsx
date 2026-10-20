"use client";

import React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n/I18nProvider";
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

/**
 * Panels for the public-site features of waves 4–5. They render only what the public projection
 * published (names are already public names: code names or empty for redacted people).
 */

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
      <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de]">
        <h2 className="font-bold text-xs text-gray-900">{title}</h2>
        {description && <p className="mt-0.5 text-[11px] text-gray-600">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-xs text-gray-500">{children}</p>;
}

/** A published person's name: "Redacted" for anonymous people, a placeholder for a missing code name. */
export function PublicPersonName({ name, anonymous }: { name?: string; anonymous?: boolean }) {
  const { t } = useI18n();
  if (anonymous) return <span className="italic text-gray-500">{t("public.redacted")}</span>;
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
      className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm"
      aria-label={t("public.recordLink", { name: shown })}
    >
      {content}
    </Link>
  );
}

export function WelcomePanel({ message, staff }: { message: string; staff: string }) {
  const { t } = useI18n();
  if (!message && !staff) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {message && (
        <Panel title={t("public.welcomeTitle")}>
          <p className="p-4 text-sm text-gray-800 whitespace-pre-line">{message}</p>
        </Panel>
      )}
      {staff && (
        <Panel title={t("public.staffTitle")}>
          <p className="p-4 text-sm text-gray-800 whitespace-pre-line">{staff}</p>
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
    <span title={t("public.splitHint")} className="ms-1 rounded border border-amber-300 bg-amber-50 px-1 text-[10px] font-semibold text-amber-800">
      {t("public.split")}
    </span>
  );
}

function SpeechRows({ entries, replyPosition }: { entries: SpeakerScoreEntry[]; replyPosition?: number }) {
  const { t, formatNumber } = useI18n();
  return (
    <>
      {entries.map((entry, index) => (
        <tr key={`${entry.speakerId}-${entry.position}-${index}`}>
          <td className="text-xs text-gray-500">
            {replyPosition !== undefined && entry.position === replyPosition
              ? t("public.scoresheet.reply")
              : t("public.scoresheet.speech", { position: entry.position })}
          </td>
          <td className="text-xs text-gray-900">
            <PublicPersonName name={entry.speakerName} anonymous={(entry as { anonymous?: boolean }).anonymous} />
          </td>
          <td className="text-end font-mono text-xs">{formatNumber(entry.score, SCORE_DISPLAY_OPTIONS)}</td>
        </tr>
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
    <div className="border-t border-[#d0d7de] bg-gray-50/60 p-3" aria-label={t("public.scoresheetsFor", { debate: debate.venueName || debate.id })}>
      {sheets.length === 0 ? (
        <p className="text-xs text-gray-500">{t("public.scoresheet.none")}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sheets.map((sheet) => (
            <div key={sheet.key} className="rounded border border-[#d0d7de] bg-white">
              <p className="border-b border-gray-100 px-3 py-2 text-xs font-semibold text-gray-900">
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
                    <table key={side} className="w-full text-start tabby-table">
                      <caption className="text-start text-[11px] font-bold text-gray-700 pb-1">
                        {t(`side.${side}` as "side.AFF")} · {teamName(side)}
                      </caption>
                      <tbody>
                        <SpeechRows entries={entries} replyPosition={replyPosition} />
                        <tr>
                          <td colSpan={2} className="text-xs font-semibold">{t("public.scoresheet.total")}</td>
                          <td className="text-end font-mono text-xs font-semibold">{formatNumber(total, SCORE_DISPLAY_OPTIONS)}</td>
                        </tr>
                      </tbody>
                    </table>
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
          <table className="w-full text-start tabby-table">
            <thead>
              <tr>
                <th scope="col">{t("lists.col.adjudicator")}</th>
                <th scope="col">{t("lists.col.institution")}</th>
                {showBase && <th scope="col" className="text-end">{t("public.col.baseScore")}</th>}
                {tab.rounds.map((round) => (
                  <th key={round.id} scope="col" className="text-end">{round.name}</th>
                ))}
                {showFinal && <th scope="col" className="text-end">{t("public.col.finalScore")}</th>}
                {showFinal && <th scope="col" className="text-end">{t("public.col.feedbackCount")}</th>}
              </tr>
            </thead>
            <tbody>
              {tab.rows.map((row) => {
                const href = row.anonymous ? undefined : recordHref?.(row.adjudicatorId);
                const name = <PublicPersonName name={row.name} anonymous={row.anonymous} />;
                return (
                  <tr key={row.adjudicatorId}>
                    <td className="text-xs font-semibold text-gray-900">
                      {href ? <Link href={href} className="hover:underline">{name}</Link> : name}
                    </td>
                    <td className="text-xs text-gray-600">{row.institutionName || "—"}</td>
                    {showBase && <td className="text-end font-mono text-xs">{row.baseScore !== undefined ? formatDecimal(row.baseScore, 2) : "—"}</td>}
                    {tab.rounds.map((round) => (
                      <td key={round.id} className="text-end font-mono text-xs text-gray-600">
                        {row.roundScores?.[round.id] !== undefined ? formatDecimal(row.roundScores[round.id], 2) : "—"}
                      </td>
                    ))}
                    {showFinal && <td className="text-end font-mono text-xs font-bold text-blue-700">{row.finalScore !== undefined ? formatDecimal(row.finalScore, 2) : "—"}</td>}
                    {showFinal && <td className="text-end font-mono text-xs text-gray-600">{row.feedbackCount ?? 0}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
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
  const teamIds = Object.keys(allocations.teams).sort((left, right) =>
    (teamsById.get(left)?.name ?? "").localeCompare(teamsById.get(right)?.name ?? "") || left.localeCompare(right)
  );
  return (
    <Panel title={t("public.sidesTitle")}>
      {teamIds.length === 0 ? (
        <Empty>{t("public.sidesEmpty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start tabby-table">
            <thead>
              <tr>
                <th scope="col">{t("public.col.team")}</th>
                {allocations.rounds.map((round) => <th key={round.id} scope="col">{round.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {teamIds.map((teamId) => (
                <tr key={teamId}>
                  <td className="text-xs font-semibold text-gray-900"><PublicTeamName team={teamsById.get(teamId)} /></td>
                  {allocations.rounds.map((round) => {
                    const side = allocations.teams[teamId]?.[round.id];
                    return <td key={round.id} className="text-xs">{side ? t(`side.${side}`) : "—"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function BracketColumn({ round, teamHref }: { round: BracketRound; teamHref?: (teamId: string) => string | undefined }) {
  const { t } = useI18n();
  return (
    <div className="min-w-[220px] flex-1 space-y-2">
      <h3 className="text-xs font-bold uppercase text-gray-600">{round.name}</h3>
      {round.matches.map((match) => (
        <div key={match.debateId} className="rounded border border-[#d0d7de] bg-white">
          {match.teams.map((team) => (
            <div
              key={`${match.debateId}-${team.side}`}
              className={`flex items-center justify-between gap-2 px-2 py-1.5 text-xs border-b last:border-b-0 border-gray-100 ${
                team.advanced ? "font-bold text-gray-900" : "text-gray-700"
              }`}
            >
              <span className="min-w-0 truncate">
                {team.seed !== undefined && <span className="me-1 font-mono text-[10px] text-gray-500">{team.seed}</span>}
                <PublicTeamName name={team.name} team={team.team} recordHref={teamHref?.(team.teamId)} />
              </span>
              {team.advanced && <Badge tone="success">{t("public.advances")}</Badge>}
            </div>
          ))}
          {match.venueName && <p className="px-2 py-1 text-[10px] text-gray-500">{match.venueName}</p>}
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
      <h3 className="px-3 pt-3 text-[11px] font-bold uppercase text-gray-600">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-gray-500">{t("public.diversity.empty")}</p>
      ) : (
        <table className="w-full text-start tabby-table">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label ?? "unspecified"}>
                <td className="text-xs">{row.label ?? t("public.diversity.unspecified")}</td>
                <td className="text-end font-mono text-xs">{row.count}</td>
                <td className="text-end font-mono text-xs text-gray-500">
                  {sum > 0 ? formatNumber(row.count / sum, { style: "percent", maximumFractionDigits: 0 }) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AverageTable({ title, rows }: { title: string; rows: PublicDiversityAverage[] }) {
  const { t, formatDecimal } = useI18n();
  return (
    <div>
      <h3 className="px-3 pt-3 text-[11px] font-bold uppercase text-gray-600">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-xs text-gray-500">{t("public.diversity.empty")}</p>
      ) : (
        <table className="w-full text-start tabby-table">
          <thead>
            <tr>
              <th scope="col">{t("public.diversity.gender")}</th>
              <th scope="col" className="text-end">{t("public.diversity.count")}</th>
              <th scope="col" className="text-end">{t("public.diversity.average")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label ?? "unspecified"}>
                <td className="text-xs">{row.label ?? t("public.diversity.unspecified")}</td>
                <td className="text-end font-mono text-xs">{row.count}</td>
                <td className="text-end font-mono text-xs">{formatDecimal(row.average, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const { t } = useI18n();
  return (
    <Panel title={t("public.feedbackProgressTitle")} description={t("public.feedbackProgressHint")}>
      {progress.rows.length === 0 ? (
        <Empty>{t("public.feedbackProgressEmpty")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start tabby-table">
            <thead>
              <tr>
                <th scope="col">{t("lists.col.team")} / {t("lists.col.adjudicator")}</th>
                <th scope="col" className="text-end">{t("public.col.submitted")}</th>
                <th scope="col" className="text-end">{t("public.col.owed")}</th>
              </tr>
            </thead>
            <tbody>
              {progress.rows.map((row) => {
                const owed = row.expected - row.submitted;
                return (
                  <tr key={`${row.sourceType}-${row.sourceId}`}>
                    <td className="text-xs">
                      <span className="me-2 text-[10px] uppercase text-gray-500">
                        {row.sourceType === "team" ? t("lists.col.team") : t("lists.col.adjudicator")}
                      </span>
                      <span className="font-semibold text-gray-900"><PublicPersonName name={row.name} /></span>
                    </td>
                    <td className="text-end font-mono text-xs">{row.submitted} / {row.expected}</td>
                    <td className="text-end text-xs">
                      {owed === 0 ? <Badge tone="success">{t("public.feedbackComplete")}</Badge> : <Badge tone="warning">{owed}</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
