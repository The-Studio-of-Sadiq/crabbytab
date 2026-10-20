"use client";

import Link from "next/link";
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
import { sideLabel } from "@/lib/sideNames";

export default function PrintableBallotsPage() {
  const { tournament, activeRound, debates, teams, adjudicators } = useTournament();
  const roundDebates = activeRound
    ? debates
        .filter((debate) => debate.roundId === activeRound.id && !debate.byeTeamId)
        .sort((left, right) => left.roomRank - right.roomRank)
    : [];
  const isBP = tournament?.format === "bp";
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
  const declaresWinner = !isBP && (!scored || winnerDeclarationFor(preferences) !== "none");
  const label = (side: DebateSide) => sideLabel(side, preferences);
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
          <div>
            <Link href={`/${tournament?.slug}/results`} className="text-xs font-semibold text-blue-700 hover:underline">
              Back to results
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Print ballot sheets</h1>
            <p className="mt-1 text-sm text-gray-600">
              {activeRound?.name ?? "No active round"} · {roundDebates.length} debates · {sheets.length} sheets
              {perAdjudicator ? " (one per voting adjudicator)" : " (one per debate)"}
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Each sheet carries a barcode. Scan returned sheets on{" "}
              <Link href={`/${tournament?.slug}/results/intake`} className="font-semibold text-blue-700 hover:underline">
                Ballot intake
              </Link>
              . Reprint after changing the draw or panels: sheets of changed debates get new ids.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={sheets.length === 0}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            Print / Save as PDF
          </button>
        </div>
        {!activeRound && <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">Select a round first.</p>}
      </main>

      <section className="print-only printable-ballots">
        {sheets.map(({ debate, sheet, position, of }) => {
          const panelIds = [
            debate.adjudicators?.chairId,
            ...(debate.adjudicators?.panellistIds ?? []),
          ].filter((id): id is string => Boolean(id));
          const panelNames = panelIds.map((id) => adjudicatorMap.get(id)?.name ?? id);
          const room = debate.venueName || `Room ${debate.roomRank}`;
          // Sides chosen at the debate: the adjudicator ticks each team's side on the sheet.
          const sideChoice = sidesPending(debate) ? sides : undefined;

          return (
            <article key={sheet.code} className="print-ballot">
              <header className="ballot-header">
                <div>
                  <h1>{tournament?.name}</h1>
                  <p>{activeRound?.name} · Debate {debate.roomRank}</p>
                  {sheet.adjudicatorId && (
                    <p>
                      <strong>Adjudicator: {sheet.adjudicatorName}</strong> (sheet {position} of {of})
                    </p>
                  )}
                </div>
                <div className="ballot-room">
                  <strong>{room}</strong>
                  {motionsEnabled(preferences) && (
                    <span>Motion: {debate.motionText || "________________________________"}</span>
                  )}
                </div>
              </header>
              <div className="ballot-sheet-id">
                <Code39Barcode value={sheet.sheetId} label={`Ballot sheet for ${room}`} />
                <span>
                  Sheet <strong>{sheet.sheetId}</strong>
                  <br />
                  {activeRound?.abbreviation || activeRound?.name} · {room}
                </span>
              </div>
              {sideChoice && (
                <p className="ballot-intro">
                  <strong>Sides were not set by the draw.</strong> Tick the side each team took ({sides.map(label).join(" or ")}).
                </p>
              )}
              {tournament?.preferences?.ballotIntroExplanation && (
                <p className="ballot-intro">{tournament.preferences.ballotIntroExplanation}</p>
              )}
              <table className="ballot-score-table">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Team / speaker</th>
                    {criteria.map((criterion) => <th key={criterion.id}>{criterion.name} ({criterion.minScore}–{criterion.maxScore})</th>)}
                    {scored && <th>Speaker score</th>}
                    {ranked && <th>Speech rank</th>}
                    <th>{isBP ? "Rank" : declaresWinner ? "Winner" : "Team total"}</th>
                  </tr>
                </thead>
                <tbody>
                  {sides.map((side) => {
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
                        teamName={slot?.teamName ?? team?.name ?? "Unassigned"}
                        speakerNames={scored
                          ? Array.from({ length: speakerCount }, (_, index) =>
                              speakers[index]?.name || `Speaker ${index + 1}`
                            ).concat(replyEnabled ? ["Reply: ____________"] : [])
                          : [""]}
                      />
                    );
                  })}
                </tbody>
              </table>
              <section className="ballot-notes">
                <strong>Decision / notes</strong>
                <div />
                <div />
              </section>
              <footer className="ballot-footer">
                <span>Chair: {panelNames[0] || "________________________"}</span>
                <span>Panel: {panelNames.slice(1).join(", ") || "________________________"}</span>
                <span>
                  {sheet.adjudicatorId ? `${sheet.adjudicatorName}'s signature` : "Chair signature"}: ________________________
                </span>
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
          {scored && <td className="blank-score" />}
          {ranked && <td className="blank-score">{index === replyIndex ? "—" : null}</td>}
          {index === 0 && <td rowSpan={speakerNames.length} className="blank-score">{winnerBox ? "☐" : null}</td>}
        </tr>
      ))}
    </>
  );
}
