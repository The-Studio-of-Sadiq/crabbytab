"use client";

import React, { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import {
  Key,
  Copy,
  ExternalLink,
  Check,
  Search,
  RefreshCw,
  Users2,
  FileCheck2,
  MessageSquareHeart,
  ShieldAlert,
  AlertTriangle,
  Download,
  Share2,
} from "lucide-react";
import { getAbsolutePrivateUrl, getAdjudicatorPrivatePath, getTeamPrivatePath } from "@/lib/privateUrls";

export default function PrivateUrlsManagementPage() {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;

  const {
    tournament,
    loading,
    teams,
    adjudicators,
    institutions,
    generatePrivateUrlKeys,
  } = useTournament();

  const [activeTab, setActiveTab] = useState<"adjudicators" | "teams">("adjudicators");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [copiedAllNotice, setCopiedAllNotice] = useState(false);

  // Auto-generate keys on first visit if any are missing
  React.useEffect(() => {
    if (loading) return;
    const missingAdjKeys = adjudicators.some((a) => !a.privateUrlKey);
    const missingTeamKeys = teams.some((t) => !t.privateUrlKey);
    if (missingAdjKeys || missingTeamKeys) {
      generatePrivateUrlKeys(false);
    }
  }, [loading, adjudicators, teams, generatePrivateUrlKeys]);

  const handleCopy = (text: string, keyId: string) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(keyId);
      setTimeout(() => setCopiedKey(null), 2500);
    }
  };

  const handleGenerate = async (forceRegenerate = false) => {
    setIsGenerating(true);
    try {
      await generatePrivateUrlKeys(forceRegenerate);
      setShowRegenConfirm(false);
    } finally {
      setIsGenerating(false);
    }
  };

  // Filter adjudicators
  const filteredAdjudicators = useMemo(() => {
    return adjudicators.filter((a) => {
      const q = searchQuery.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        (a.institutionName && a.institutionName.toLowerCase().includes(q)) ||
        (a.email && a.email.toLowerCase().includes(q))
      );
    });
  }, [adjudicators, searchQuery]);

  // Filter teams
  const filteredTeams = useMemo(() => {
    return teams.filter((t) => {
      const q = searchQuery.toLowerCase();
      const matchSpk = t.speakers?.some((s) => s.name.toLowerCase().includes(q));
      return (
        t.name.toLowerCase().includes(q) ||
        (t.institutionName && t.institutionName.toLowerCase().includes(q)) ||
        Boolean(matchSpk)
      );
    });
  }, [teams, searchQuery]);

  const handleCopyAll = () => {
    const lines: string[] = [];
    if (activeTab === "adjudicators") {
      lines.push("Name\tInstitution\tRole\tPrivate URL");
      filteredAdjudicators.forEach((a) => {
        const key = a.privateUrlKey;
        if (!key) return;
        const url = getAbsolutePrivateUrl(tournamentSlug, "adjudicator", key);
        lines.push(`${a.name}\t${a.institutionName || "Unaffiliated"}\t${a.trainee ? "Trainee" : "Judge"}\t${url}`);
      });
    } else {
      lines.push("Team Name\tInstitution\tSpeakers\tPrivate URL");
      filteredTeams.forEach((t) => {
        const key = t.privateUrlKey;
        if (!key) return;
        const url = getAbsolutePrivateUrl(tournamentSlug, "team", key);
        const spks = (t.speakers || []).map((s) => s.name).join(", ");
        lines.push(`${t.name}\t${t.institutionName || "Unaffiliated"}\t${spks}\t${url}`);
      });
    }

    if (navigator?.clipboard) {
      navigator.clipboard.writeText(lines.join("\n"));
      setCopiedAllNotice(true);
      setTimeout(() => setCopiedAllNotice(false), 3000);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl pb-16">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Key className="w-6 h-6 text-blue-600" />
            <span>Participant Private URLs</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Tabbycat-style individual private URLs for adjudicators (ballots & feedback) and teams (feedback only).
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleCopyAll}
            className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition shadow-2xs"
          >
            {copiedAllNotice ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Copied Table to Clipboard!</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5 text-gray-500" />
                <span>Copy Current List</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleGenerate(false)}
            disabled={isGenerating}
            className="px-3 py-1.5 bg-blue-600 text-white hover:bg-blue-700 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
            <span>Ensure All Keys Assigned</span>
          </button>
        </div>
      </div>

      {/* Info Callout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-1.5">
          <div className="flex items-center space-x-2 font-bold text-blue-900">
            <FileCheck2 className="w-4 h-4 text-blue-600" />
            <span>Adjudicator Private URLs</span>
          </div>
          <p className="text-blue-800 leading-relaxed text-[11px]">
            Adjudicators receive a dedicated portal link to view assigned rooms and panel roles,{" "}
            <strong>submit ballots</strong> for debates where they chair, and{" "}
            <strong>submit confidential ratings on other adjudicators</strong>.
          </p>
        </div>

        <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-1.5">
          <div className="flex items-center space-x-2 font-bold text-emerald-950">
            <MessageSquareHeart className="w-4 h-4 text-emerald-600" />
            <span>Team Private URLs (Feedback Only)</span>
          </div>
          <p className="text-emerald-900 leading-relaxed text-[11px]">
            Teams receive a private link to check their debate room, side, and assigned panel, and{" "}
            <strong>submit feedback on the adjudicators who judged them</strong>. Ballots and scores cannot be modified by teams.
          </p>
        </div>
      </div>

      {/* Tab Navigation & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#d0d7de] pb-3">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab("adjudicators")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeTab === "adjudicators"
                ? "bg-blue-600 text-white shadow-2xs"
                : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
            }`}
          >
            Adjudicators ({adjudicators.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("teams")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeTab === "teams"
                ? "bg-emerald-600 text-white shadow-2xs"
                : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
            }`}
          >
            Teams ({teams.length})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={`Search ${activeTab}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-white border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-[#d0d7de] rounded-xl shadow-xs overflow-hidden">
        {activeTab === "adjudicators" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f6f8fa] border-b border-[#d0d7de] text-gray-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-4">Adjudicator</th>
                  <th className="py-2.5 px-4">Institution</th>
                  <th className="py-2.5 px-4">Role / Rating</th>
                  <th className="py-2.5 px-4">Private URL Link</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredAdjudicators.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      No adjudicators found.
                    </td>
                  </tr>
                ) : (
                  filteredAdjudicators.map((adj) => {
                    const key = adj.privateUrlKey;
                    const fullUrl = key ? getAbsolutePrivateUrl(tournamentSlug, "adjudicator", key) : "";
                    const path = key ? getAdjudicatorPrivatePath(tournamentSlug, key) : "";
                    const isCopied = copiedKey === adj.id;

                    return (
                      <tr key={adj.id} className="hover:bg-gray-50/70 transition">
                        <td className="py-3 px-4 font-bold text-gray-900">
                          {adj.name}
                          {adj.email && (
                            <span className="block text-[10px] font-normal text-gray-500">
                              {adj.email}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-gray-600">
                          {adj.institutionName || "Unaffiliated"}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center space-x-1.5">
                            {adj.trainee ? (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                                Trainee
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300">
                                Voting Judge
                              </span>
                            )}
                            <span className="text-[10px] font-mono text-gray-500">
                              (Score: {adj.baseScore})
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-gray-700">
                          <div className="flex items-center space-x-1.5 max-w-xs truncate">
                            <span className="truncate bg-gray-50 px-2 py-1 rounded border border-gray-200">
                              {path || "Generating passcode…"}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopy(fullUrl, adj.id)}
                              disabled={!key}
                              className="px-2.5 py-1 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded text-xs font-medium flex items-center space-x-1 transition"
                              title="Copy full private link to clipboard"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span className="text-emerald-700 font-semibold">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-gray-500" />
                                  <span>Copy Link</span>
                                </>
                              )}
                            </button>

                            {key && (
                              <Link
                                href={path}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition"
                                title="Open private portal as this adjudicator"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f6f8fa] border-b border-[#d0d7de] text-gray-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-4">Team</th>
                  <th className="py-2.5 px-4">Institution</th>
                  <th className="py-2.5 px-4">Speakers</th>
                  <th className="py-2.5 px-4">Private URL Link (Feedback Only)</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredTeams.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      No teams found.
                    </td>
                  </tr>
                ) : (
                  filteredTeams.map((t) => {
                    const key = t.privateUrlKey;
                    const fullUrl = key ? getAbsolutePrivateUrl(tournamentSlug, "team", key) : "";
                    const path = key ? getTeamPrivatePath(tournamentSlug, key) : "";
                    const isCopied = copiedKey === t.id;

                    return (
                      <tr key={t.id} className="hover:bg-gray-50/70 transition">
                        <td className="py-3 px-4 font-bold text-gray-900">{t.name}</td>
                        <td className="py-3 px-4 text-gray-600">
                          {t.institutionName || "Unaffiliated"}
                        </td>
                        <td className="py-3 px-4 text-gray-500">
                          {(t.speakers || []).map((s) => s.name).join(", ") || "—"}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-gray-700">
                          <div className="flex items-center space-x-1.5 max-w-xs truncate">
                            <span className="truncate bg-gray-50 px-2 py-1 rounded border border-gray-200">
                              {path || "Generating passcode…"}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopy(fullUrl, t.id)}
                              disabled={!key}
                              className="px-2.5 py-1 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded text-xs font-medium flex items-center space-x-1 transition"
                              title="Copy full private link to clipboard"
                            >
                              {isCopied ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span className="text-emerald-700 font-semibold">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-gray-500" />
                                  <span>Copy Link</span>
                                </>
                              )}
                            </button>

                            {key && (
                              <Link
                                href={path}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded transition"
                                title="Open private portal as this team"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Security notice & Regenerate Modal */}
      <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2 text-gray-600">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Each private URL contains that participant&apos;s passcode. Anyone with the link can access
            that portal, so distribute it privately.
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowRegenConfirm(true)}
          className="text-xs text-red-600 hover:text-red-700 font-semibold underline shrink-0 ml-4"
        >
          Regenerate All Private Keys
        </button>
      </div>

      {showRegenConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-xl border border-gray-200 space-y-3">
            <h3 className="font-bold text-gray-900 text-sm flex items-center space-x-2 text-red-600">
              <AlertTriangle className="w-4 h-4" />
              <span>Regenerate All Keys?</span>
            </h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              This will create new secret URLs for all adjudicators and teams. Any previously distributed
              links will no longer work.
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRegenConfirm(false)}
                className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md text-xs hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleGenerate(true)}
                disabled={isGenerating}
                className="px-3 py-1.5 bg-red-600 text-white rounded-md text-xs font-semibold hover:bg-red-700 transition"
              >
                {isGenerating ? "Regenerating..." : "Confirm & Regenerate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
