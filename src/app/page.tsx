"use client";

import React, { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  ArrowRight,
  Layers,
  RefreshCw,
  Trash2,
  ExternalLink,
  Shield,
  CheckCircle2,
  Clock,
  User as UserIcon,
} from "lucide-react";
import type { TournamentFormat } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { safeJsonParse } from "@/lib/safeJson";

interface StoredTournamentSummary {
  id: string;
  slug: string;
  name: string;
  format: TournamentFormat;
  createdAt: string;
  ownerId?: string;
  ownerEmail?: string;
  isOwner?: boolean;
  isLocal?: boolean;
  accessRole?: "admin" | "dataEntry";
}

export default function HomePage() {
  const router = useRouter();
  const { user, loading: authLoading, logout, isGlobalAdmin } = useAuth();
  const [tournaments, setTournaments] = useState<StoredTournamentSummary[]>([]);
  const [loadingTournaments, setLoadingTournaments] = useState(true);
  const [filterTab, setFilterTab] = useState<"all" | "mine">("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cloudError, setCloudError] = useState("");

  // Tournament creation is reserved for global administrators.
  const goCreate = () => router.push("/tournaments/new");

  // Scan localStorage for local copies
  const getLocalTournaments = useCallback((): StoredTournamentSummary[] => {
    const list: StoredTournamentSummary[] = [];

    if (typeof window === "undefined") return list;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("crabbytab_t_") && key.endsWith("_meta")) {
        try {
          const parsedItem = safeJsonParse<Record<string, any> | null>(localStorage.getItem(key), null);
          if (parsedItem && typeof parsedItem === "object" && parsedItem.slug) {
            const item = parsedItem as Record<string, any>;
            list.push({
              id: item.id || `tourn-${item.slug}`,
              slug: item.slug,
              name: item.name || item.slug,
              format: item.format || "bp",
              createdAt: item.createdAt || new Date().toISOString(),
              ownerId: item.ownerId,
              ownerEmail: item.ownerEmail,
              isLocal: true,
            });
          }
        } catch (e) {
          // ignore parsing error
        }
      }
    }

    return list;
  }, []);

  // Local data remains available offline; signed-in accounts load only authorized cloud tournaments.
  const loadTournaments = useCallback(async () => {
    const localList = getLocalTournaments();
    setTournaments(localList.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ));
    setLoadingTournaments(false);
  }, [getLocalTournaments]);

  const refreshCloudTournaments = useCallback(async () => {
    if (!user) {
      await loadTournaments();
      return;
    }
    setLoadingTournaments(true);
    setIsRefreshing(true);
    setCloudError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/tournaments", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json() as {
        error?: string;
        tournaments?: StoredTournamentSummary[];
      };
      if (!response.ok) throw new Error(result.error || "Could not load your tournaments.");

      const localItems = getLocalTournaments();
      const cloudItems = (result.tournaments || []).map((item) => ({
        ...item,
        isOwner: isGlobalAdmin || item.accessRole === "admin",
        isLocal: localItems.some((local) => local.slug === item.slug),
      }));
      const accessibleSlugs = new Set(cloudItems.map((item) => item.slug));
      const cloudBySlug = new Map<string, StoredTournamentSummary>(
        cloudItems.map((item) => [item.slug, item])
      );
      localItems
        .filter((item) => isGlobalAdmin || accessibleSlugs.has(item.slug))
        .forEach((item) => {
          if (!cloudBySlug.has(item.slug)) cloudBySlug.set(item.slug, item);
        });
      setTournaments([...cloudBySlug.values()].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
    } catch (error) {
      console.error("Could not refresh cloud tournaments:", error);
      setCloudError("Could not load the cloud tournament list. Check your connection and try again.");
    } finally {
      setLoadingTournaments(false);
      setIsRefreshing(false);
    }
  }, [getLocalTournaments, isGlobalAdmin, loadTournaments, user]);

  useEffect(() => {
    if (authLoading) return;
    setTournaments([]);
    setLoadingTournaments(true);
    if (user) void refreshCloudTournaments();
    else void loadTournaments();
  }, [authLoading, loadTournaments, refreshCloudTournaments, user]);

  const handleDelete = async (t: StoredTournamentSummary) => {
    if (!confirm(`Are you sure you want to delete tournament "${t.name}"? This action cannot be undone.`)) {
      return;
    }

    // 1. Remove from localStorage
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`crabbytab_t_${t.slug}`)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      console.warn("LocalStorage delete error:", e);
    }

    // Refresh list
    setTournaments((prev) => prev.filter((item) => item.slug !== t.slug));
  };

  const filteredTournaments = tournaments.filter((t) => {
    if (filterTab === "mine") {
      if (!user) return false;
      if (isGlobalAdmin) return true;
      return t.accessRole === "admin" || t.accessRole === "dataEntry";
    }
    return true;
  });

  const myTournamentsCount = user
    ? isGlobalAdmin
      ? tournaments.length
      : tournaments.filter((t) => t.accessRole === "admin" || t.accessRole === "dataEntry").length
    : 0;

  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col">
      {/* Top Banner */}
      <header className="bg-[#24292e] text-white border-b border-[#1b1f23] py-4 px-6 shadow-xs sticky top-0 z-30 max-sm:px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 max-md:flex-wrap">
          <div className="flex min-w-0 items-center space-x-3">
            <Image src="/crabbytab.svg" alt="" width={36} height={36} className="h-9 w-9 shrink-0" />
            <div>
              <h1 className="text-lg font-bold tracking-tight">CrabbyTab</h1>
              <p className="text-xs text-gray-400 max-sm:hidden">Serverless Parliamentary Debate Tabulation System</p>
            </div>
          </div>

          <div className="flex items-center space-x-3 max-sm:space-x-1">
            {authLoading ? null : user ? (
              <>
                <div className="hidden sm:flex items-center space-x-1.5 text-xs text-gray-300 bg-gray-800/80 px-2.5 py-1 rounded border border-gray-700">
                  <UserIcon className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-medium truncate max-w-[160px]">{user.email}</span>
                </div>
                <button
                  onClick={() => logout()}
                  className="text-xs text-gray-300 hover:text-white px-2 py-1 rounded transition hover:bg-gray-800"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link href="/login" className="text-xs text-gray-300 hover:text-white px-2 py-1">
                Sign in to upload
              </Link>
            )}
            {isGlobalAdmin && <button
              onClick={goCreate}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold shadow-xs transition max-sm:px-2"
            >
              <Plus className="w-4 h-4" />
              <span className="max-sm:hidden">Create Tournament</span>
              <span className="hidden max-sm:inline">Create</span>
            </button>}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8 flex-1 w-full space-y-6 max-sm:px-4 max-sm:py-5">
        {/* Welcome Card */}
        <div className="bg-white rounded-lg border border-[#d0d7de] p-6 shadow-xs max-sm:p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 mb-1">
                <h2 className="text-xl font-bold text-gray-900">
                  Welcome to CrabbyTab Debate Tabulation
                </h2>
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>Offline-first · saved on this device</span>
                </span>
              </div>
              <p className="text-sm text-gray-600 max-w-2xl">
                Your working copy stays on this device. Continue tabbing without a connection, then explicitly upload when you are ready.
              </p>
            </div>
            <div className="flex items-center space-x-3 shrink-0">
            </div>
          </div>
        </div>

        {/* Tournaments Header & Filters */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#d0d7de] pb-3">
          <div className="flex items-center space-x-3">
            <h3 className="text-base font-bold text-gray-900 flex items-center space-x-2">
              <Layers className="w-4 h-4 text-blue-600" />
              <span>Tournaments</span>
            </h3>

            {/* Filter Tabs */}
            <div className="flex items-center space-x-1 bg-gray-100 p-0.5 rounded-md border border-gray-200">
              <button
                onClick={() => setFilterTab("all")}
                className={`px-3 py-1 text-xs font-semibold rounded transition ${
                  filterTab === "all"
                    ? "bg-white text-gray-900 shadow-2xs font-bold"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                All ({tournaments.length})
              </button>
              {user && (
                <button
                  onClick={() => setFilterTab("mine")}
                  className={`px-3 py-1 text-xs font-semibold rounded transition ${
                    filterTab === "mine"
                      ? "bg-white text-blue-700 shadow-2xs font-bold"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Assigned Tournaments ({myTournamentsCount})
                </button>
              )}
            </div>
            {cloudError && (
              <p role="alert" className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">
                {cloudError}
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={refreshCloudTournaments}
              disabled={isRefreshing}
              className="inline-flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition disabled:opacity-50"
              title="Explicitly refresh the cloud list; this does not upload or change local tournaments"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-gray-500 ${isRefreshing ? "animate-spin text-blue-600" : ""}`} />
              <span>{isRefreshing ? "Loading..." : "Refresh Cloud List"}</span>
            </button>
          </div>
        </div>

        {/* Tournaments Grid */}
        {loadingTournaments ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-4"
              >
                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                <div className="h-6 bg-gray-200 rounded w-3/4"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                <div className="h-8 bg-gray-100 rounded w-full pt-4"></div>
              </div>
            ))}
          </div>
        ) : filteredTournaments.length === 0 ? (
          <div className="bg-white rounded-lg border border-dashed border-gray-300 p-12 text-center">
            <Layers className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h4 className="text-base font-bold text-gray-800 mb-1">
              {user && !isGlobalAdmin
                ? "No tournaments are assigned to your account"
                : filterTab === "mine"
                  ? "No tournaments created by you yet"
                  : "No tournaments available"}
            </h4>
            <p className="text-xs text-gray-500 max-w-sm mx-auto mb-4">
              {isGlobalAdmin
                ? "Create a new debate tournament to get started."
                : "Ask a tournament administrator to assign your account to a tournament."}
            </p>
            {isGlobalAdmin ? (
              <button
                onClick={goCreate}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold transition shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Create Tournament</span>
              </button>
            ) : !user ? (
              <Link
                href="/login"
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold transition shadow-xs"
              >
                <span>Sign in</span>
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredTournaments.map((t) => {
              const isMine = Boolean(user && (isGlobalAdmin || t.isOwner));
              return (
                <div
                  key={t.slug}
                  className={`bg-white rounded-lg border transition flex flex-col justify-between p-5 hover:shadow-md ${
                    isMine ? "border-blue-300 hover:border-blue-500" : "border-[#d0d7de] hover:border-gray-400"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 uppercase tracking-wide">
                          {t.format === "bp" ? "BP (4-Team)" : "UADC / 2-Team"}
                        </span>
                        {isMine && (
                          <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Shield className="w-3 h-3 text-emerald-600" />
                            <span>Director</span>
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 font-mono">/{t.slug}</span>
                    </div>

                    <h4 className="text-base font-bold text-gray-900 mb-1 line-clamp-2 leading-snug">
                      {t.name}
                    </h4>

                    <div className="text-[11px] text-gray-500 mb-4 flex items-center space-x-1.5">
                      <Clock className="w-3 h-3 text-gray-400" />
                      <span>
                        {new Date(t.createdAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      {t.ownerEmail && (
                        <>
                          <span>&bull;</span>
                          <span className="truncate max-w-[120px]">{t.ownerEmail}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {t.isLocal && (
                        <Link
                          href={`/${t.slug}/public`}
                          className="text-xs font-semibold text-gray-600 hover:text-gray-900 flex items-center space-x-1"
                          title="View Public Tab"
                        >
                          <span>Public Tab</span>
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      )}

                      {t.isLocal && (
                        <button
                          onClick={() => handleDelete(t)}
                          className="p-1 text-gray-400 hover:text-red-600 transition rounded"
                          title="Delete Tournament"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <Link
                      href={`/${t.slug}`}
                      className="inline-flex items-center space-x-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded text-xs transition"
                    >
                      <span>{t.isLocal ? "Enter Tab Room" : "Open Tournament"}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-[#d0d7de] py-4 px-6 text-center text-xs text-gray-500">
        CrabbyTab &bull; Offline-first tournament tabulation
      </footer>
    </div>
  );
}
