"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import {
  MessageSquareHeart,
  Plus,
  Users2,
  Lock,
  AlertTriangle,
  Printer,
  ClipboardList,
  Scale,
  Download,
} from "lucide-react";
import { adjudicatorScoresCsv, csvFileStem, feedbackSubmissionsCsv } from "@/lib/csv/exporters";
import { downloadCsv } from "@/lib/csv/download";
import { validateFeedbackScore } from "@/lib/scoring/validator";
import type { FeedbackAnswer, FeedbackPath, FeedbackWeightKey } from "@/types";
import { FeedbackQuestionFields } from "@/components/feedback/FeedbackQuestionFields";
import { validateFeedbackAnswers, questionsForFeedbackSource } from "@/lib/feedback/questions";
import {
  FEEDBACK_SOURCE_ROLES,
  FEEDBACK_TARGET_ROLES,
  blendAdjudicatorScore,
  calculateFeedbackSummaries,
  isFeedbackCountedForScore,
} from "@/lib/feedback/scores";
import { feedbackSourcesForTarget, roundFeedbackProgress } from "@/lib/feedback/progress";
import { adminFeedbackLinkError } from "@/features/tournament/application/feedback";

const ROLE_LABELS: Record<string, string> = {
  team: "Team",
  chair: "Chair",
  panellist: "Panellist",
  trainee: "Trainee",
};

export default function FeedbackPage() {
  const {
    tournament,
    rounds,
    activeRound,
    debates,
    teams,
    adjudicators,
    feedback,
    addFeedback,
    saveTournament,
    isOwnerOrAdmin,
  } = useTournament();
  const preferences = tournament?.preferences;
  const feedbackEnabled = preferences?.feedbackEnabled !== false;
  const minScore = preferences?.feedbackMinScore ?? 1;
  const maxScore = preferences?.feedbackMaxScore ?? 10;
  const path: FeedbackPath = preferences?.feedbackPath ?? "two_way";

  const [showModal, setShowModal] = useState(false);
  const [targetAdjId, setTargetAdjId] = useState("");
  const [entryRoundId, setEntryRoundId] = useState("");
  const [entryDebateId, setEntryDebateId] = useState("");
  const [entrySourceKey, setEntrySourceKey] = useState("");
  const [score, setScore] = useState(Math.round((minScore + maxScore) / 2));
  const [agree, setAgree] = useState(true);
  const [comments, setComments] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswer>>({});
  const [progressRoundId, setProgressRoundId] = useState("");
  const [weightsDraft, setWeightsDraft] = useState<Partial<Record<FeedbackWeightKey, number>> | null>(null);
  const [weightsMessage, setWeightsMessage] = useState("");

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const adjudicatorsById = useMemo(() => new Map(adjudicators.map((adj) => [adj.id, adj])), [adjudicators]);
  const roundsById = useMemo(() => new Map(rounds.map((round) => [round.id, round])), [rounds]);
  const debatesById = useMemo(() => new Map(debates.map((debate) => [debate.id, debate])), [debates]);
  const orderedRounds = useMemo(
    () => [...rounds].filter((round) => !round.cancelled).sort((a, b) => a.seq - b.seq),
    [rounds]
  );

  // ─── Admin entry: judge → round → debate → source ───
  const separator = entrySourceKey.indexOf(":");
  const entrySourceType: "team" | "adjudicator" | undefined =
    separator > 0 ? (entrySourceKey.slice(0, separator) === "team" ? "team" : "adjudicator") : undefined;
  const entrySourceId = separator > 0 ? entrySourceKey.slice(separator + 1) : "";
  const feedbackQuestions = questionsForFeedbackSource(entrySourceType ?? "team", preferences);
  const targetDebates = useMemo(
    () =>
      debates.filter((debate) => {
        if (!targetAdjId || debate.byeTeamId) return false;
        if (entryRoundId && debate.roundId !== entryRoundId) return false;
        const panel = debate.adjudicators;
        return panel?.chairId === targetAdjId ||
          panel?.panellistIds?.includes(targetAdjId) ||
          panel?.traineeIds?.includes(targetAdjId);
      }),
    [debates, targetAdjId, entryRoundId]
  );
  const entryDebate = entryDebateId ? debatesById.get(entryDebateId) : undefined;
  const sourceOptions = entryDebate && targetAdjId ? feedbackSourcesForTarget(entryDebate, targetAdjId, path) : [];
  const sourceName = (type: "team" | "adjudicator", id: string) =>
    type === "team" ? teamsById.get(id)?.name ?? "Team" : adjudicatorsById.get(id)?.name ?? "Adjudicator";

  const resetEntry = () => {
    setTargetAdjId("");
    setEntryRoundId("");
    setEntryDebateId("");
    setEntrySourceKey("");
    setComments("");
    setAnswers({});
    setFormError("");
  };

  const handleCreateFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!entryDebate || !entrySourceType || !entrySourceId) {
      setFormError("Choose the judge, the debate and who gave the feedback.");
      return;
    }
    const link = {
      roundId: entryDebate.roundId,
      debateId: entryDebate.id,
      targetAdjudicatorId: targetAdjId,
      sourceType: entrySourceType,
      sourceId: entrySourceId,
    };
    const linkError = adminFeedbackLinkError(link, debates);
    if (linkError) {
      setFormError(linkError);
      return;
    }
    const check = validateFeedbackScore(score, preferences);
    if (!check.valid && check.error) {
      setFormError(check.error);
      return;
    }
    const answerError = validateFeedbackAnswers(feedbackQuestions, answers);
    if (answerError) {
      setFormError(answerError);
      return;
    }

    setSubmitting(true);
    try {
      await addFeedback({
        ...link,
        targetType: "adjudicator",
        targetAdjudicatorName: adjudicatorsById.get(targetAdjId)?.name || "Adjudicator",
        sourceName: sourceName(entrySourceType, entrySourceId),
        score,
        agreeWithDecision: agree,
        comments: comments.trim(),
        answers,
        confirmed: true,
      });
      resetEntry();
      setShowModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save the feedback.");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Scores ───
  const summaries = useMemo(
    () => calculateFeedbackSummaries(feedback, debates, preferences),
    [feedback, debates, preferences]
  );
  const countedFeedback = feedback.filter(isFeedbackCountedForScore);
  const agreement = useMemo(() => {
    const map = new Map<string, { agrees: number; answered: number }>();
    for (const item of feedback) {
      if (!isFeedbackCountedForScore(item) || item.agreeWithDecision === undefined) continue;
      const stat = map.get(item.targetAdjudicatorId!) ?? { agrees: 0, answered: 0 };
      stat.answered += 1;
      if (item.agreeWithDecision) stat.agrees += 1;
      map.set(item.targetAdjudicatorId!, stat);
    }
    return map;
  }, [feedback]);
  const filteredAdjs = adjudicators.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // ─── Admin-only exports (sources, comments and scores are private) ───
  const exportFeedbackCsv = () => {
    downloadCsv(
      `${csvFileStem(tournament?.name ?? "Tournament")}_Feedback_ADMIN_ONLY.csv`,
      feedbackSubmissionsCsv(feedback, {
        rounds,
        teams,
        adjudicators,
        questions: [
          ...(preferences?.teamFeedbackQuestions ?? []),
          ...(preferences?.adjudicatorFeedbackQuestions ?? []),
          ...(preferences?.feedbackQuestions ?? []),
        ],
      })
    );
  };
  const exportScoresCsv = () => {
    downloadCsv(
      `${csvFileStem(tournament?.name ?? "Tournament")}_Adjudicator_Scores_ADMIN_ONLY.csv`,
      adjudicatorScoresCsv(adjudicators.map((adj) => {
        const summary = summaries.get(adj.id);
        return {
          adjudicator: adj,
          feedbackCount: summary?.count ?? 0,
          feedbackAverage: summary?.average,
          score: blendAdjudicatorScore(adj, summary?.scaledAverage, activeRound?.feedbackWeight),
        };
      }))
    );
  };

  // ─── Progress ───
  const progressRound = roundsById.get(progressRoundId) ?? activeRound ?? orderedRounds[orderedRounds.length - 1];
  const progress = useMemo(
    () =>
      progressRound
        ? roundFeedbackProgress(progressRound, debates, feedback, path, preferences?.feedbackInEliminationRounds !== false)
        : undefined,
    [progressRound, debates, feedback, path, preferences?.feedbackInEliminationRounds]
  );

  // ─── Source weights ───
  const savedWeights = preferences?.feedbackSourceWeights ?? {};
  const weights = weightsDraft ?? savedWeights;
  const saveWeights = async () => {
    if (!tournament || !weightsDraft) return;
    setWeightsMessage("");
    try {
      await saveTournament({
        ...tournament,
        preferences: { ...tournament.preferences, feedbackSourceWeights: weightsDraft },
      });
      setWeightsDraft(null);
      setWeightsMessage("Saved.");
    } catch (error) {
      setWeightsMessage(error instanceof Error ? error.message : "Could not save the weights.");
    }
  };

  if (!feedbackEnabled) {
    return (
      <div className="bg-white border border-[#d0d7de] rounded-lg p-12 text-center max-w-xl mx-auto my-12 shadow-xs space-y-3">
        <div className="w-12 h-12 bg-pink-50 text-pink-500 rounded-full flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Feedback System Disabled</h2>
        <p className="text-xs text-gray-600">
          Adjudicator feedback is currently disabled in the tournament configuration. Tab directors
          can re-enable feedback anytime from Tournament Configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <MessageSquareHeart className="w-6 h-6 text-pink-600" />
            <span>Adjudicator Feedback & Ratings</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Track judge feedback from teams and panels. Feedback scale {minScore}–{maxScore} is mapped onto the
            1–10 adjudicator scale and blended with each judge&apos;s test (or base) score using the round&apos;s
            feedback weight.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/${tournament?.slug}/feedback/submissions`}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded text-xs border border-gray-300 transition"
          >
            <Users2 className="w-3.5 h-3.5" />
            <span>View Submitted Forms</span>
          </Link>
          {isOwnerOrAdmin && (
            <>
              <button
                type="button"
                onClick={exportFeedbackCsv}
                title="Admin only: includes sources, comments and unconfirmed submissions"
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded text-xs border border-gray-300 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Feedback CSV (admin only)</span>
              </button>
              <button
                type="button"
                onClick={exportScoresCsv}
                title={`Admin only: adjudicator scores using ${activeRound?.name ?? "the current round"}'s feedback weight`}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded text-xs border border-gray-300 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Scores CSV (admin only)</span>
              </button>
            </>
          )}
          <Link
            href={`/${tournament?.slug}/print/feedback`}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded text-xs border border-gray-300 transition"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Forms</span>
          </Link>
          <button
            onClick={() => {
              resetEntry();
              setScore(Math.round((minScore + maxScore) / 2));
              setShowModal(true);
            }}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-pink-600 hover:bg-pink-700 text-white font-bold rounded text-xs shadow-xs transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Enter Feedback</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#d0d7de] p-4 rounded-lg">
          <span className="text-xs font-semibold text-gray-500 uppercase">Feedback Forms</span>
          <div className="text-2xl font-bold text-gray-900 mt-1">{feedback.length}</div>
          <span className="text-[11px] text-gray-500">{countedFeedback.length} counted in scores</span>
        </div>
        <div className="bg-white border border-[#d0d7de] p-4 rounded-lg">
          <span className="text-xs font-semibold text-gray-500 uppercase">Judges Evaluated</span>
          <div className="text-2xl font-bold text-gray-900 mt-1">{summaries.size}</div>
        </div>
        <div className="bg-white border border-[#d0d7de] p-4 rounded-lg">
          <span className="text-xs font-semibold text-gray-500 uppercase">Average Score (counted)</span>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {countedFeedback.length > 0
              ? (countedFeedback.reduce((sum, f) => sum + f.score, 0) / countedFeedback.length).toFixed(2)
              : "—"}
          </div>
        </div>
      </div>

      {/* Progress */}
      <section className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden" aria-labelledby="feedback-progress">
        <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] flex flex-wrap items-center justify-between gap-2">
          <h2 id="feedback-progress" className="text-xs font-bold text-gray-900 uppercase flex items-center gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" /> Feedback progress
          </h2>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Round
            <select
              value={progressRound?.id ?? ""}
              onChange={(event) => setProgressRoundId(event.target.value)}
              className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs"
            >
              {orderedRounds.map((round) => (
                <option key={round.id} value={round.id}>{round.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="p-4 space-y-3 text-xs">
          {!progress ? (
            <p className="text-gray-500">No rounds yet.</p>
          ) : !progress.enabled ? (
            <p className="text-gray-500">Feedback is turned off for {progressRound?.name}.</p>
          ) : progress.expected === 0 ? (
            <p className="text-gray-500">No feedback is expected yet: {progressRound?.name} has no allocated debates.</p>
          ) : (
            <>
              <p className="text-gray-800">
                <span className="font-bold">{progress.submitted}</span> of {progress.expected} expected submissions received
                {" "}({Math.round((progress.submitted / progress.expected) * 100)}%).{" "}
                <span className="font-bold">{progress.outstanding.length}</span> source(s) still owe feedback
                ({progress.outstanding.filter((item) => item.sourceType === "team").length} teams,{" "}
                {progress.outstanding.filter((item) => item.sourceType === "adjudicator").length} adjudicators).
              </p>
              <p className="text-[11px] text-gray-500">
                Teams are expected to rate the chair; adjudicators follow the “{path.replace(/_/g, " ")}” feedback path.
              </p>
              {progress.outstanding.length > 0 && (
                <ul className="divide-y divide-gray-100 rounded border border-gray-200 max-h-72 overflow-y-auto">
                  {progress.outstanding.map((item) => (
                    <li key={`${item.sourceType}-${item.sourceId}-${item.debateId}`} className="px-3 py-1.5 flex flex-wrap gap-x-2">
                      <span className="font-semibold text-gray-900">{sourceName(item.sourceType, item.sourceId)}</span>
                      <span className="text-gray-500">({ROLE_LABELS[item.sourceRole]}, {debatesById.get(item.debateId)?.venueName ?? "debate"})</span>
                      <span className="text-gray-700">
                        owes feedback on{" "}
                        {item.owed
                          .map((owed) => `${adjudicatorsById.get(owed.targetAdjudicatorId)?.name ?? "adjudicator"} (${ROLE_LABELS[owed.targetRole]})`)
                          .join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>

      {/* Source weights */}
      {isOwnerOrAdmin && (
        <section className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden" aria-labelledby="feedback-weights">
          <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] flex flex-wrap items-center justify-between gap-2">
            <h2 id="feedback-weights" className="text-xs font-bold text-gray-900 uppercase flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5" /> Feedback weighting by source
            </h2>
            <div className="flex items-center gap-2">
              {weightsMessage && <span role="status" className="text-[11px] text-gray-600">{weightsMessage}</span>}
              <button
                type="button"
                onClick={saveWeights}
                disabled={!weightsDraft}
                className="px-3 py-1 text-xs font-bold text-white bg-pink-600 hover:bg-pink-700 rounded disabled:opacity-50"
              >
                Save weights
              </button>
            </div>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-[11px] text-gray-500">
              Each submission counts with the weight of its source and target roles in that debate (1 = normal,
              0 = not counted). The round feedback weight (set on the allocation page) then decides how much
              feedback moves the judge&apos;s score.
            </p>
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th className="pr-3 text-left font-semibold text-gray-600">From \ On</th>
                    {FEEDBACK_TARGET_ROLES.map((target) => (
                      <th key={target} className="px-2 font-semibold text-gray-600">{ROLE_LABELS[target]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEEDBACK_SOURCE_ROLES.map((source) => (
                    <tr key={source}>
                      <th scope="row" className="pr-3 text-left font-semibold text-gray-700">{ROLE_LABELS[source]}</th>
                      {FEEDBACK_TARGET_ROLES.map((target) => {
                        const key = `${source}_on_${target}` as FeedbackWeightKey;
                        const same = source === target && source === "chair";
                        return (
                          <td key={target} className="px-2 py-1">
                            {same ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                step={0.25}
                                value={weights[key] ?? 1}
                                aria-label={`Weight of ${ROLE_LABELS[source]} feedback on ${ROLE_LABELS[target]}`}
                                onChange={(event) => {
                                  const value = parseFloat(event.target.value);
                                  setWeightsMessage("");
                                  setWeightsDraft({
                                    ...weights,
                                    [key]: Number.isFinite(value) && value >= 0 ? value : 1,
                                  });
                                }}
                                className="w-16 rounded border border-gray-300 px-1 py-0.5 text-center font-mono"
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Ratings Table */}
      <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
        <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-900 uppercase">Judge Ratings Summary</h3>
          <input
            type="text"
            placeholder="Search judge..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search judges"
            className="px-2.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left tabby-table">
            <thead>
              <tr>
                <th>Judge Name</th>
                <th>Institution</th>
                <th className="text-center">Base</th>
                <th className="text-center">Test</th>
                <th className="text-center">Counted Feedback</th>
                <th className="text-right">Weighted Avg</th>
                <th className="text-right" title={`Using ${activeRound?.name ?? "the current round"}'s feedback weight`}>
                  Score
                </th>
                <th className="text-center">Agreement</th>
              </tr>
            </thead>
            <tbody>
              {filteredAdjs.map((adj) => {
                const summary = summaries.get(adj.id);
                const stat = agreement.get(adj.id);
                return (
                  <tr key={adj.id} className="hover:bg-gray-50">
                    <td className="font-bold text-gray-900 text-xs">
                      <Link
                        href={`/${tournament?.slug}/feedback/adjudicator/${adj.id}`}
                        className="text-blue-700 hover:underline"
                      >
                        {adj.name}
                      </Link>
                    </td>
                    <td className="text-xs text-gray-600">{adj.institutionName || "—"}</td>
                    <td className="text-center font-mono text-xs text-gray-700">{adj.baseScore?.toFixed(1) ?? "5.0"}</td>
                    <td className="text-center font-mono text-xs text-gray-700">{adj.testScore?.toFixed(1) ?? "—"}</td>
                    <td className="text-center font-mono text-xs font-semibold text-gray-900">{summary?.count ?? 0}</td>
                    <td className="text-right font-mono font-bold text-xs text-pink-600">
                      {summary ? summary.average.toFixed(2) : "—"}
                    </td>
                    <td className="text-right font-mono font-bold text-xs text-indigo-700">
                      {blendAdjudicatorScore(adj, summary?.scaledAverage, activeRound?.feedbackWeight).toFixed(2)}
                    </td>
                    <td className="text-center font-mono text-xs text-emerald-600 font-semibold">
                      {stat && stat.answered > 0 ? `${Math.round((stat.agrees / stat.answered) * 100)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-[11px] text-gray-500 border-t border-gray-100">
          Score = test score (or base score when no test score is set) blended with the weighted feedback
          average. Unconfirmed and ignored submissions are not counted.
        </p>
      </div>

      {/* Entry Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-entry-title"
            className="bg-white max-h-[90vh] rounded-lg shadow-xl max-w-md w-full overflow-y-auto p-6 space-y-4"
          >
            <h3 id="feedback-entry-title" className="text-base font-bold text-gray-900 border-b border-gray-100 pb-2 flex items-center space-x-2">
              <MessageSquareHeart className="w-5 h-5 text-pink-600" />
              <span>Enter Adjudicator Feedback</span>
            </h3>

            {formError && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateFeedback} className="space-y-4">
              <label className="block text-xs font-semibold text-gray-700">
                Judge
                <select
                  required
                  value={targetAdjId}
                  onChange={(e) => {
                    setTargetAdjId(e.target.value);
                    setEntryDebateId("");
                    setEntrySourceKey("");
                  }}
                  className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-semibold"
                >
                  <option value="">-- Select Adjudicator --</option>
                  {adjudicators.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.institutionName || "Independent"})
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-gray-700">
                  Round
                  <select
                    value={entryRoundId}
                    onChange={(e) => {
                      setEntryRoundId(e.target.value);
                      setEntryDebateId("");
                      setEntrySourceKey("");
                    }}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-xs"
                  >
                    <option value="">Any round</option>
                    {orderedRounds.map((round) => (
                      <option key={round.id} value={round.id}>{round.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-gray-700">
                  Debate
                  <select
                    required
                    value={entryDebateId}
                    disabled={!targetAdjId}
                    onChange={(e) => {
                      setEntryDebateId(e.target.value);
                      setEntrySourceKey("");
                    }}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-xs disabled:bg-gray-50"
                  >
                    <option value="">{targetAdjId ? (targetDebates.length ? "Choose…" : "Judged no debates") : "Pick a judge first"}</option>
                    {targetDebates.map((debate) => (
                      <option key={debate.id} value={debate.id}>
                        {roundsById.get(debate.roundId)?.abbreviation || roundsById.get(debate.roundId)?.name}:{" "}
                        {debate.venueName || Object.values(debate.teams).map((slot) => slot.teamName).join(" vs ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-xs font-semibold text-gray-700">
                Submitted by
                <select
                  required
                  value={entrySourceKey}
                  disabled={!entryDebate}
                  onChange={(e) => {
                    setEntrySourceKey(e.target.value);
                    setAnswers({});
                  }}
                  className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-xs disabled:bg-gray-50"
                >
                  <option value="">{entryDebate ? "Choose the team or adjudicator…" : "Pick a debate first"}</option>
                  {sourceOptions.map((option) => (
                    <option key={`${option.sourceType}:${option.sourceId}`} value={`${option.sourceType}:${option.sourceId}`}>
                      {sourceName(option.sourceType, option.sourceId)} ({ROLE_LABELS[option.sourceRole]})
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-gray-700">
                  Score ({minScore}–{maxScore})
                  <input
                    type="number"
                    min={minScore}
                    max={maxScore}
                    value={score}
                    onChange={(e) => setScore(parseInt(e.target.value, 10) || minScore)}
                    className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                </label>
                <div className="flex items-center pt-5">
                  <label className="flex items-center space-x-2 cursor-pointer text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={agree}
                      onChange={(e) => setAgree(e.target.checked)}
                      className="rounded border-gray-300 text-pink-600"
                    />
                    <span>Agreed with Decision</span>
                  </label>
                </div>
              </div>

              <label className="block text-xs font-semibold text-gray-700">
                Comments (Optional)
                <textarea
                  rows={2}
                  placeholder="Constructive feedback comments..."
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded p-2 text-xs font-normal"
                />
              </label>

              <FeedbackQuestionFields
                questions={feedbackQuestions}
                answers={answers}
                onChange={(questionId, value) =>
                  setAnswers((current) => ({ ...current, [questionId]: value }))
                }
              />

              <div className="flex justify-end space-x-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-pink-600 hover:bg-pink-700 rounded shadow-xs disabled:opacity-50"
                >
                  {submitting ? "Saving…" : "Save Feedback"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
