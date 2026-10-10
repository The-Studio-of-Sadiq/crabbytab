"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
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
  Cloud,
  CloudOff,
  Upload,
  CloudDownload,
  Download,
} from "lucide-react";

export function Navbar({ tournamentSlug }: { tournamentSlug: string }) {
  const router = useRouter();
  const {
    tournament,
    rounds,
    activeRound,
    setActiveRound,
    createRound,
    cloudSyncState,
    cloudSyncMessage,
    localSaveError,
    isOwnerOrAdmin,
    isDataEntryAssistant,
    uploadToCloud,
    downloadFromCloud,
    exportSyncRecovery,
    exportTournamentBackup,
    importTournamentBackup,
    syncDataEntry,
  } = useTournament();
  const { user, logout } = useAuth();
  const [isOnline, setIsOnline] = useState(true);
  const [showRoundModal, setShowRoundModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [newRoundName, setNewRoundName] = useState("");
  const [newRoundAbbr, setNewRoundAbbr] = useState("");
  const [newRoundStage, setNewRoundStage] = useState<"preliminary" | "elimination">("preliminary");
  const [isCreatingRound, setIsCreatingRound] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  const handleUpload = async () => {
    if (!window.confirm(
      "Merge this device's records into Firestore? Cloud-only records are retained. Different cloud versions are archived before replacement. Local deletions are not applied to cloud."
    )) {
      return;
    }
    try {
      await uploadToCloud();
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const handleDownload = async () => {
    if (
      !window.confirm(
        "Merge Firestore records into this device? Local-only records and this device's version of matching records are retained. No cloud records are deleted."
      )
    ) {
      return;
    }
    try {
      await downloadFromCloud();
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const handleExportRecovery = async () => {
    setShowUserMenu(false);
    try {
      await exportSyncRecovery();
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const handleImportBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setShowUserMenu(false);
    if (!file) return;
    try {
      await importTournamentBackup(file);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not restore tournament backup.");
    }
  };

  const handleStaffSync = async () => {
    if (!window.confirm(
      "Sync participant, ballot, feedback, and result changes? Tournament settings, draw pairings, and allocations will not be uploaded."
    )) {
      return;
    }
    try {
      await syncDataEntry();
    } catch {
      // The sync state displays the specific failure.
    }
  };

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
        <input
          ref={backupInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleImportBackup}
        />
        <div className="flex items-center justify-between h-14 max-md:h-auto max-md:min-h-14 max-md:flex-wrap max-md:gap-y-2 max-md:py-2">
          {/* Brand & Tournament Name */}
          <div className="flex min-w-0 items-center space-x-2 sm:space-x-4">
            <Link
              href="/"
              className="flex shrink-0 items-center space-x-2 text-white font-bold tracking-tight text-lg hover:text-gray-200 transition"
            >
              <Image src="/crabbytab.svg" alt="" width={32} height={32} className="h-8 w-8" />
              <span className="hidden sm:inline">CrabbyTab</span>
            </Link>

            <span className="text-gray-600 hidden sm:inline">/</span>

            <div className="flex min-w-0 items-center space-x-2">
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

            {isOwnerOrAdmin && (
              <button
                onClick={() => setShowRoundModal(true)}
                className="p-1 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded text-xs ml-1"
                title="Add New Round"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Right Actions */}
          <div className="flex items-center space-x-3 max-md:w-full max-md:justify-between max-md:gap-2 max-md:space-x-0">
            <span
              className={`hidden sm:inline-flex items-center space-x-1 text-[10px] ${
                isOnline ? "text-emerald-300" : "text-amber-300"
              }`}
              title={isOnline ? "Offline-first; changes are saved locally" : "Offline; changes are saved locally"}
            >
              {isOnline ? <Cloud className="w-3 h-3" /> : <CloudOff className="w-3 h-3" />}
              <span>{isOnline ? "Local copy" : "Offline"}</span>
            </span>
            {user && isOwnerOrAdmin ? (
              <>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!isOnline || cloudSyncState === "syncing"}
                  title="Merge cloud records with this device's local copy"
                  className="inline-flex items-center space-x-1 px-2 py-1 text-[10px] font-semibold rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50"
                >
                  <CloudDownload className="w-3 h-3" />
                  <span className="max-sm:hidden">{cloudSyncState === "syncing" ? "Syncing…" : "Download"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={!isOnline || cloudSyncState === "syncing"}
                  title="Merge this device's records into Firestore; archive any conflicting cloud versions"
                  className="inline-flex items-center space-x-1 px-2 py-1 text-[10px] font-semibold rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-50"
                >
                  <Upload className="w-3 h-3" />
                  <span className="max-sm:hidden">{cloudSyncState === "syncing" ? "Syncing…" : "Upload"}</span>
                </button>
              </>
            ) : user && isDataEntryAssistant ? (
              <button
                type="button"
                onClick={handleStaffSync}
                disabled={!isOnline || cloudSyncState === "syncing"}
                title="Sync approved participant, ballot, feedback, and result records"
                className="inline-flex items-center space-x-1 px-2 py-1 text-[10px] font-semibold rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50"
              >
                <Cloud className="w-3 h-3" />
                <span>{cloudSyncState === "syncing" ? "Syncing…" : "Sync"}</span>
              </button>
            ) : !user ? (
              <Link
                href={`/login?next=${encodeURIComponent(`/${tournamentSlug}`)}`}
                title="Sign in only when you want to upload your local copy"
                className="text-[10px] text-blue-200 hover:text-white underline"
              >
                Sign in to upload
              </Link>
            ) : null}
            {cloudSyncMessage && (
              <span
                role="status"
                className={`hidden lg:inline max-w-[220px] truncate text-[10px] ${
                  cloudSyncState === "error" ? "text-red-300" : "text-emerald-200"
                }`}
              >
                {cloudSyncMessage}
              </span>
            )}
            {localSaveError && (
              <span role="alert" className="hidden lg:inline max-w-[220px] truncate text-[10px] text-red-300">
                {localSaveError}
              </span>
            )}
            {/* Public View Link */}
            <Link
              href={`/${tournamentSlug}/public`}
              target="_blank"
              className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-medium rounded bg-gray-700/80 hover:bg-gray-600 text-gray-200 border border-gray-600 transition max-sm:px-2"
            >
              <span className="max-sm:hidden">Public Tab</span>
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
                    href={`/${tournamentSlug}/config/draw`}
                    className="block px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
                    onClick={() => setShowUserMenu(false)}
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span>Tournament Settings</span>
                  </Link>
                  {isOwnerOrAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setShowUserMenu(false);
                          try {
                            exportTournamentBackup();
                          } catch (error) {
                            window.alert(error instanceof Error ? error.message : "Could not export backup.");
                          }
                        }}
                        className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export Tournament Backup</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => backupInputRef.current?.click()}
                        className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
                      >
                        <CloudDownload className="w-3.5 h-3.5" />
                        <span>Merge Tournament Backup</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleExportRecovery}
                        disabled={!isOnline || cloudSyncState === "syncing"}
                        className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50 flex items-center space-x-2"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export Sync Recovery</span>
                      </button>
                    </>
                  )}
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
