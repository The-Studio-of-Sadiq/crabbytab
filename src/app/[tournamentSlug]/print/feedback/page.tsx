"use client";

import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import type { FeedbackQuestion } from "@/types";
import {
  integerScaleChoices,
  isFeedbackEnabledForRound,
  numericBoundsText,
  questionsForFeedbackSource,
} from "@/lib/feedback/questions";
import { describeFeedbackPaths, feedbackPathsForRound } from "@/lib/feedback/paths";
import { expectedFeedbackForDebate } from "@/lib/feedback/progress";

const ROLE_LABELS = { team: "Team", chair: "Chair", panellist: "Panellist", trainee: "Trainee" } as const;

function PrintedAnswer({ question }: { question: FeedbackQuestion }) {
  switch (question.type) {
    case "select_one":
    case "select_many":
      return <p>{question.options?.map((option) => `□ ${option}`).join("     ")}</p>;
    case "yes_no":
      return <p>[ ] Yes    [ ] No</p>;
    case "checkbox":
      return <p>[ ] Tick if true</p>;
    case "integer_scale":
      return <p>Circle one: {integerScaleChoices(question).join("   ")}</p>;
    case "scale":
    case "integer":
    case "float": {
      const bounds = numericBoundsText(question);
      const kind = question.type === "integer" ? "Whole number" : "Number";
      return <p>{kind}{bounds ? ` ${bounds}` : ""}: ______________</p>;
    }
    default:
      return <div className={`feedback-print-writing${question.type === "textarea" ? " feedback-print-writing-tall" : ""}`} />;
  }
}

export default function PrintableFeedbackPage() {
  const { tournament, activeRound, debates, teams, adjudicators } = useTournament();
  const preferences = tournament?.preferences;
  const paths = feedbackPathsForRound(preferences, activeRound ?? undefined);
  const roundOpen = Boolean(activeRound) && preferences?.feedbackEnabled !== false &&
    isFeedbackEnabledForRound({ postponed: false }, activeRound ?? undefined, preferences?.feedbackInEliminationRounds !== false);
  const roundDebates = activeRound
    ? debates
        .filter((debate) => debate.roundId === activeRound.id && !debate.byeTeamId)
        .sort((left, right) => left.roomRank - right.roomRank)
    : [];
  const teamMap = new Map(teams.map((team) => [team.id, team]));
  const adjudicatorMap = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const questionsBySource = {
    team: questionsForFeedbackSource("team", preferences),
    adjudicator: questionsForFeedbackSource("adjudicator", preferences),
  };
  // One form per expected submission, so the printed set matches what the progress tracker expects.
  const forms = roundOpen
    ? roundDebates.flatMap((debate) =>
        expectedFeedbackForDebate(debate, paths).map((item) => ({
          debate,
          item,
          sourceName: item.sourceType === "team"
            ? teamMap.get(item.sourceId)?.name ?? item.sourceId
            : adjudicatorMap.get(item.sourceId)?.name ?? item.sourceId,
          targetName: adjudicatorMap.get(item.targetAdjudicatorId)?.name ?? item.targetAdjudicatorId,
        }))
      )
    : [];
  const teamForms = forms.filter((form) => form.item.sourceType === "team").length;
  const minScore = preferences?.feedbackMinScore ?? 1;
  const maxScore = preferences?.feedbackMaxScore ?? 10;

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
              {activeRound?.name ?? "No active round"} · {teamForms} team and {forms.length - teamForms} adjudicator forms
            </p>
            <p className="mt-1 text-xs text-gray-500">Feedback paths: {describeFeedbackPaths(paths)}.</p>
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
        {activeRound && !roundOpen && (
          <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">Feedback is not collected in this round.</p>
        )}
        {roundOpen && roundDebates.length > 0 && forms.length === 0 && (
          <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
            Allocate adjudicators before printing feedback forms.
          </p>
        )}
      </main>

      <section className="print-only printable-feedback">
        {forms.map(({ debate, item, sourceName, targetName }) => (
          <article
            className="print-feedback-sheet"
            key={`${debate.id}-${item.sourceType}-${item.sourceId}-${item.targetAdjudicatorId}`}
          >
            <header>
              <h1>{tournament?.name} · Adjudicator Feedback</h1>
              <p>{activeRound?.name} · {debate.venueName || `Room ${debate.roomRank}`}</p>
            </header>
            <dl>
              <div><dt>From</dt><dd>{sourceName} ({ROLE_LABELS[item.sourceRole]})</dd></div>
              <div><dt>Adjudicator</dt><dd>{targetName} ({ROLE_LABELS[item.targetRole]})</dd></div>
            </dl>
            <div className="feedback-print-score">
              <strong>Overall rating ({minScore}–{maxScore})</strong>
              <span>Circle one: {Array.from({ length: maxScore - minScore + 1 }, (_, index) => index + minScore).join("   ")}</span>
            </div>
            {questionsBySource[item.sourceType].map((question) => (
              <section key={question.id} className="feedback-print-question">
                <strong>{question.label}{question.required ? " *" : ""}</strong>
                <PrintedAnswer question={question} />
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
