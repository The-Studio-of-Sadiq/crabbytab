"use client";

import React from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { SideBadge } from "@/components/ui/SideBadge";
import {
  FileCheck2,
  CheckCircle2,
  Clock,
  Edit,
  ArrowRight,
  Eye,
  AlertCircle,
  FileText,
  Search,
  Lock,
} from "lucide-react";
import { DebateSide } from "@/types";

export default function ResultsOverviewPage() {
  const {
    tournament,
    activeRound,
    rounds,
    setActiveRound,
    debates,
    ballots,
    confirmBallot,
    updateRound,
  } = useTournament();

  const isBP = tournament?.format === "bp";
  const roundDebates = activeRound ? debates.filter((d) => d.roundId === activeRound.id) : [];

  const ballotMap = new Map<string, any>();
  ballots.forEach((b) => {
    if (!b.discarded) ballotMap.set(b.debateId, b);
  });

  const confirmedCount = roundDebates.filter(
    (d) => ballotMap.get(d.id)?.confirmed
  ).length;
  const allBallotsConfirmed = roundDebates.length > 0 && confirmedCount === roundDebates.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <FileCheck2 className="w-6 h-6 text-blue-600" />
            <span>Results & Ballot Entry</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Enter and verify speaker scores, team rankings, and paperless e-ballots.
          </p>
        </div>

        {/* Progress Badge */}
        <div className="flex items-center space-x-3">
          <span className="text-xs font-semibold text-gray-700">
            {confirmedCount} of {roundDebates.length} Confirmed
          </span>
          <div className="w-36 h-2.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{
                width: `${(confirmedCount / Math.max(1, roundDebates.length)) * 100}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Round Selector Bar */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">
          Select Round:
        </span>
        {rounds.map((r) => {
          const rDebates = debates.filter((d) => d.roundId === r.id);
          const rConfirmed = rDebates.filter((d) => ballotMap.get(d.id)?.confirmed).length;
          const isComplete = rConfirmed === rDebates.length && rDebates.length > 0;

          return (
            <button
              key={r.id}
              onClick={() => setActiveRound(r)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md border flex items-center space-x-1.5 transition ${
                activeRound?.id === r.id
                  ? "bg-blue-600 text-white border-blue-700 shadow-xs"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              <span>{r.name}</span>
              {isComplete && <CheckCircle2 className="w-3 h-3 text-emerald-300" />}
            </button>
          );
        })}
      </div>

      {/* Ballots Table */}
      {roundDebates.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-10 text-center">
          <FileText className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <h3 className="text-base font-bold text-gray-800 mb-1">No Debates in {activeRound?.name}</h3>
          <p className="text-xs text-gray-500 max-w-md mx-auto mb-4">
            Generate the draw before entering ballots and results for this round.
          </p>
          <Link
            href={`/${tournament?.slug}/draw`}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs transition"
          >
            <span>Go to Draw Generation</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left tabby-table">
              <thead>
                <tr>
                  <th className="w-28">Venue</th>
                  {isBP ? (
                    <>
                      <th>Opening Gov (OG)</th>
                      <th>Opening Opp (OO)</th>
                      <th>Closing Gov (CG)</th>
                      <th>Closing Opp (CO)</th>
                    </>
                  ) : (
                    <>
                      <th>Affirmative</th>
                      <th>Negative</th>
                    </>
                  )}
                  <th>Chair</th>
                  <th className="w-28 text-center">Status</th>
                  <th className="w-32 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roundDebates.map((debate) => {
                  const ballot = ballotMap.get(debate.id);
                  const isConfirmed = ballot?.confirmed;
                  const isDraft = ballot && !ballot.confirmed;

                  return (
                    <tr key={debate.id} className="hover:bg-gray-50">
                      <td className="font-bold text-gray-900 text-xs">
                        {debate.venueName || "Unassigned"}
                      </td>

                      {isBP ? (
                        <>
                          <td className="text-xs">
                            <div className="font-semibold text-gray-900">
                              {debate.teams?.OG?.teamName || "—"}
                            </div>
                            {ballot?.teamScores?.OG && (
                              <div className="text-[11px] text-gray-500 font-mono">
                                {ballot.teamScores.OG.points} pts &bull;{" "}
                                {ballot.teamScores.OG.totalSpeakerScore} spks
                              </div>
                            )}
                          </td>
                          <td className="text-xs">
                            <div className="font-semibold text-gray-900">
                              {debate.teams?.OO?.teamName || "—"}
                            </div>
                            {ballot?.teamScores?.OO && (
                              <div className="text-[11px] text-gray-500 font-mono">
                                {ballot.teamScores.OO.points} pts &bull;{" "}
                                {ballot.teamScores.OO.totalSpeakerScore} spks
                              </div>
                            )}
                          </td>
                          <td className="text-xs">
                            <div className="font-semibold text-gray-900">
                              {debate.teams?.CG?.teamName || "—"}
                            </div>
                            {ballot?.teamScores?.CG && (
                              <div className="text-[11px] text-gray-500 font-mono">
                                {ballot.teamScores.CG.points} pts &bull;{" "}
                                {ballot.teamScores.CG.totalSpeakerScore} spks
                              </div>
                            )}
                          </td>
                          <td className="text-xs">
                            <div className="font-semibold text-gray-900">
                              {debate.teams?.CO?.teamName || "—"}
                            </div>
                            {ballot?.teamScores?.CO && (
                              <div className="text-[11px] text-gray-500 font-mono">
                                {ballot.teamScores.CO.points} pts &bull;{" "}
                                {ballot.teamScores.CO.totalSpeakerScore} spks
                              </div>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="text-xs">
                            <div className="font-semibold text-gray-900">
                              {debate.teams?.AFF?.teamName || "—"}
                            </div>
                            {ballot?.teamScores?.AFF && (
                              <div className="text-[11px] text-gray-500 font-mono">
                                {ballot.teamScores.AFF.win ? "WIN" : "LOSS"} &bull;{" "}
                                {ballot.teamScores.AFF.totalSpeakerScore} spks
                              </div>
                            )}
                          </td>
                          <td className="text-xs">
                            <div className="font-semibold text-gray-900">
                              {debate.teams?.NEG?.teamName || "—"}
                            </div>
                            {ballot?.teamScores?.NEG && (
                              <div className="text-[11px] text-gray-500 font-mono">
                                {ballot.teamScores.NEG.win ? "WIN" : "LOSS"} &bull;{" "}
                                {ballot.teamScores.NEG.totalSpeakerScore} spks
                              </div>
                            )}
                          </td>
                        </>
                      )}

                      <td className="text-xs text-gray-700">
                        {debate.adjudicators?.chairName || (
                          <span className="text-red-500 italic text-[11px]">None</span>
                        )}
                      </td>

                      <td className="text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            isConfirmed
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : isDraft
                              ? "bg-amber-100 text-amber-800 border border-amber-300"
                              : "bg-gray-100 text-gray-500 border border-gray-200"
                          }`}
                        >
                          {isConfirmed ? "Confirmed" : isDraft ? "Draft" : "Unsubmitted"}
                        </span>
                      </td>

                      <td className="text-right">
                        <Link
                          href={`/${tournament?.slug}/results/${activeRound?.seq}/${debate.id}`}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded text-xs border border-blue-200 transition"
                        >
                          <Edit className="w-3 h-3" />
                          <span>{ballot ? "Edit Ballot" : "Enter Ballot"}</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeRound && (
        <div className="border-t border-[#d0d7de] pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <label className="flex items-start gap-2.5 text-xs text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(activeRound.silent)}
              onChange={(event) => updateRound({ ...activeRound, silent: event.target.checked })}
              className="mt-0.5 rounded border-gray-300 text-blue-600"
            />
            <span>
              <strong className="block text-gray-900">Silent round</strong>
              Hide this round&apos;s results and team outcomes from the public tab.
            </span>
          </label>
          <div className="flex flex-col items-start sm:items-end gap-1.5">
            <button
              type="button"
              onClick={() => updateRound({ ...activeRound, resultsReleased: !activeRound.resultsReleased })}
              disabled={!activeRound.resultsReleased && !allBallotsConfirmed}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded text-xs font-bold disabled:opacity-50 ${
                activeRound.resultsReleased
                  ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {activeRound.resultsReleased ? <Lock className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {activeRound.resultsReleased ? "Unpublish Round Results" : "Publish Round Results"}
            </button>
            <span className="text-[11px] text-gray-500">
              {activeRound.resultsReleased
                ? "Round results are published."
                : allBallotsConfirmed
                ? "Ballots are saved; publish when ready."
                : "Confirm every ballot before publishing."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
