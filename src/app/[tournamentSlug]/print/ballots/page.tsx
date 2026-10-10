"use client";

import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import type { DebateSide } from "@/types";

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
              {activeRound?.name ?? "No active round"} · {roundDebates.length} debate sheets
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={roundDebates.length === 0}
            className="rounded bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            Print / Save as PDF
          </button>
        </div>
        {!activeRound && <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">Select a round first.</p>}
      </main>

      <section className="print-only printable-ballots">
        {roundDebates.map((debate) => {
          const panelIds = [
            debate.adjudicators?.chairId,
            ...(debate.adjudicators?.panellistIds ?? []),
          ].filter((id): id is string => Boolean(id));
          const panelNames = panelIds.map((id) => adjudicatorMap.get(id)?.name ?? id);

          return (
            <article key={debate.id} className="print-ballot">
              <header className="ballot-header">
                <div>
                  <h1>{tournament?.name}</h1>
                  <p>{activeRound?.name} · Debate {debate.roomRank}</p>
                </div>
                <div className="ballot-room">
                  <strong>{debate.venueName || `Room ${debate.roomRank}`}</strong>
                  <span>Motion: {debate.motionText || "________________________________"}</span>
                </div>
              </header>
              {tournament?.preferences?.ballotIntroExplanation && (
                <p className="ballot-intro">{tournament.preferences.ballotIntroExplanation}</p>
              )}
              <table className="ballot-score-table">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Team / speaker</th>
                    <th>Speaker score</th>
                    <th>Team points / rank</th>
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
                        teamName={slot?.teamName ?? team?.name ?? "Unassigned"}
                        speakerNames={Array.from({ length: speakerCount }, (_, index) =>
                          speakers[index]?.name || `Speaker ${index + 1}`
                        ).concat(replyEnabled ? [speakers[0]?.name || "Reply speaker"] : [])}
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
                <span>Chair signature: ________________________</span>
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
  teamName,
  speakerNames,
}: {
  side: DebateSide;
  teamName: string;
  speakerNames: string[];
}) {
  return (
    <>
      {speakerNames.map((speakerName, index) => (
        <tr key={`${side}-${index}`}>
          {index === 0 && <th rowSpan={speakerNames.length}>{side}</th>}
          <td>{index === 0 ? <strong>{teamName}</strong> : null}<span>{speakerName}</span></td>
          <td className="blank-score" />
          {index === 0 && <td rowSpan={speakerNames.length} className="blank-score" />}
        </tr>
      ))}
    </>
  );
}
