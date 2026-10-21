"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { Code39Barcode } from "@/components/ui/Code39Barcode";
import {
  expectedBallotSheets,
  usesPerAdjudicatorSheets,
} from "@/features/tournament/application/ballotIntake";
import type { DebateSide, ScoreCriterion } from "@/types";
import { sidesPending } from "@/lib/draw/manualSides";
import { usesSpeakerScores } from "@/lib/ballots/result";
import {
  criteriaForSpeech,
  motionsEnabled,
  scoreCriteriaFor,
  speakerRanksFor,
  winnerDeclarationFor,
} from "@/lib/ballots/ballotRules";
import { sideLabel, translatedSideName } from "@/lib/sideNames";
import { debateSides, isPolyFormat } from "@/lib/debateSides";
import { PrintOptionsCard, usePrintTranslator } from "@/features/tournament/components/PrintOptionsCard";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button, buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Feedback";
import { returnLocation } from "@/lib/printOptions";
import { nameWithPronoun } from "@/lib/participants/person";

export default function PrintableBallotsPage() {
  const { tournament, activeRound, debates, teams, adjudicators, saveTournament } = useTournament();
  const { t, rich } = useI18n();
  // The printed sheets use the tournament's language; the on-screen controls the viewer's.
  const sheetText = usePrintTranslator(tournament);
  const pt = sheetText.t;
  const hideMotions = tournament?.preferences?.ballotsHideMotions === true;
  const confirmDigits = tournament?.preferences?.ballotsConfirmDigits === true;
  const returnTo = returnLocation(tournament?.preferences?.ballotReturnLocation);
  const roundDebates = activeRound
    ? debates
        .filter((debate) => debate.roundId === activeRound.id && !debate.byeTeamId)
        .sort((left, right) => left.roomRank - right.roomRank)
    : [];
  const isBP = tournament?.format === "bp";
  const poly = isPolyFormat(tournament?.format);
  const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const adjudicatorMap = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const speakerCount = tournament?.preferences?.substantiveSpeakers ?? (isBP ? 2 : 3);
  const replyEnabled = Boolean(tournament?.preferences?.replyScoresEnabled && !isBP);
  // Voting panels get one sheet per voting adjudicator; consensus panels one per debate.
  const perAdjudicator = usesPerAdjudicatorSheets(activeRound, {
    format: tournament?.format || "bp",
    preferences: tournament?.preferences,
  });
  const preferences = tournament?.preferences;
  const ballotRules = { format: tournament?.format || "bp" as const, preferences, stage: activeRound?.stage };
  // Results-only rounds print no score columns; criteria get a column each; speech ranks a column
  // on consensus sheets; declared winners a tick box (two-team formats).
  const scored = usesSpeakerScores(ballotRules);
  const criteria = scored ? scoreCriteriaFor(preferences) : [];
  const ranked = scored && !perAdjudicator && speakerRanksFor(preferences) !== "none";
  // Poly sheets: scored rooms are ranked on the totals; results-only rooms tick the advancing teams.
  const declaresWinner = poly ? !scored : !isBP && (!scored || winnerDeclarationFor(preferences) !== "none");
  // BP positions keep their (language-neutral) abbreviations; two-team sides use the translated name.
  const label = (side: DebateSide) => (isBP ? sideLabel(side, preferences) : translatedSideName(pt, side, preferences));
  const sheets = roundDebates.flatMap((debate) =>
    expectedBallotSheets(debate, adjudicators, perAdjudicator).map((sheet, index, all) => ({
      debate,
      sheet,
      position: index + 1,
      of: all.length,
    }))
  );

  return (
    <>
      <main className="space-y-6 screen-only">
        <Link
          href={`/${tournament?.slug}/results`}
          className={buttonClasses({ variant: "ghost", size: "sm", className: "-ml-2" })}
        >
          <ArrowLeft aria-hidden="true" />
          {t("tabroom.ops.print.backToResults")}
        </Link>
        <PageHeader
          title={t("tabroom.ops.print.ballotsTitle")}
          description={
            <>
              <span className="block">
                {t("tabroom.ops.print.ballotsSummary", {
                  round: activeRound?.name ?? t("tabroom.ops.print.noActiveRound"),
                  debates: roundDebates.length,
                  sheets: sheets.length,
                })}{" "}
                {perAdjudicator ? t("tabroom.ops.print.perAdjudicator") : t("tabroom.ops.print.perDebate")}
              </span>
              <span className="mt-1 block text-xs">
                {rich("tabroom.ops.print.ballotsIntake", {
                  link: (text) => (
                    <Link href={`/${tournament?.slug}/results/intake`} className="font-medium text-accent-text hover:underline">
                      {text}
                    </Link>
                  ),
                })}
              </span>
            </>
          }
          actions={
            <Button onClick={() => window.print()} disabled={sheets.length === 0}>
              <Printer aria-hidden="true" />
              {t("tabroom.ops.print.printButton")}
            </Button>
          }
        />
        {!activeRound && <Alert tone="warning">{t("tabroom.ops.print.selectRound")}</Alert>}
        {tournament && <PrintOptionsCard tournament={tournament} onSave={saveTournament} kind="ballots" />}
      </main>

      <section className="print-only printable-ballots" lang={sheetText.locale}>
        {sheets.map(({ debate, sheet, position, of }) => {
          const panelIds = [
            debate.adjudicators?.chairId,
            ...(debate.adjudicators?.panellistIds ?? []),
          ].filter((id): id is string => Boolean(id));
          const panelNames = panelIds.map((id) => {
            const adjudicator = adjudicatorMap.get(id);
            return adjudicator ? nameWithPronoun(adjudicator) : id;
          });
          const room = debate.venueName || pt("tabroom.ops.sheet.room", { number: debate.roomRank });
          // A poly room lists its own positions (the last random room may be short).
          const roomSides = poly && tournament ? debateSides(debate, tournament) : sides;
          // Sides chosen at the debate: the adjudicator ticks each team's side on the sheet.
          const sideChoice = sidesPending(debate) ? sides : undefined;

          return (
            <article key={sheet.code} className="print-ballot">
              <header className="ballot-header">
                <div>
                  <h1>{tournament?.name}</h1>
                  <p>{pt("tabroom.ops.sheet.debateLine", { round: activeRound?.name ?? "", number: debate.roomRank })}</p>
                  {sheet.adjudicatorId && (
                    <p>
                      {sheetText.rich(
                        "tabroom.ops.sheet.adjudicatorLine",
                        { b: (text) => <strong>{text}</strong> },
                        { name: sheet.adjudicatorName ?? "", position, total: of }
                      )}
                    </p>
                  )}
                </div>
                <div className="ballot-room">
                  <strong>{room}</strong>
                  {motionsEnabled(preferences) && (
                    <span>{pt("tabroom.ops.sheet.motion", { motion: (!hideMotions && debate.motionText) || "________________________________" })}</span>
                  )}
                </div>
              </header>
              <div className="ballot-sheet-id">
                <Code39Barcode value={sheet.sheetId} label={pt("tabroom.ops.sheet.barcodeLabel", { room })} />
                <span>
                  {sheetText.rich("tabroom.ops.sheet.sheetId", { b: (text) => <strong>{text}</strong> }, { id: sheet.sheetId })}
                  <br />
                  {activeRound?.abbreviation || activeRound?.name} · {room}
                </span>
              </div>
              {sideChoice && (
                <p className="ballot-intro">
                  {sheetText.rich(
                    "tabroom.ops.sheet.sidesNotSet",
                    { b: (text) => <strong>{text}</strong> },
                    { sides: sides.map(label).join(" / ") }
                  )}
                </p>
              )}
              {confirmDigits && (
                <p className="ballot-intro">
                  {pt("tabroom.ops.sheet.confirmDigits")}
                </p>
              )}
              {tournament?.preferences?.ballotIntroExplanation && (
                <p className="ballot-intro">{tournament.preferences.ballotIntroExplanation}</p>
              )}
              <table className="ballot-score-table">
                <thead>
                  <tr>
                    <th>{pt("tabroom.ops.sheet.colSide")}</th>
                    <th>{pt("tabroom.ops.sheet.colTeamSpeaker")}</th>
                    {criteria.map((criterion) => <th key={criterion.id}>{criterion.name} ({criterion.minScore}–{criterion.maxScore})</th>)}
                    {scored && <th>{pt("tabroom.ops.sheet.colSpeakerScore")}</th>}
                    {ranked && <th>{pt("tabroom.ops.sheet.colSpeechRank")}</th>}
                    <th>
                      {isBP
                        ? pt("tabroom.ops.sheet.colRank")
                        : declaresWinner
                          ? pt("tabroom.ops.sheet.colWinner")
                          : pt("tabroom.ops.sheet.colTeamTotal")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {roomSides.map((side) => {
                    const slot = debate.teams[side];
                    const team = slot ? teamMap.get(slot.teamId) : undefined;
                    const speakers = team?.speakers ?? [];
                    return (
                      <FragmentRows
                        key={side}
                        side={side}
                        label={label}
                        criteria={criteria}
                        scored={scored}
                        ranked={ranked}
                        winnerBox={declaresWinner}
                        replyIndex={replyEnabled && scored ? speakerCount : -1}
                        sideChoice={sideChoice}
                        confirmDigits={confirmDigits}
                        teamName={slot?.teamName ?? team?.name ?? pt("tabroom.ops.sheet.unassigned")}
                        speakerNames={scored
                          ? Array.from({ length: speakerCount }, (_, index) =>
                              (speakers[index]?.name ? nameWithPronoun(speakers[index]) : pt("tabroom.ops.sheet.speakerN", { number: index + 1 }))
                            ).concat(replyEnabled ? [pt("tabroom.ops.sheet.reply")] : [])
                          : [""]}
                      />
                    );
                  })}
                </tbody>
              </table>
              <section className="ballot-notes">
                <strong>{pt("tabroom.ops.sheet.notes")}</strong>
                <div />
                <div />
              </section>
              <footer className="ballot-footer">
                <span>{pt("tabroom.ops.sheet.chair", { name: panelNames[0] || "________________________" })}</span>
                <span>{pt("tabroom.ops.sheet.panel", { names: panelNames.slice(1).join(", ") || "________________________" })}</span>
                <span>
                  {sheet.adjudicatorId
                    ? pt("tabroom.ops.sheet.adjudicatorSignature", { name: sheet.adjudicatorName ?? "", blank: "________________________" })
                    : pt("tabroom.ops.sheet.chairSignature", { blank: "________________________" })}
                </span>
                {returnTo && <span><strong>{pt("tabroom.ops.sheet.returnSheet", { place: returnTo })}</strong></span>}
              </footer>
            </article>
          );
        })}
      </section>
    </>
  );
}

function FragmentRows({
  side,
  label,
  criteria,
  scored,
  ranked,
  winnerBox,
  replyIndex,
  sideChoice,
  confirmDigits,
  teamName,
  speakerNames,
}: {
  side: DebateSide;
  label: (side: DebateSide) => string;
  criteria: ScoreCriterion[];
  scored: boolean;
  ranked: boolean;
  winnerBox: boolean;
  /** Row index of the reply speech, or -1. */
  replyIndex: number;
  /** Sides to tick from, when sides are chosen at the debate. */
  sideChoice?: DebateSide[];
  /** Tabbycat's ballots_confirm_digits: a strip of digits to circle next to each score. */
  confirmDigits?: boolean;
  teamName: string;
  speakerNames: string[];
}) {
  return (
    <>
      {speakerNames.map((speakerName, index) => (
        <tr key={`${side}-${index}`}>
          {index === 0 && (
            <th rowSpan={speakerNames.length}>
              {sideChoice ? sideChoice.map((choice) => <span key={choice} style={{ display: "block" }}>☐ {label(choice)}</span>) : label(side)}
            </th>
          )}
          <td>{index === 0 ? <strong>{teamName}</strong> : null}<span>{speakerName}</span></td>
          {criteria.map((criterion) => (
            <td key={criterion.id} className="blank-score">
              {criteriaForSpeech([criterion], index === replyIndex).length === 0 ? "—" : null}
            </td>
          ))}
          {scored && (
            <td className="blank-score">
              {confirmDigits && <span style={{ fontSize: "9px", letterSpacing: "0.35em", float: "right" }}>0123456789 . 0123456789</span>}
            </td>
          )}
          {ranked && <td className="blank-score">{index === replyIndex ? "—" : null}</td>}
          {index === 0 && <td rowSpan={speakerNames.length} className="blank-score">{winnerBox ? "☐" : null}</td>}
        </tr>
      ))}
    </>
  );
}
