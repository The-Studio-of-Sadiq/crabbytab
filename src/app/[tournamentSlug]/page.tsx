"use client";

import React from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { SideBadge } from "@/components/ui/SideBadge";
import {
  Shuffle,
  Users2,
  FileCheck2,
  Trophy,
  ArrowRight,
  Sparkles,
  Users,
  MapPin,
  Lightbulb,
  CheckCircle2,
  AlertCircle,
  Clock,
  Layers,
} from "lucide-react";

export default function TournamentDashboardPage() {
  const {
    tournament,
    activeRound,
    rounds,
    teams,
    adjudicators,
    venues,
    debates,
    ballots,
    motions,
    generateDraw,
    autoAllocate,
    loadDemoData,
  } = useTournament();

  const roundDebates = activeRound ? debates.filter((d) => d.roundId === activeRound.id) : [];
  const confirmedBallots = activeRound
    ? ballots.filter((b) => b.roundId === activeRound.id && b.confirmed)
    : [];
  const roundMotion = activeRound
    ? motions.find((m) => m.rounds && m.rounds.includes(activeRound.id))
    : null;

  const isBP = tournament?.format === "bp";

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            {tournament?.name || "Tournament Dashboard"}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Format:{" "}
            <span className="font-semibold text-gray-700 uppercase">
              {isBP ? "British Parliamentary (4 Teams/Room)" : "Asian/Australs (2 Teams/Room)"}
            </span>{" "}
            &bull; Status: <span className="text-emerald-600 font-semibold">Active</span>
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {teams.length === 0 && (
            <button
              onClick={() => loadDemoData()}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shadow-xs transition"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Load Demo Data</span>
            </button>
          )}
          <Link
            href={`/${tournament?.slug}/public`}
            target="_blank"
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded text-xs font-semibold border border-gray-300 transition"
          >
            <span>Public Index</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      <ol className="grid grid-cols-1 md:grid-cols-7 gap-2 text-[11px]">
        {[
          { n: "1", t: "Availability", h: `/${tournament?.slug}/checkins` },
          { n: "2", t: "Generate draw", h: `/${tournament?.slug}/draw` },
          { n: "3", t: "Allocate", h: `/${tournament?.slug}/allocation` },
          { n: "4", t: "Display", h: `/${tournament?.slug}/display` },
          { n: "5", t: "Motions", h: `/${tournament?.slug}/motions` },
          { n: "6", t: "Results", h: `/${tournament?.slug}/results` },
          { n: "7", t: "Standings", h: `/${tournament?.slug}/standings` },
        ].map((step) => (
          <li key={step.n}>
            <Link
              href={step.h}
              className="flex items-center space-x-2 border border-[#d0d7de] rounded px-2 py-2 hover:border-blue-400 hover:bg-blue-50"
            >
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                {step.n}
              </span>
              <span className="font-semibold text-gray-800">{step.t}</span>
            </Link>
          </li>
        ))}
      </ol>

      {/* Active Round Action Hero Card */}
      {activeRound ? (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50/40 rounded-lg border border-blue-200 p-5 shadow-xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 mb-1">
                <span className="text-xs font-bold text-blue-700 uppercase tracking-wide">
                  Active Tournament Stage
                </span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.2 rounded uppercase ${
                    activeRound.drawStatus === "confirmed"
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : activeRound.drawStatus === "draft"
                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                      : "bg-gray-200 text-gray-700"
                  }`}
                >
                  {activeRound.drawStatus === "confirmed"
                    ? "Confirmed Draw"
                    : activeRound.drawStatus === "draft"
                    ? "Draft Generated"
                    : "Draw Pending"}
                </span>
              </div>
              <h2 className="text-xl font-bold text-gray-900">{activeRound.name}</h2>
              {roundMotion ? (
                <p className="text-xs text-gray-700 mt-2 italic bg-white/80 p-2 rounded border border-blue-100 max-w-2xl">
                  <strong>Motion:</strong> &ldquo;{roundMotion.text}&rdquo;
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">No motion assigned to this round yet.</p>
              )}
            </div>

            {/* Quick Action Triggers */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {roundDebates.length === 0 ? (
                <button
                  onClick={() => generateDraw(activeRound.id)}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs transition"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  <span>Generate Draw</span>
                </button>
              ) : (
                <>
                  <Link
                    href={`/${tournament?.slug}/draw`}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-blue-700 border border-blue-300 rounded text-xs font-semibold shadow-2xs transition"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    <span>View Draw ({roundDebates.length} rooms)</span>
                  </Link>

                  <Link
                    href={`/${tournament?.slug}/allocation`}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-indigo-700 border border-indigo-300 rounded text-xs font-semibold shadow-2xs transition"
                  >
                    <Users2 className="w-3.5 h-3.5" />
                    <span>Adjudicator Allocation</span>
                  </Link>

                  <Link
                    href={`/${tournament?.slug}/results`}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs transition"
                  >
                    <FileCheck2 className="w-3.5 h-3.5" />
                    <span>
                      Enter Ballots ({confirmedBallots.length}/{roundDebates.length})
                    </span>
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Progress Bar for Ballots */}
          {roundDebates.length > 0 && (
            <div className="mt-4 pt-3 border-t border-blue-200/60">
              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                <span>Ballot Submission Progress</span>
                <span className="font-semibold text-gray-900">
                  {confirmedBallots.length} of {roundDebates.length} Ballots Confirmed (
                  {Math.round((confirmedBallots.length / Math.max(1, roundDebates.length)) * 100)}%)
                </span>
              </div>
              <div className="w-full h-2.5 bg-blue-200/70 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{
                    width: `${(confirmedBallots.length / Math.max(1, roundDebates.length)) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
          <p className="text-sm text-gray-600">No rounds created yet.</p>
        </div>
      )}

      {/* Overview Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <Link
          href={`/${tournament?.slug}/participants`}
          className="bg-white border border-[#d0d7de] p-4 rounded-lg hover:border-blue-500 hover:shadow-xs transition"
        >
          <div className="flex items-center justify-between text-gray-500 mb-1">
            <span className="text-xs font-semibold uppercase">Teams</span>
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-gray-900">{teams.length}</div>
          <p className="text-[11px] text-gray-500 mt-1">
            {teams.reduce((sum, t) => sum + (t.speakers?.length || 0), 0)} Registered Speakers
          </p>
        </Link>

        <Link
          href={`/${tournament?.slug}/participants?tab=adjs`}
          className="bg-white border border-[#d0d7de] p-4 rounded-lg hover:border-blue-500 hover:shadow-xs transition"
        >
          <div className="flex items-center justify-between text-gray-500 mb-1">
            <span className="text-xs font-semibold uppercase">Adjudicators</span>
            <Users2 className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-bold text-gray-900">{adjudicators.length}</div>
          <p className="text-[11px] text-gray-500 mt-1">
            {adjudicators.filter((a) => !a.trainee).length} Accredited Chairs
          </p>
        </Link>

        <Link
          href={`/${tournament?.slug}/venues`}
          className="bg-white border border-[#d0d7de] p-4 rounded-lg hover:border-blue-500 hover:shadow-xs transition"
        >
          <div className="flex items-center justify-between text-gray-500 mb-1">
            <span className="text-xs font-semibold uppercase">Venues</span>
            <MapPin className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-gray-900">{venues.length}</div>
          <p className="text-[11px] text-gray-500 mt-1">
            {venues.filter((v) => v.available !== false).length} Active Rooms
          </p>
        </Link>

        <Link
          href={`/${tournament?.slug}/standings`}
          className="bg-white border border-[#d0d7de] p-4 rounded-lg hover:border-blue-500 hover:shadow-xs transition"
        >
          <div className="flex items-center justify-between text-gray-500 mb-1">
            <span className="text-xs font-semibold uppercase">Rounds</span>
            <Trophy className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-gray-900">{rounds.length}</div>
          <p className="text-[11px] text-gray-500 mt-1">
            {rounds.filter((r) => r.completed).length} Rounds Completed
          </p>
        </Link>
      </div>

      {/* Active Round Debates Table Preview */}
      {roundDebates.length > 0 && (
        <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
          <div className="p-4 border-b border-[#d0d7de] flex items-center justify-between bg-[#f6f8fa]">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
              <Shuffle className="w-4 h-4 text-gray-600" />
              <span>{activeRound?.name} Matchups & Rooms</span>
            </h3>
            <Link
              href={`/${tournament?.slug}/draw`}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800"
            >
              Full Draw View &rarr;
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left tabby-table">
              <thead>
                <tr>
                  <th className="w-24">Venue</th>
                  {isBP ? (
                    <>
                      <th>Opening Gov (OG)</th>
                      <th>Opening Opp (OO)</th>
                      <th>Closing Gov (CG)</th>
                      <th>Closing Opp (CO)</th>
                    </>
                  ) : (
                    <>
                      <th>Affirmative (Gov)</th>
                      <th>Negative (Opp)</th>
                    </>
                  )}
                  <th>Chair Adjudicator</th>
                  <th className="w-28 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {roundDebates.map((debate) => {
                  const isConfirmed = debate.resultStatus === "confirmed";

                  return (
                    <tr key={debate.id} className="hover:bg-gray-50">
                      <td className="font-semibold text-gray-800 text-xs">
                        {debate.venueName || "Unassigned"}
                      </td>
                      {isBP ? (
                        <>
                          <td className="text-xs font-medium text-gray-900">
                            {debate.teams?.OG?.teamName || "—"}
                          </td>
                          <td className="text-xs font-medium text-gray-900">
                            {debate.teams?.OO?.teamName || "—"}
                          </td>
                          <td className="text-xs font-medium text-gray-900">
                            {debate.teams?.CG?.teamName || "—"}
                          </td>
                          <td className="text-xs font-medium text-gray-900">
                            {debate.teams?.CO?.teamName || "—"}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="text-xs font-medium text-gray-900">
                            {debate.teams?.AFF?.teamName || "—"}
                          </td>
                          <td className="text-xs font-medium text-gray-900">
                            {debate.teams?.NEG?.teamName || "—"}
                          </td>
                        </>
                      )}
                      <td className="text-xs text-gray-700">
                        {debate.adjudicators?.chairName ? (
                          <span className="font-medium text-gray-900">
                            {debate.adjudicators.chairName}
                          </span>
                        ) : (
                          <span className="text-red-500 italic text-[11px]">Unassigned</span>
                        )}
                      </td>
                      <td className="text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            isConfirmed
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                              : debate.resultStatus === "draft"
                              ? "bg-amber-100 text-amber-800 border border-amber-300"
                              : "bg-gray-100 text-gray-600 border border-gray-200"
                          }`}
                        >
                          {debate.resultStatus || "none"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
