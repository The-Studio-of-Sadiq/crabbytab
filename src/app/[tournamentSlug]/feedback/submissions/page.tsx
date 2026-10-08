"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { ArrowLeft, MessageSquareHeart, Users2 } from "lucide-react";
import { FeedbackSubmission } from "@/types";

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
  const { tournament, feedback, rounds, debates } = useTournament();
  const [activeKind, setActiveKind] = useState<FeedbackKind>("team");
  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;
  const teamFeedback = feedback
    .filter(isTeamFeedback)
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const adjudicatorFeedback = feedback
    .filter((submission) => !isTeamFeedback(submission))
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const selectedFeedback = activeKind === "team" ? teamFeedback : adjudicatorFeedback;
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

      {selectedFeedback.length === 0 ? (
        <div className="bg-white border border-[#d0d7de] rounded-lg p-10 text-center text-xs text-gray-500">
          No {activeKind} feedback forms have been submitted.
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
                  <span className="text-[11px] text-gray-500">{submittedAt}</span>
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
