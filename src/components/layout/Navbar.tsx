"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  ExternalLink,
  Plus,
  Layers,
  ChevronDown,
  LogOut,
  Shield,
} from "lucide-react";

export function Navbar({ tournamentSlug }: { tournamentSlug: string }) {
  const router = useRouter();
  const { tournament, rounds, activeRound, setActiveRound, createRound } = useTournament();
  const { user, logout } = useAuth();
  const [showRoundModal, setShowRoundModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [newRoundName, setNewRoundName] = useState("");
  const [newRoundAbbr, setNewRoundAbbr] = useState("");
  const [newRoundStage, setNewRoundStage] = useState<"preliminary" | "elimination">("preliminary");
  const [isCreatingRound, setIsCreatingRound] = useState(false);

  const handleCreateRound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoundName.trim()) return;
    setIsCreatingRound(true);
    try {
      await createRound(
        newRoundName.trim(),
        newRoundAbbr.trim() || `R${rounds.length + 1}`,
        newRoundStage
      );
      setNewRoundName("");
      setNewRoundAbbr("");
      setShowRoundModal(false);
    } finally {
      setIsCreatingRound(false);
    }
  };

  return (
    <header className="bg-[#24292e] text-white border-b border-[#1b1f23] sticky top-0 z-50 select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Brand & Tournament Name */}
          <div className="flex items-center space-x-4">
            <Link
              href="/"
              className="flex items-center space-x-2 text-white font-bold tracking-tight text-lg hover:text-gray-200 transition"
            >
              <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center font-mono text-sm font-bold shadow-sm">
                CT
              </div>
              <span className="hidden sm:inline">CrabbyTab</span>
            </Link>

            <span className="text-gray-600 hidden sm:inline">/</span>

            <div className="flex items-center space-x-2">
              <span className="font-semibold text-gray-100 text-sm md:text-base truncate max-w-[200px] md:max-w-[320px]">
                {tournament?.shortName || tournament?.name || tournamentSlug}
              </span>
              <span className="bg-blue-900/60 text-blue-300 text-xs px-2 py-0.5 rounded uppercase font-semibold border border-blue-700/50">
                {tournament?.format === "bp" ? "BP (4-Team)" : "UADC (2-Team)"}
              </span>
            </div>
          </div>

          {/* Round Selector Pill */}
          <div className="hidden md:flex items-center space-x-1 bg-[#1c2128] p-1 rounded-lg border border-gray-700/60">
            {rounds.map((r) => {
              const isActive = activeRound?.id === r.id;
              const isConfirmed = r.drawStatus === "confirmed" || r.resultsReleased;
              const isDraft = r.drawStatus === "draft";

              return (
                <button
                  key={r.id}
                  onClick={() => setActiveRound(r)}
                  className={`px-3 py-1 text-xs font-medium rounded transition flex items-center space-x-1.5 ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm font-semibold"
                      : "text-gray-300 hover:text-white hover:bg-gray-700/50"
                  }`}
                >
                  <span>{r.abbreviation || `R${r.seq}`}</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isConfirmed
                        ? "bg-emerald-400"
                        : isDraft
                        ? "bg-amber-400"
                        : "bg-gray-500"
                    }`}
                  />
                </button>
              );
            })}

            <button
              onClick={() => setShowRoundModal(true)}
              className="p-1 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded text-xs ml-1"
              title="Add New Round"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Right Actions */}
          <div className="flex items-center space-x-3">
            {/* Public View Link */}
            <Link
              href={`/${tournamentSlug}/public`}
              target="_blank"
              className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded bg-gray-700/80 hover:bg-gray-600 text-gray-200 border border-gray-600 transition"
            >
              <span>Public Tab</span>
              <ExternalLink className="w-3 h-3" />
            </Link>

            {/* User Profile */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center space-x-1.5 text-xs text-gray-300 hover:text-white focus:outline-none p-1 rounded hover:bg-gray-700"
              >
                <div className="w-6 h-6 rounded-full bg-blue-600/80 flex items-center justify-center text-white font-bold">
                  {user?.displayName ? user.displayName.charAt(0).toUpperCase() : "T"}
                </div>
                <ChevronDown className="w-3 h-3 text-gray-400" />
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg py-1 border border-gray-200 z-50 text-gray-800">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-xs font-semibold text-gray-900">{user?.displayName || "Tab Director"}</p>
                    <p className="text-xs text-gray-500 truncate">{user?.email || "director@tabbycat.local"}</p>
                  </div>
                  <Link
                    href="/"
                    className="block px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
                    onClick={() => setShowUserMenu(false)}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>All Tournaments</span>
                  </Link>
                  <Link
                    href={`/${tournamentSlug}/config`}
                    className="block px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
                    onClick={() => setShowUserMenu(false)}
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>Tournament Settings</span>
                  </Link>
                  <button
                    onClick={async () => {
                      setShowUserMenu(false);
                      await logout();
                      router.push("/");
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center space-x-2"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Round Modal */}
      {showRoundModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Plus className="w-5 h-5 text-blue-600" />
              <span>Create New Tournament Round</span>
            </h3>
            <form onSubmit={handleCreateRound} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Round Name</label>
                <input
                  type="text"
                  required
                  placeholder={`Round ${rounds.length + 1}`}
                  value={newRoundName}
                  onChange={(e) => setNewRoundName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Abbreviation (e.g. R4, QF, SF, GF)</label>
                <input
                  type="text"
                  placeholder={`R${rounds.length + 1}`}
                  value={newRoundAbbr}
                  onChange={(e) => setNewRoundAbbr(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Round Stage</label>
                <select
                  value={newRoundStage}
                  onChange={(e) => setNewRoundStage(e.target.value as any)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="preliminary">Preliminary (In-Rounds)</option>
                  <option value="elimination">Elimination (Out-Rounds / Break)</option>
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowRoundModal(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingRound}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs"
                >
                  {isCreatingRound ? "Creating..." : "Create Round"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
}
