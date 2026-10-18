"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, MessageSquareHeart, Save } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import {
  ADJ_SCORE_MAX,
  ADJ_SCORE_MIN,
  adjudicatorScoreHistory,
  blendAdjudicatorScore,
  calculateFeedbackSummaries,
  feedbackWeightKey,
  normalizeFeedbackWeight,
  preFeedbackScore,
} from "@/lib/feedback/scores";
import { FeedbackReviewControls } from "@/features/tournament/components/FeedbackReviewControls";

const ROLE_LABELS: Record<string, string> = { chair: "Chair", panellist: "Panellist", trainee: "Trainee" };

function parseScore(value: string): number | undefined | "invalid" {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= ADJ_SCORE_MIN && parsed <= ADJ_SCORE_MAX ? parsed : "invalid";
}

export default function AdjudicatorFeedbackDetailPage() {
  const params = useParams();
  const adjudicatorId = params.adjudicatorId as string;
  const {
    tournament,
    rounds,
    activeRound,
    debates,
    adjudicators,
    feedback,
    updateAdjudicator,
    reviewFeedback,
    isOwnerOrAdmin,
  } = useTournament();
  const adjudicator = adjudicators.find((item) => item.id === adjudicatorId);
  const preferences = tournament?.preferences;
  const [baseDraft, setBaseDraft] = useState<string | null>(null);
  const [testDraft, setTestDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const summary = useMemo(
    () => calculateFeedbackSummaries(feedback, debates, preferences).get(adjudicatorId),
    [feedback, debates, preferences, adjudicatorId]
  );
  const history = useMemo(
    () => (adjudicator ? adjudicatorScoreHistory(adjudicator, rounds, debates, feedback, preferences) : []),
    [adjudicator, rounds, debates, feedback, preferences]
  );
  const received = useMemo(
    () =>
      feedback
        .filter((item) => item.targetAdjudicatorId === adjudicatorId && item.targetType !== "team")
        .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || "")),
    [feedback, adjudicatorId]
  );
  const debatesById = useMemo(() => new Map(debates.map((debate) => [debate.id, debate])), [debates]);
  const roundsById = useMemo(() => new Map(rounds.map((round) => [round.id, round])), [rounds]);

  if (!adjudicator) {
    return (
      <div className="space-y-3">
        <Link href={`/${tournament?.slug}/feedback`} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Feedback
        </Link>
        <p role="alert" className="text-sm text-gray-700">This adjudicator no longer exists.</p>
      </div>
    );
  }

  const weight = normalizeFeedbackWeight(activeRound?.feedbackWeight);
  const handleSaveScores = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const base = parseScore(baseDraft ?? String(adjudicator.baseScore));
    const test = parseScore(testDraft ?? (adjudicator.testScore === undefined ? "" : String(adjudicator.testScore)));
    if (base === undefined || base === "invalid" || test === "invalid") {
      setMessage({
        kind: "error",
        text: `Scores must be between ${ADJ_SCORE_MIN} and ${ADJ_SCORE_MAX}; the base score is required.`,
      });
      return;
    }
    setSaving(true);
    try {
      await updateAdjudicator({ ...adjudicator, baseScore: base, testScore: test });
      setBaseDraft(null);
      setTestDraft(null);
      setMessage({ kind: "success", text: "Scores saved." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save the scores." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-[#d0d7de] pb-4 space-y-2">
        <Link
          href={`/${tournament?.slug}/feedback`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Feedback
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gray-900">
          <MessageSquareHeart className="h-6 w-6 text-pink-600" /> {adjudicator.name}
        </h1>
        <p className="text-xs text-gray-500">
          {adjudicator.institutionName ?? "Independent"}
          {adjudicator.trainee ? " · Trainee" : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
          <div className="text-xs font-semibold uppercase text-gray-500">Base score</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{adjudicator.baseScore.toFixed(1)}</div>
        </div>
        <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
          <div className="text-xs font-semibold uppercase text-gray-500">Test score</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{adjudicator.testScore?.toFixed(1) ?? "—"}</div>
          <div className="text-[11px] text-gray-500">Used instead of the base score when set</div>
        </div>
        <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
          <div className="text-xs font-semibold uppercase text-gray-500">Feedback (weighted)</div>
          <div className="mt-1 text-2xl font-bold text-pink-700">{summary ? summary.average.toFixed(2) : "—"}</div>
          <div className="text-[11px] text-gray-500">
            {summary ? `${summary.count} counted · ${summary.scaledAverage.toFixed(2)} on the 1–10 scale` : "No counted feedback"}
          </div>
        </div>
        <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
          <div className="text-xs font-semibold uppercase text-gray-500">Feedback-weighted score</div>
          <div className="mt-1 text-2xl font-bold text-indigo-700">
            {blendAdjudicatorScore(adjudicator, summary?.scaledAverage, activeRound?.feedbackWeight).toFixed(2)}
          </div>
          <div className="text-[11px] text-gray-500">
            {Math.round(weight * 100)}% feedback ({activeRound?.name ?? "default weight"}), {Math.round((1 - weight) * 100)}%{" "}
            {preFeedbackScore(adjudicator) === adjudicator.testScore ? "test" : "base"} score
          </div>
        </div>
      </div>

      {isOwnerOrAdmin && (
        <form onSubmit={handleSaveScores} className="flex flex-wrap items-end gap-3 rounded-lg border border-[#d0d7de] bg-white p-4">
          <label className="text-xs font-semibold text-gray-700">
            Base score
            <input
              type="number"
              step={0.5}
              min={ADJ_SCORE_MIN}
              max={ADJ_SCORE_MAX}
              required
              value={baseDraft ?? String(adjudicator.baseScore)}
              onChange={(event) => setBaseDraft(event.target.value)}
              className="mt-1 block w-24 rounded border border-gray-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="text-xs font-semibold text-gray-700">
            Test score
            <input
              type="number"
              step={0.5}
              min={ADJ_SCORE_MIN}
              max={ADJ_SCORE_MAX}
              value={testDraft ?? (adjudicator.testScore === undefined ? "" : String(adjudicator.testScore))}
              onChange={(event) => setTestDraft(event.target.value)}
              placeholder="None"
              className="mt-1 block w-24 rounded border border-gray-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <button
            type="submit"
            disabled={saving || (baseDraft === null && testDraft === null)}
            className="inline-flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save scores"}
          </button>
          <span className="text-[11px] text-gray-500">Leave the test score empty to use the base score.</span>
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={`w-full text-xs ${message.kind === "error" ? "text-red-700" : "text-emerald-700"}`}>
              {message.text}
            </p>
          )}
        </form>
      )}

      <section className="overflow-hidden rounded-lg border border-[#d0d7de] bg-white" aria-labelledby="score-history">
        <h2 id="score-history" className="border-b border-[#d0d7de] bg-[#f6f8fa] p-3 text-xs font-bold uppercase text-gray-900">
          Score history by round
        </h2>
        <div className="overflow-x-auto">
          <table className="tabby-table w-full text-left">
            <thead>
              <tr>
                <th>Round</th>
                <th>Role</th>
                <th className="text-center">Received</th>
                <th className="text-center">Counted</th>
                <th className="text-right">Round avg</th>
                <th className="text-right">Score after round</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.roundId}>
                  <td className="text-xs font-semibold text-gray-900">{row.roundName}</td>
                  <td className="text-xs text-gray-700">
                    {row.role ? ROLE_LABELS[row.role] : "Not allocated"}
                    {row.debateId && debatesById.get(row.debateId)?.venueName ? ` · ${debatesById.get(row.debateId)?.venueName}` : ""}
                  </td>
                  <td className="text-center font-mono text-xs">{row.received}</td>
                  <td className="text-center font-mono text-xs">{row.summary?.count ?? 0}</td>
                  <td className="text-right font-mono text-xs text-pink-700">{row.summary ? row.summary.average.toFixed(2) : "—"}</td>
                  <td className="text-right font-mono text-xs font-bold text-indigo-700">{row.cumulativeScore.toFixed(2)}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-xs text-gray-400">No rounds yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2" aria-labelledby="received-feedback">
        <h2 id="received-feedback" className="text-sm font-bold text-gray-900">Feedback received ({received.length})</h2>
        {received.length === 0 ? (
          <p className="rounded-lg border border-[#d0d7de] bg-white p-6 text-center text-xs text-gray-500">No feedback yet.</p>
        ) : (
          received.map((item) => {
            const key = feedbackWeightKey(item, debatesById.get(item.debateId));
            const sourceWeight = key ? preferences?.feedbackSourceWeights?.[key] ?? 1 : 1;
            return (
              <article key={item.id} className="rounded-lg border border-[#d0d7de] bg-white p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-bold text-pink-700">{item.score}</span>
                    <span className="mx-1.5 text-gray-400">·</span>
                    {roundsById.get(item.roundId)?.name ?? "Unlinked round"} · from {item.sourceName || "Unknown"}
                    {key ? ` (${key.replace(/_/g, " ")}, weight ${sourceWeight})` : ""}
                  </span>
                  <FeedbackReviewControls submission={item} canEdit={isOwnerOrAdmin} onReview={reviewFeedback} />
                </div>
                {item.comments?.trim() && <p className="mt-1 whitespace-pre-wrap text-gray-800">{item.comments}</p>}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
