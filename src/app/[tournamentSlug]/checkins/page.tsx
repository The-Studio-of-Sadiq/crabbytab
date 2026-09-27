"use client";

import React, { useState } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import {
  Clock,
  UserCheck,
  CheckCircle2,
  XCircle,
  Users,
  Users2,
  MapPin,
  Search,
  Sparkles,
} from "lucide-react";

export default function CheckinsPage() {
  const {
    tournament,
    teams,
    adjudicators,
    venues,
    updateTeam,
    updateAdjudicator,
    updateVenue,
  } = useTournament();

  const [activeTab, setActiveTab] = useState<"teams" | "adjs" | "venues">("teams");
  const [searchQuery, setSearchQuery] = useState("");

  const checkedInTeams = teams.filter((t) => t.checkedIn !== false).length;
  const checkedInAdjs = adjudicators.filter((a) => a.checkedIn !== false).length;
  const checkedInVenues = venues.filter((v) => v.available !== false).length;

  const toggleTeamCheckin = async (team: any) => {
    await updateTeam({ ...team, checkedIn: team.checkedIn === false });
  };

  const toggleAdjCheckin = async (adj: any) => {
    await updateAdjudicator({ ...adj, checkedIn: adj.checkedIn === false });
  };

  const checkInAll = async () => {
    if (activeTab === "teams") {
      for (const t of teams) {
        if (t.checkedIn === false) await updateTeam({ ...t, checkedIn: true });
      }
    } else if (activeTab === "adjs") {
      for (const a of adjudicators) {
        if (a.checkedIn === false) await updateAdjudicator({ ...a, checkedIn: true });
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Clock className="w-6 h-6 text-blue-600" />
            <span>Availability</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Mark teams, adjudicators, and venues available for the current round before generating the draw.
          </p>
        </div>

        <button
          onClick={checkInAll}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-xs shadow-xs transition"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Check In All {activeTab.toUpperCase()}</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center space-x-2 border-b border-[#d0d7de] pb-3">
        <button
          onClick={() => setActiveTab("teams")}
          className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
            activeTab === "teams"
              ? "bg-blue-600 text-white shadow-xs"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>
            Teams ({checkedInTeams}/{teams.length})
          </span>
        </button>

        <button
          onClick={() => setActiveTab("adjs")}
          className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
            activeTab === "adjs"
              ? "bg-blue-600 text-white shadow-xs"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <Users2 className="w-3.5 h-3.5" />
          <span>
            Adjudicators ({checkedInAdjs}/{adjudicators.length})
          </span>
        </button>
      </div>

      {/* List */}
      <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left tabby-table">
            <thead>
              <tr>
                <th className="w-12 text-center">#</th>
                <th>{activeTab === "teams" ? "Team Name" : "Adjudicator Name"}</th>
                <th>Institution</th>
                <th className="w-32 text-center">Check-in Status</th>
              </tr>
            </thead>
            <tbody>
              {activeTab === "teams"
                ? teams.map((t, idx) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                      <td className="font-bold text-gray-900 text-xs">{t.name}</td>
                      <td className="text-xs text-gray-600">{t.institutionName || "—"}</td>
                      <td className="text-center">
                        <button
                          onClick={() => toggleTeamCheckin(t)}
                          className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-xs font-bold transition ${
                            t.checkedIn !== false
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200"
                              : "bg-red-100 text-red-800 border border-red-300 hover:bg-red-200"
                          }`}
                        >
                          {t.checkedIn !== false ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Present</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-red-600" />
                              <span>Absent</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))
                : adjudicators.map((a, idx) => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                      <td className="font-bold text-gray-900 text-xs">{a.name}</td>
                      <td className="text-xs text-gray-600">{a.institutionName || "Independent"}</td>
                      <td className="text-center">
                        <button
                          onClick={() => toggleAdjCheckin(a)}
                          className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-xs font-bold transition ${
                            a.checkedIn !== false
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200"
                              : "bg-red-100 text-red-800 border border-red-300 hover:bg-red-200"
                          }`}
                        >
                          {a.checkedIn !== false ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Present</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3.5 h-3.5 text-red-600" />
                              <span>Absent</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
