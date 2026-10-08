"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import {
  MessageSquareHeart,
  Plus,
  Star,
  CheckCircle2,
  Users2,
  Search,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { validateFeedbackScore } from "@/lib/scoring/validator";
import { isFeedbackEligibleForRating } from "@/lib/draw/allocator";

export default function FeedbackPage() {
  const { tournament, adjudicators, feedback, addFeedback } = useTournament();
  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;
  const minScore = tournament?.preferences?.feedbackMinScore ?? 1;
  const maxScore = tournament?.preferences?.feedbackMaxScore ?? 10;

  const [showModal, setShowModal] = useState(false);
  const [targetAdjId, setTargetAdjId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceType, setSourceType] = useState<"team" | "adjudicator">("team");
  const [score, setScore] = useState(Math.round((minScore + maxScore) / 2));
  const [agree, setAgree] = useState(true);
  const [comments, setComments] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [formError, setFormError] = useState("");

  const handleCreateFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!feedbackEnabled) {
      setFormError("Feedback submissions are currently disabled by the tournament organizers.");
      return;
    }

    if (!targetAdjId || !sourceName.trim()) {
      setFormError("Please select a judge and enter your name or team.");
      return;
    }

    const check = validateFeedbackScore(score, tournament?.preferences);
    if (!check.valid && check.error) {
      setFormError(check.error);
      return;
    }

    const targetAdj = adjudicators.find((a) => a.id === targetAdjId);

    await addFeedback({
      debateId: "direct-feedback",
      roundId: "r-all",
      targetAdjudicatorId: targetAdjId,
      targetAdjudicatorName: targetAdj?.name || "Adjudicator",
      sourceType,
      sourceId: `src-${Date.now()}`,
      sourceName: sourceName.trim(),
      score,
      agreeWithDecision: agree,
      comments: comments.trim(),
      confirmed: true,
    });

    setTargetAdjId("");
    setSourceName("");
    setComments("");
    setShowModal(false);
  };

  const ratingFeedback = feedback.filter(isFeedbackEligibleForRating);
  const adjFeedbackMap = new Map<string, { totalScore: number; count: number; agrees: number }>();
  ratingFeedback.forEach((f) => {
    if (f.targetType === "team" || !f.targetAdjudicatorId) return;
    if (!adjFeedbackMap.has(f.targetAdjudicatorId)) {
      adjFeedbackMap.set(f.targetAdjudicatorId, { totalScore: 0, count: 0, agrees: 0 });
    }
    const stat = adjFeedbackMap.get(f.targetAdjudicatorId)!;
    stat.totalScore += f.score;
    stat.count++;
    if (f.agreeWithDecision) stat.agrees++;
  });

  const filteredAdjs = adjudicators.filter((a) =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // S7: When feedbackEnabled is off, hide page content and block submission
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
            Track real-time judge feedback submitted by debaters, chairs, and panellists. (Valid score range: {minScore}–{maxScore})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/${tournament?.slug}/feedback/submissions`}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded text-xs border border-gray-300 transition"
          >
            <Users2 className="w-3.5 h-3.5" />
            <span>View Submitted Forms</span>
          </Link>
          <button
            onClick={() => {
              setScore(Math.round((minScore + maxScore) / 2));
              setFormError("");
              setShowModal(true);
            }}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-pink-600 hover:bg-pink-700 text-white font-bold rounded text-xs shadow-xs transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Submit Feedback</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#d0d7de] p-4 rounded-lg">
          <span className="text-xs font-semibold text-gray-500 uppercase">Total Feedback Forms</span>
          <div className="text-2xl font-bold text-gray-900 mt-1">{feedback.length}</div>
        </div>
        <div className="bg-white border border-[#d0d7de] p-4 rounded-lg">
          <span className="text-xs font-semibold text-gray-500 uppercase">Judges Evaluated</span>
          <div className="text-2xl font-bold text-gray-900 mt-1">{adjFeedbackMap.size}</div>
        </div>
        <div className="bg-white border border-[#d0d7de] p-4 rounded-lg">
          <span className="text-xs font-semibold text-gray-500 uppercase">Average Score</span>
          <div className="text-2xl font-bold text-gray-900 mt-1">
            {ratingFeedback.length > 0
              ? (
                  ratingFeedback.reduce((sum, f) => sum + f.score, 0) / ratingFeedback.length
                ).toFixed(2)
              : "—"}
          </div>
        </div>
      </div>

      {/* Feedback Table */}
      <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
        <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-900 uppercase">Judge Ratings Summary</h3>
          <input
            type="text"
            placeholder="Search judge..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left tabby-table">
            <thead>
              <tr>
                <th className="w-12 text-center">#</th>
                <th>Judge Name</th>
                <th>Institution</th>
                <th className="text-center">Base Score</th>
                <th className="text-center">Feedback Submissions</th>
                <th className="text-right">Average Feedback</th>
                <th className="text-center">Decision Agreement</th>
              </tr>
            </thead>
            <tbody>
              {filteredAdjs.map((adj, idx) => {
                const stat = adjFeedbackMap.get(adj.id);
                const avg = stat && stat.count > 0 ? (stat.totalScore / stat.count).toFixed(2) : "—";
                const agreeRate = stat && stat.count > 0 ? `${Math.round((stat.agrees / stat.count) * 100)}%` : "—";

                return (
                  <tr key={adj.id} className="hover:bg-gray-50">
                    <td className="text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                    <td className="font-bold text-gray-900 text-xs">{adj.name}</td>
                    <td className="text-xs text-gray-600">{adj.institutionName || "—"}</td>
                    <td className="text-center font-mono text-xs text-gray-700">
                      {adj.baseScore?.toFixed(1) || "5.0"}
                    </td>
                    <td className="text-center font-mono text-xs font-semibold text-gray-900">
                      {stat?.count || 0}
                    </td>
                    <td className="text-right font-mono font-bold text-xs text-pink-600">{avg}</td>
                    <td className="text-center font-mono text-xs text-emerald-600 font-semibold">
                      {agreeRate}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Submit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900 border-b border-gray-100 pb-2 flex items-center space-x-2">
              <MessageSquareHeart className="w-5 h-5 text-pink-600" />
              <span>Submit Adjudicator Feedback</span>
            </h3>

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateFeedback} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Select Judge</label>
                <select
                  required
                  value={targetAdjId}
                  onChange={(e) => setTargetAdjId(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500 font-semibold"
                >
                  <option value="">-- Select Adjudicator --</option>
                  {adjudicators.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.institutionName || "Independent"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Submitted By (Team or Chair)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Oxford A or Chair Judge"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Score ({minScore}–{maxScore})
                  </label>
                  <input
                    type="number"
                    min={minScore}
                    max={maxScore}
                    value={score}
                    onChange={(e) => setScore(parseInt(e.target.value, 10) || minScore)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                </div>
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

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Comments (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="Constructive feedback comments..."
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-xs focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>

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
                  className="px-4 py-1.5 text-xs font-bold text-white bg-pink-600 hover:bg-pink-700 rounded shadow-xs"
                >
                  Save Feedback
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
