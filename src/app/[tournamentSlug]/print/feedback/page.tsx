"use client";

import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";

export default function PrintableFeedbackPage() {
  const { tournament, activeRound, debates, teams, adjudicators } = useTournament();
  const roundDebates = activeRound
    ? debates
        .filter((debate) => debate.roundId === activeRound.id && !debate.byeTeamId)
        .sort((left, right) => left.roomRank - right.roomRank)
    : [];
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const adjudicatorMap = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const questions = tournament?.preferences?.feedbackQuestions ?? [];
  const forms = roundDebates.flatMap((debate) => {
    const panelIds = [
      debate.adjudicators?.chairId,
      ...(debate.adjudicators?.panellistIds ?? []),
    ].filter((id): id is string => Boolean(id));
    const panel = panelIds.map((id) => adjudicatorMap.get(id)?.name ?? id);
    const participatingTeams = Object.values(debate.teams)
      .filter((slot) => slot?.teamId)
      .map((slot) => teamMap.get(slot.teamId))
      .filter((team): team is NonNullable<typeof team> => team !== undefined);
    return participatingTeams.flatMap((team) =>
      panel.map((adjudicatorName) => ({ debate, team, adjudicatorName }))
    );
  });

  return (
    <>
      <main className="screen-only space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
          <div>
            <Link href={`/${tournament?.slug}/feedback`} className="text-xs font-semibold text-blue-700 hover:underline">
              Back to feedback
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Print feedback forms</h1>
            <p className="mt-1 text-sm text-gray-600">
              {activeRound?.name ?? "No active round"} · {forms.length} team-to-adjudicator forms
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={forms.length === 0}
            className="rounded bg-pink-700 px-4 py-2 text-sm font-bold text-white hover:bg-pink-800 disabled:opacity-50"
          >
            Print / Save as PDF
          </button>
        </div>
        {!activeRound && <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">Select a round first.</p>}
        {roundDebates.length > 0 && forms.length === 0 && (
          <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
            Allocate adjudicators before printing feedback forms.
          </p>
        )}
      </main>

      <section className="print-only printable-feedback">
        {forms.map(({ debate, team, adjudicatorName }, index) => (
          <article className="print-feedback-sheet" key={`${debate.id}-${team.id}-${adjudicatorName}-${index}`}>
            <header>
              <h1>{tournament?.name} · Adjudicator Feedback</h1>
              <p>{activeRound?.name} · {debate.venueName || `Room ${debate.roomRank}`}</p>
            </header>
            <dl>
              <div><dt>Team</dt><dd>{team.name}</dd></div>
              <div><dt>Adjudicator</dt><dd>{adjudicatorName}</dd></div>
            </dl>
            <div className="feedback-print-score">
              <strong>Overall rating ({tournament?.preferences?.feedbackMinScore ?? 1}–{tournament?.preferences?.feedbackMaxScore ?? 10})</strong>
              <span>Circle one: {Array.from(
                { length: (tournament?.preferences?.feedbackMaxScore ?? 10) - (tournament?.preferences?.feedbackMinScore ?? 1) + 1 },
                (_, scoreIndex) => scoreIndex + (tournament?.preferences?.feedbackMinScore ?? 1)
              ).join("   ")}</span>
            </div>
            {questions.map((question) => (
              <section key={question.id} className="feedback-print-question">
                <strong>{question.label}{question.required ? " *" : ""}</strong>
                {question.type === "select_one" || question.type === "select_many"
                  ? <p>{question.options?.map((option) => `□ ${option}`).join("     ")}</p>
                  : question.type === "yes_no"
                  ? <p>[ ] Yes    [ ] No</p>
                  : question.type === "scale"
                  ? <p>Circle one: {Array.from(
                      { length: Math.max(0, (question.max ?? 5) - (question.min ?? 1) + 1) },
                      (_, scoreIndex) => scoreIndex + (question.min ?? 1)
                    ).join("   ")}</p>
                  : <div className="feedback-print-writing" />}
              </section>
            ))}
            <section className="feedback-print-question">
              <strong>Comments</strong>
              <div className="feedback-print-writing feedback-print-writing-tall" />
            </section>
            <p className="feedback-print-confidential">Feedback is confidential to tournament organizers.</p>
          </article>
        ))}
      </section>
    </>
  );
}
