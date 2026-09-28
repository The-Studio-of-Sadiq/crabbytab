"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Sparkles,
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
import { TournamentFormat } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  getDocs,
  doc,
  deleteDoc,
} from "firebase/firestore";

interface StoredTournamentSummary {
  id?: string;
  slug: string;
  name: string;
  format: TournamentFormat;
  createdAt: string;
  ownerId?: string;
  ownerEmail?: string;
  isOwner?: boolean;
}

export default function HomePage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const [tournaments, setTournaments] = useState<StoredTournamentSummary[]>([]);
  const [loadingTournaments, setLoadingTournaments] = useState(true);
  const [filterTab, setFilterTab] = useState<"all" | "mine">("all");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Creating a tournament happens in the guided setup wizard.
  const goCreate = () =>
    router.push(user ? "/tournaments/new" : "/login?next=/tournaments/new");

  // Scan localStorage for local copies
  const getLocalTournaments = useCallback((): StoredTournamentSummary[] => {
    const list: StoredTournamentSummary[] = [];

    // Always include the demo tournament
    list.push({
      id: "tourn-wudc-demo",
      slug: "wudc-demo",
      name: "World Universities Debating Championship (Demo)",
      format: "bp",
      createdAt: new Date().toISOString(),
    });

    if (typeof window === "undefined") return list;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("crabbytab_t_") && key.endsWith("_meta")) {
        try {
          const item = JSON.parse(localStorage.getItem(key) || "{}");
          if (item.slug && item.slug !== "wudc-demo") {
            list.push({
              id: item.id || `tourn-${item.slug}`,
              slug: item.slug,
              name: item.name || item.slug,
              format: item.format || "bp",
              createdAt: item.createdAt || new Date().toISOString(),
              ownerId: item.ownerId,
              ownerEmail: item.ownerEmail,
            });
          }
        } catch (e) {
          // ignore parsing error
        }
      }
    }

    return list;
  }, []);

  // Fetch from Firestore and combine with localStorage
  const loadTournaments = useCallback(async () => {
    setIsRefreshing(true);
    const localList = getLocalTournaments();
    const map = new Map<string, StoredTournamentSummary>();

    // Seed map with local tournaments
    localList.forEach((t) => map.set(t.slug, t));

    if (db) {
      try {
        const querySnapshot = await getDocs(collection(db, "tournaments"));
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const tSlug = data.slug || docSnap.id.replace(/^tourn-/, "");
          const isOwn = Boolean(
            user &&
              (data.ownerId === user.uid ||
                (user.email && data.ownerEmail === user.email) ||
                (data.admins && data.admins[user.uid]))
          );

          map.set(tSlug, {
            id: docSnap.id,
            slug: tSlug,
            name: data.name || tSlug,
            format: (data.format as TournamentFormat) || "bp",
            createdAt: data.createdAt || new Date().toISOString(),
            ownerId: data.ownerId,
            ownerEmail: data.ownerEmail,
            isOwner: isOwn,
          });

          // Sync into localStorage cache as well
          try {
            localStorage.setItem(
              `crabbytab_t_${tSlug}_meta`,
              JSON.stringify({ ...data, id: docSnap.id, slug: tSlug })
            );
          } catch (e) {
            // ignore
          }
        });
      } catch (err) {
        console.warn("Could not fetch tournaments from Firestore:", err);
      }
    }

    const merged = Array.from(map.values()).sort((a, b) => {
      // Demo tournament stays top or bottom, sort rest by date descending
      if (a.slug === "wudc-demo") return -1;
      if (b.slug === "wudc-demo") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    setTournaments(merged);
    setLoadingTournaments(false);
    setIsRefreshing(false);
  }, [getLocalTournaments, user]);

  // Initial load and real-time subscription
  useEffect(() => {
    loadTournaments();

    if (!db) return;

    // Set up real-time listener on tournaments collection
    const unsubscribe = onSnapshot(
      collection(db, "tournaments"),
      (snapshot) => {
        const localList = getLocalTournaments();
        const map = new Map<string, StoredTournamentSummary>();
        localList.forEach((t) => map.set(t.slug, t));

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const tSlug = data.slug || docSnap.id.replace(/^tourn-/, "");
          const isOwn = Boolean(
            user &&
              (data.ownerId === user.uid ||
                (user.email && data.ownerEmail === user.email) ||
                (data.admins && data.admins[user.uid]))
          );

          map.set(tSlug, {
            id: docSnap.id,
            slug: tSlug,
            name: data.name || tSlug,
            format: (data.format as TournamentFormat) || "bp",
            createdAt: data.createdAt || new Date().toISOString(),
            ownerId: data.ownerId,
            ownerEmail: data.ownerEmail,
            isOwner: isOwn,
          });
        });

        const merged = Array.from(map.values()).sort((a, b) => {
          if (a.slug === "wudc-demo") return -1;
          if (b.slug === "wudc-demo") return 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        setTournaments(merged);
        setLoadingTournaments(false);
      },
      (error) => {
        console.warn("Firestore onSnapshot error:", error);
      }
    );

    return () => unsubscribe();
  }, [loadTournaments, getLocalTournaments, user]);

  const handleDelete = async (t: StoredTournamentSummary) => {
    if (t.slug === "wudc-demo") {
      alert("The demo tournament cannot be deleted.");
      return;
    }

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

    // 2. Delete from Firestore if exists
    if (db && t.id) {
      try {
        await deleteDoc(doc(db, "tournaments", t.id));
      } catch (err) {
        console.warn("Firestore delete warning:", err);
      }
    }

    // Refresh list
    setTournaments((prev) => prev.filter((item) => item.slug !== t.slug));
  };

  const filteredTournaments = tournaments.filter((t) => {
    if (filterTab === "mine") {
      if (!user) return false;
      return (
        t.ownerId === user.uid ||
        (user.email && t.ownerEmail === user.email) ||
        t.isOwner === true
      );
    }
    return true;
  });

  const myTournamentsCount = user
    ? tournaments.filter(
        (t) =>
          t.ownerId === user.uid ||
          (user.email && t.ownerEmail === user.email) ||
          t.isOwner === true
      ).length
    : 0;

  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col">
      {/* Top Banner */}
      <header className="bg-[#24292e] text-white border-b border-[#1b1f23] py-4 px-6 shadow-xs sticky top-0 z-30">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center font-mono font-bold text-base shadow-sm">
              CT
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">CrabbyTab</h1>
              <p className="text-xs text-gray-400">Serverless Parliamentary Debate Tabulation System</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
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
                <button
                  onClick={goCreate}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold shadow-xs transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Tournament</span>
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="text-xs text-gray-300 hover:text-white px-2 py-1">
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold shadow-xs transition"
                >
                  <span>Create account</span>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8 flex-1 w-full space-y-6">
        {/* Welcome Card */}
        <div className="bg-white rounded-lg border border-[#d0d7de] p-6 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 mb-1">
                <h2 className="text-xl font-bold text-gray-900">
                  Welcome to CrabbyTab Debate Tabulation
                </h2>
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>Cloud Connected</span>
                </span>
              </div>
              <p className="text-sm text-gray-600 max-w-2xl">
                A serverless Tabbycat-style tab system: public draw and standings for participants, a staff tab room for directors,
                and real-time pairing with institutional clash detection.
              </p>
            </div>
            <div className="flex items-center space-x-3 shrink-0">
              {!user && !authLoading && (
                <Link
                  href="/login"
                  className="inline-flex items-center px-4 py-2.5 border border-gray-300 text-gray-800 rounded-md text-xs font-bold hover:bg-gray-50 transition"
                >
                  Sign in to tab room
                </Link>
              )}
              <Link
                href="/wudc-demo"
                className="inline-flex items-center space-x-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold shadow-xs transition"
              >
                <Sparkles className="w-4 h-4" />
                <span>Launch Demo Tournament</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
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
                  My Tournaments ({myTournamentsCount})
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => loadTournaments()}
              disabled={isRefreshing}
              className="inline-flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition disabled:opacity-50"
              title="Refresh tournaments from cloud"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-gray-500 ${isRefreshing ? "animate-spin text-blue-600" : ""}`} />
              <span>{isRefreshing ? "Syncing..." : "Sync Cloud"}</span>
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
              {filterTab === "mine" ? "No tournaments created by you yet" : "No tournaments available"}
            </h4>
            <p className="text-xs text-gray-500 max-w-sm mx-auto mb-4">
              {filterTab === "mine"
                ? "Create a new debate tournament or launch the demo tournament to get started."
                : "Create a tournament to begin tabulating debates."}
            </p>
            {user ? (
              <button
                onClick={goCreate}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold transition shadow-xs"
              >
                <Plus className="w-4 h-4" />
                <span>Create Tournament</span>
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold transition shadow-xs"
              >
                <span>Sign in to create tournament</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredTournaments.map((t) => {
              const isMine =
                Boolean(user && (t.ownerId === user.uid || (user.email && t.ownerEmail === user.email) || t.isOwner));
              const isDemo = t.slug === "wudc-demo";

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
                        {isDemo && (
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                            Demo
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
                      <Link
                        href={`/${t.slug}/public`}
                        className="text-xs font-semibold text-gray-600 hover:text-gray-900 flex items-center space-x-1"
                        title="View Public Tab"
                      >
                        <span>Public Tab</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>

                      {isMine && !isDemo && (
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
                      <span>Enter Tab Room</span>
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
        CrabbyTab — Serverless Tabbycat Clone &bull; Powered by Next.js 15 &bull; Realtime Cloud Firestore
      </footer>
    </div>
  );
}
