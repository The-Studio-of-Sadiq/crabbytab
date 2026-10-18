"use client";

import React, { useState } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { exportStandingsToCsv } from "@/lib/csv/importer";
import { csvFileStem, speakerStandingsCsv } from "@/lib/csv/exporters";
import { downloadCsv } from "@/lib/csv/download";
import { ReleasePanel } from "@/features/tournament/components/ReleasePanel";
import {
  Trophy,
  Award,
  Download,
  Printer,
  Search,
  Filter,
  Medal,
  Users,
  Layers,
} from "lucide-react";

export default function StandingsPage() {
  const {
    tournament,
    teamStandings,
    speakerStandings,
    replyStandings,
    breakCategories,
  } = useTournament();

  const [activeTab, setActiveTab] = useState<"teams" | "speakers" | "replies">("teams");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const isBP = tournament?.format === "bp";

  // Filter Team Standings
  const filteredTeams = teamStandings.filter((t) => {
    const matchesSearch =
      t.teamName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.institutionCode || "").toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (selectedCategory === "all") return true;
    return t.breakCategories && t.breakCategories.includes(selectedCategory);
  });

  // Filter Speaker Standings
  const filteredSpeakers = speakerStandings.filter((s) => {
    const matchesSearch =
      s.speakerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.teamName.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (selectedCategory === "all") return true;
    return s.categories && s.categories.includes(selectedCategory);
  });

  const handleExport = () => {
    const name = tournament?.name || "Tournament";
    if (activeTab === "teams") {
      exportStandingsToCsv(teamStandings, name);
    } else if (activeTab === "speakers") {
      downloadCsv(`${csvFileStem(name)}_Speaker_Standings.csv`, speakerStandingsCsv(speakerStandings));
    } else {
      downloadCsv(`${csvFileStem(name)}_Reply_Standings.csv`, speakerStandingsCsv(replyStandings, { reply: true }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Trophy className="w-6 h-6 text-amber-500" />
            <span>Tournament Standings & Tab</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Real-time rankings computed via Tabbycat standard metric chains (Points &rarr; Speaker Scores &rarr; Rank distribution).
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleExport}
            title={`Download the ${activeTab === "teams" ? "team" : activeTab === "speakers" ? "speaker" : "reply"} standings as CSV`}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 font-semibold border border-gray-300 rounded text-xs shadow-2xs transition"
          >
            <Download className="w-3.5 h-3.5 text-gray-500" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => window.print()}
            className="p-1.5 bg-white hover:bg-gray-50 text-gray-700 font-semibold border border-gray-300 rounded text-xs shadow-2xs transition"
            title="Print Standings"
          >
            <Printer className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>

      <ReleasePanel />

      {/* Tab Switcher & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#d0d7de] pb-3">
        {/* Navigation Tabs */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setActiveTab("teams")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
              activeTab === "teams"
                ? "bg-blue-600 text-white shadow-xs"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Team Standings ({teamStandings.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("speakers")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
              activeTab === "speakers"
                ? "bg-blue-600 text-white shadow-xs"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Speaker Standings ({speakerStandings.length})</span>
          </button>

          {!isBP && replyStandings.length > 0 && (
            <button
              onClick={() => setActiveTab("replies")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
                activeTab === "replies"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <Medal className="w-3.5 h-3.5" />
              <span>Reply Speakers ({replyStandings.length})</span>
            </button>
          )}
        </div>

        {/* Search & Category Filter */}
        <div className="flex items-center space-x-2">
          {breakCategories.length > 0 && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2.5 py-1.5 bg-white font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Categories</option>
              {breakCategories.map((bc) => (
                <option key={bc.id} value={bc.id}>
                  {bc.name}
                </option>
              ))}
            </select>
          )}

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400" />
            <input
              type="text"
              placeholder="Search tab..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 w-44 sm:w-56"
            />
          </div>
        </div>
      </div>

      {/* 1. Team Standings Table */}
      {activeTab === "teams" && (
        <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left tabby-table">
              <thead>
                <tr>
                  <th className="w-12 text-center">#</th>
                  <th>Team</th>
                  <th>Institution</th>
                  <th className="text-right">Points</th>
                  <th className="text-right">Total Speaks</th>
                  <th className="text-right">Avg Speaks</th>
                  {isBP ? (
                    <>
                      <th className="text-center w-12 text-emerald-700 font-bold">1st</th>
                      <th className="text-center w-12 text-blue-700 font-bold">2nd</th>
                      <th className="text-center w-12 text-amber-700 font-bold">3rd</th>
                      <th className="text-center w-12 text-gray-600 font-bold">4th</th>
                    </>
                  ) : (
                    <>
                      <th className="text-center w-16">Wins</th>
                      <th className="text-right w-16">Margin</th>
                    </>
                  )}
                  <th className="w-40 text-center">Round Results</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeams.map((team) => (
                  <tr key={team.teamId} className="hover:bg-gray-50">
                    <td className="text-center font-mono font-bold text-gray-800 text-xs">
                      {team.rank}
                    </td>
                    <td className="font-bold text-gray-900 text-xs">
                      {team.teamName}
                    </td>
                    <td className="text-xs text-gray-600">
                      {team.institutionCode || "—"}
                    </td>
                    <td className="text-right font-mono font-bold text-sm text-blue-600">
                      {team.points}
                    </td>
                    <td className="text-right font-mono font-semibold text-gray-800 text-xs">
                      {team.totalSpeakerScore.toFixed(1)}
                    </td>
                    <td className="text-right font-mono text-gray-600 text-xs">
                      {team.averageSpeakerScore.toFixed(2)}
                    </td>

                    {isBP ? (
                      <>
                        <td className="text-center font-mono text-xs font-semibold text-emerald-700">
                          {team.firstPlaces || 0}
                        </td>
                        <td className="text-center font-mono text-xs font-semibold text-blue-700">
                          {team.secondPlaces || 0}
                        </td>
                        <td className="text-center font-mono text-xs font-semibold text-amber-700">
                          {team.thirdPlaces || 0}
                        </td>
                        <td className="text-center font-mono text-xs text-gray-500">
                          {team.fourthPlaces || 0}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="text-center font-mono font-bold text-xs text-emerald-700">
                          {team.wins || 0}
                        </td>
                        <td className="text-right font-mono text-xs text-gray-700">
                          {team.margins && team.margins > 0 ? `+${team.margins}` : team.margins || 0}
                        </td>
                      </>
                    )}

                    {/* Round Result Pills */}
                    <td className="text-center">
                      <div className="flex items-center justify-center space-x-1">
                        {team.roundResults.map((r, rIdx) => (
                          <span
                            key={rIdx}
                            className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold ${
                              isBP
                                ? r.points === 3
                                  ? "bg-emerald-100 text-emerald-800"
                                  : r.points === 2
                                  ? "bg-blue-100 text-blue-800"
                                  : r.points === 1
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-gray-100 text-gray-500"
                                : r.win
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-700"
                            }`}
                            title={`Round ${r.roundSeq}: ${r.points} pts (${r.side})`}
                          >
                            {r.points}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. Speaker Standings Table */}
      {activeTab === "speakers" && (
        <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left tabby-table">
              <thead>
                <tr>
                  <th className="w-12 text-center">#</th>
                  <th>Speaker</th>
                  <th>Team</th>
                  <th>Institution</th>
                  <th className="text-center">Speeches</th>
                  <th className="text-right">Total Score</th>
                  <th className="text-right">Average</th>
                  <th className="text-center">Round Scores</th>
                </tr>
              </thead>
              <tbody>
                {filteredSpeakers.map((spk) => (
                  <tr key={spk.speakerId} className="hover:bg-gray-50">
                    <td className="text-center font-mono font-bold text-gray-800 text-xs">
                      {spk.rank}
                    </td>
                    <td className="font-bold text-gray-900 text-xs">
                      {spk.speakerName}
                      {spk.categories?.length > 0 && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-gray-100 text-gray-700 uppercase">
                          {spk.categories.join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-gray-700 font-medium">
                      {spk.teamName}
                    </td>
                    <td className="text-xs text-gray-500">
                      {spk.institutionCode || "—"}
                    </td>
                    <td className="text-center font-mono text-xs text-gray-600">
                      {spk.speechesCount}
                    </td>
                    <td className="text-right font-mono font-bold text-sm text-blue-600">
                      {spk.totalScore.toFixed(1)}
                    </td>
                    <td className="text-right font-mono font-semibold text-gray-800 text-xs">
                      {spk.averageScore.toFixed(2)}
                    </td>
                    <td className="text-center">
                      <div className="flex items-center justify-center space-x-1 text-[11px] font-mono text-gray-600">
                        {spk.scoresByRound.map((sr, idx) => (
                          <span key={idx} className="bg-gray-100 px-1.5 py-0.5 rounded">
                            {sr.score}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Reply Speaker Standings */}
      {activeTab === "replies" && (
        <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left tabby-table">
              <thead>
                <tr>
                  <th className="w-12 text-center">#</th>
                  <th>Reply Speaker</th>
                  <th>Team</th>
                  <th className="text-center">Speeches</th>
                  <th className="text-right">Total Score</th>
                  <th className="text-right">Average</th>
                </tr>
              </thead>
              <tbody>
                {replyStandings.map((rep) => (
                  <tr key={rep.speakerId} className="hover:bg-gray-50">
                    <td className="text-center font-mono font-bold text-gray-800 text-xs">
                      {rep.rank}
                    </td>
                    <td className="font-bold text-gray-900 text-xs">{rep.speakerName}</td>
                    <td className="text-xs text-gray-700 font-medium">{rep.teamName}</td>
                    <td className="text-center font-mono text-xs text-gray-600">{rep.speechesCount}</td>
                    <td className="text-right font-mono font-bold text-sm text-blue-600">
                      {rep.totalScore.toFixed(1)}
                    </td>
                    <td className="text-right font-mono font-semibold text-gray-800 text-xs">
                      {rep.averageScore.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
