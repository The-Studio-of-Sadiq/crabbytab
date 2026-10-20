"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { ArrowLeft, MessageSquareHeart, Users2 } from "lucide-react";
import { FeedbackSubmission } from "@/types";
import { FeedbackReviewControls } from "@/features/tournament/components/FeedbackReviewControls";
import { filterFeedbackSubmissions, type FeedbackFilters } from "@/lib/feedback/filters";

type FeedbackKind = "team" | "adjudicator";

function isTeamFeedback(submission: FeedbackSubmission): boolean {
  return submission.targetType === "team" || Boolean(submission.targetTeamId || submission.targetTeamName);
}

function displayAnswer(answer: unknown): string {
  if (typeof answer === "string") return answer;
  if (answer === null || answer === undefined) return "—";
  if (typeof answer === "number" || typeof answer === "boolean") return String(answer);
  return JSON.stringify(answer) ?? String(answer);
}

export default function FeedbackSubmissionsPage() {
  const { tournament, feedback, rounds, debates, adjudicators, reviewFeedback, isOwnerOrAdmin } = useTournament();
  const baseScores = useMemo(() => new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator.baseScore])), [adjudicators]);
  const importantThreshold = tournament?.preferences?.feedbackImportantThreshold ?? 2;
  const [activeKind, setActiveKind] = useState<FeedbackKind>("team");
  const [filters, setFilters] = useState<FeedbackFilters>({});
  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;
  const filteredFeedback = useMemo(
    () => filterFeedbackSubmissions(feedback, filters, { baseScores, importantThreshold }),
    [feedback, filters, baseScores, importantThreshold]
  );
  const teamFeedback = filteredFeedback
    .filter(isTeamFeedback)
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const adjudicatorFeedback = filteredFeedback
    .filter((submission) => !isTeamFeedback(submission))
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const selectedFeedback = activeKind === "team" ? teamFeedback : adjudicatorFeedback;
  const sources = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const submission of feedback) {
      byKey.set(`${submission.sourceType}:${submission.sourceId}`, submission.sourceName || submission.sourceId);
    }
    return [...byKey].sort((a, b) => a[1].localeCompare(b[1]));
  }, [feedback]);
  const filterSelect = "rounded border border-gray-300 bg-white px-2 py-1 text-xs";
  const roundNames = new Map(rounds.map((round) => [round.id, round.name]));
  const debatesById = new Map(debates.map((debate) => [debate.id, debate]));

  if (!feedbackEnabled) {
    return (
      <div className="bg-white border border-[#d0d7de] rounded-lg p-12 text-center max-w-xl mx-auto my-12 shadow-xs space-y-3">
        <h2 className="text-lg font-bold text-gray-900">Feedback System Disabled</h2>
        <p className="text-xs text-gray-600">
          Feedback submissions are hidden while feedback is disabled in the tournament configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-[#d0d7de] pb-4">
        <Link
          href={`/${tournament?.slug}/feedback`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-900 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Feedback
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
          <MessageSquareHeart className="w-6 h-6 text-pink-600" />
          Individual Feedback Forms
        </h1>
        <p className="text-xs text-gray-500 mt-1">
          Review each submitted team and adjudicator feedback form.
        </p>
      </div>

      <div className="flex items-center gap-2 border-b border-[#d0d7de] pb-3">
        <button
          type="button"
          onClick={() => setActiveKind("team")}
          aria-pressed={activeKind === "team"}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-md ${
            activeKind === "team" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <Users2 className="w-3.5 h-3.5" />
          Team Feedback ({teamFeedback.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveKind("adjudicator")}
          aria-pressed={activeKind === "adjudicator"}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-md ${
            activeKind === "adjudicator" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <MessageSquareHeart className="w-3.5 h-3.5" />
          Adjudicator Feedback ({adjudicatorFeedback.length})
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filter feedback">
        <label className="text-[11px] font-semibold text-gray-600">
          Round
          <select
            value={filters.roundId ?? ""}
            onChange={(event) => setFilters({ ...filters, roundId: event.target.value || undefined })}
            className={`mt-0.5 block ${filterSelect}`}
          >
            <option value="">All rounds</option>
            {[...rounds].sort((a, b) => a.seq - b.seq).map((round) => (
              <option key={round.id} value={round.id}>{round.name}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          About adjudicator
          <select
            value={filters.targetAdjudicatorId ?? ""}
            onChange={(event) => setFilters({ ...filters, targetAdjudicatorId: event.target.value || undefined })}
            className={`mt-0.5 block ${filterSelect}`}
          >
            <option value="">Anyone</option>
            {[...adjudicators].sort((a, b) => a.name.localeCompare(b.name)).map((adjudicator) => (
              <option key={adjudicator.id} value={adjudicator.id}>{adjudicator.name}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          Source type
          <select
            value={filters.sourceType ?? ""}
            onChange={(event) => setFilters({
              ...filters,
              sourceType: event.target.value === "team" || event.target.value === "adjudicator" ? event.target.value : undefined,
              sourceId: undefined,
            })}
            className={`mt-0.5 block ${filterSelect}`}
          >
            <option value="">Teams and adjudicators</option>
            <option value="team">Teams</option>
            <option value="adjudicator">Adjudicators</option>
          </select>
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          From
          <select
            value={filters.sourceId ? `${filters.sourceType ?? ""}:${filters.sourceId}` : ""}
            onChange={(event) => {
              const [type, ...rest] = event.target.value.split(":");
              setFilters({
                ...filters,
                sourceType: type === "team" || type === "adjudicator" ? type : undefined,
                sourceId: rest.join(":") || undefined,
              });
            }}
            className={`mt-0.5 block ${filterSelect}`}
          >
            <option value="">Anyone</option>
            {sources
              .filter(([key]) => !filters.sourceType || key.startsWith(`${filters.sourceType}:`))
              .map(([key, name]) => (
                <option key={key} value={key}>
                  {name} ({key.startsWith("team:") ? "team" : "adjudicator"})
                </option>
              ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          Status
          <select
            value={filters.status ?? ""}
            onChange={(event) => setFilters({
              ...filters,
              status: event.target.value === "counted" || event.target.value === "ignored" || event.target.value === "unconfirmed"
                ? event.target.value
                : undefined,
            })}
            className={`mt-0.5 block ${filterSelect}`}
          >
            <option value="">Any status</option>
            <option value="counted">Counted</option>
            <option value="unconfirmed">Unconfirmed</option>
            <option value="ignored">Ignored</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600" title={`Score more than ${importantThreshold} away from the adjudicator's base score (Tabbycat's important feedback)`}>
          <input
            type="checkbox"
            checked={filters.important === true}
            onChange={(event) => setFilters({ ...filters, important: event.target.checked || undefined })}
          />
          Important only (±{importantThreshold} from base score)
        </label>
        {Object.values(filters).some(Boolean) && (
          <button type="button" onClick={() => setFilters({})} className="text-xs font-semibold text-blue-700 underline">
            Clear filters
          </button>
        )}
        <span className="text-[11px] text-gray-500">
          Showing {filteredFeedback.length} of {feedback.length}
        </span>
      </div>

      {selectedFeedback.length === 0 ? (
        <div className="bg-white border border-[#d0d7de] rounded-lg p-10 text-center text-xs text-gray-500">
          No {activeKind} feedback forms match.
        </div>
      ) : (
        <div className="space-y-3">
          {selectedFeedback.map((submission) => {
            const debate = debatesById.get(submission.debateId);
            const targetName = isTeamFeedback(submission)
              ? submission.targetTeamName || "Team"
              : submission.targetAdjudicatorName || "Adjudicator";
            const submittedAt = submission.timestamp
              ? new Date(submission.timestamp).toLocaleString()
              : "Date unavailable";

            return (
              <article
                key={submission.id}
                className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-[#f6f8fa] border-b border-[#d0d7de]">
                  <div className="text-xs text-gray-700">
                    <span className="font-bold text-gray-900">{targetName}</span>
                    <span className="mx-1.5 text-gray-400">·</span>
                    <span>Submitted by {submission.sourceName || "Unknown"}</span>
                  </div>
                  <span className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                    <span>{submittedAt}</span>
                    <FeedbackReviewControls submission={submission} canEdit={isOwnerOrAdmin} onReview={reviewFeedback} />
                  </span>
                </div>
                <div className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                  <div>
                    <div className="font-semibold text-gray-500 uppercase text-[10px]">Round</div>
                    <div className="mt-0.5 text-gray-900">{roundNames.get(submission.roundId) || "—"}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-gray-500 uppercase text-[10px]">Venue / Debate</div>
                    <div className="mt-0.5 text-gray-900">
                      {debate?.venueName || (submission.debateId === "direct-feedback" ? "Direct feedback" : "—")}
                    </div>
                  </div>
                  <div>
                    <div className="font-semibold text-gray-500 uppercase text-[10px]">Score</div>
                    <div className="mt-0.5 font-bold text-pink-700">{submission.score}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-gray-500 uppercase text-[10px]">Decision Agreement</div>
                    <div className="mt-0.5 text-gray-900">
                      {submission.agreeWithDecision === undefined
                        ? "Not provided"
                        : submission.agreeWithDecision
                        ? "Agreed"
                        : "Disagreed"}
                    </div>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-4">
                    <div className="font-semibold text-gray-500 uppercase text-[10px]">Comments</div>
                    <p className="mt-0.5 whitespace-pre-wrap text-gray-800">
                      {submission.comments?.trim() || "No comments provided."}
                    </p>
                  </div>
                  {submission.answers && Object.entries(submission.answers).map(([question, answer]) => (
                    <div key={question} className="sm:col-span-2">
                      <div className="font-semibold text-gray-500 uppercase text-[10px]">{question}</div>
                      <p className="mt-0.5 whitespace-pre-wrap text-gray-800">{displayAnswer(answer)}</p>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
