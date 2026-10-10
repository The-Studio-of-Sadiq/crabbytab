"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Plus, Search } from "lucide-react";
import {
  FieldPath,
  collection,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  where,
} from "firebase/firestore";
import type { Tournament } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { getFormatPreset } from "@/lib/setup/presets";
import { SetupShell } from "@/components/setup/SetupShell";

type Summary = Pick<Tournament, "id" | "name" | "slug" | "format" | "createdAt"> & {
  accessRole?: "admin" | "dataEntry";
};

function toSummary(id: string, data: Record<string, any>): Summary {
  const slug: string = data.slug || id.replace(/^tourn-/, "");
  return {
    id,
    slug,
    name: data.name || slug,
    format: data.format || "bp",
    createdAt: data.createdAt || "",
  };
}

function mergeById(lists: Summary[][]): Summary[] {
  const map = new Map<string, Summary>();
  lists.flat().forEach((t) => map.set(t.id, t));
  return Array.from(map.values());
}

function TournamentRow({ t }: { t: Summary }) {
  const isMine = t.accessRole === "admin";
  return (
    <li>
      <Link
        href={`/${t.slug}`}
        className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{t.name}</p>
          <p className="text-xs text-gray-500">
            <span className="font-mono">/{t.slug}</span> · {getFormatPreset(t.format).label}
          </p>
        </div>
        <div className="flex items-center space-x-3 shrink-0">
          {isMine && (
            <span className="text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
              Admin
            </span>
          )}
          <ArrowRight className="w-4 h-4 text-gray-400" />
        </div>
      </Link>
    </li>
  );
}

export default function TournamentsHubPage() {
  const { user, configured, isGlobalAdmin, loading: authLoading } = useAuth();

  const [mine, setMine] = useState<Summary[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);
  const [mineError, setMineError] = useState("");

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Summary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchSeq = useRef(0);

  // Signed-in users only receive their authorized tournaments from the server.
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    setMine([]);
    setMineError("");
    setLoadingMine(true);
    void (async () => {
      if (!user) {
        if (typeof window !== "undefined") {
          const local: Summary[] = [];
          for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (!key?.startsWith("crabbytab_t_") || !key.endsWith("_meta")) continue;
            try {
              const value = JSON.parse(localStorage.getItem(key) || "null") as Partial<Tournament> | null;
              if (value?.id && value.slug && value.name && value.format && value.createdAt) {
                local.push({
                  id: value.id,
                  slug: value.slug,
                  name: value.name,
                  format: value.format,
                  createdAt: value.createdAt,
                });
              }
            } catch (error) {
              console.warn(`Could not read local tournament at ${key}:`, error);
            }
          }
          if (active) setMine(local.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        }
        if (active) setLoadingMine(false);
        return;
      }

      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/tournaments", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json() as { error?: string; tournaments?: Summary[] };
        if (!response.ok) throw new Error(result.error || "Could not load your tournaments.");
        const accessible = result.tournaments || [];
        const merged = new Map(accessible.map((tournament) => [tournament.id, tournament]));
        if (typeof window !== "undefined") {
          for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (!key?.startsWith("crabbytab_t_") || !key.endsWith("_meta")) continue;
            try {
              const value = JSON.parse(localStorage.getItem(key) || "null") as Partial<Tournament> | null;
              if (
                value?.id && value.slug && value.name && value.format && value.createdAt &&
                isGlobalAdmin &&
                !merged.has(value.id)
              ) {
                merged.set(value.id, {
                  id: value.id,
                  slug: value.slug,
                  name: value.name,
                  format: value.format,
                  createdAt: value.createdAt,
                });
              }
            } catch (error) {
              console.warn(`Could not read local tournament at ${key}:`, error);
            }
          }
        }
        if (active) setMine([...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      } catch (error) {
        if (active) setMineError(error instanceof Error ? error.message : "Could not load your tournaments.");
      } finally {
        if (active) setLoadingMine(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authLoading, isGlobalAdmin, user]);

  // Search: prefix match on slug and on the lowercase name, debounced.
  useEffect(() => {
    const q = term.trim().toLowerCase();
    if (!q || (user && !isGlobalAdmin)) {
      setResults(null);
      setSearchError("");
      setSearching(false);
      return;
    }
    if (!db) return;

    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const col = collection(db!, "tournaments");
        const byField = (field: string) =>
          getDocs(query(col, orderBy(field), startAt(q), endAt(q + "\uf8ff"), limit(20)));
        const [bySlug, byName] = await Promise.all([byField("slug"), byField("nameLower")]);
        if (seq !== searchSeq.current) return; // a newer search superseded this one
        setResults(
          mergeById([
            bySlug.docs.map((d) => toSummary(d.id, d.data())),
            byName.docs.map((d) => toSummary(d.id, d.data())),
          ])
        );
        setSearchError("");
      } catch (e) {
        console.warn("Search failed:", e);
        if (seq === searchSeq.current) setSearchError("Search failed. Check your connection and try again.");
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [term, user, isGlobalAdmin]);

  return (
    <SetupShell>
      <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              {user?.displayName ? `Welcome, ${user.displayName}` : "Welcome"}
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Open an existing tournament or set up a new one.
            </p>
          </div>

          {/* Create */}
          {isGlobalAdmin && <Link
            href="/tournaments/new"
            className="flex items-center justify-between bg-white border border-[#d0d7de] rounded-lg shadow-xs p-5 hover:border-blue-500 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded bg-blue-600 text-white flex items-center justify-center">
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Create a new tournament</p>
                <p className="text-xs text-gray-600">
                  A guided setup for the format, scoring, rounds and breaks.
                </p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400" />
          </Link>}

          {/* Search */}
          {(!user || isGlobalAdmin) && <section>
            <h2 className="text-sm font-bold text-gray-900 mb-2">Find an existing tournament</h2>
            {!configured || !db ? (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">
                Firebase isn&apos;t configured, so there&apos;s nothing to search. Copy{" "}
                <code className="font-mono">.env.example</code> to <code className="font-mono">.env.local</code> and
                fill in your Firebase keys.
              </p>
            ) : (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    placeholder="Search by tournament name or URL slug"
                    className="w-full border border-gray-300 rounded pl-9 pr-9 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {searching && (
                    <Loader2 className="w-4 h-4 text-gray-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                </div>
                <p className="text-[11px] text-gray-500 mt-1">Matches the start of the name or slug.</p>

                {searchError && <p className="text-xs text-red-700 mt-2">{searchError}</p>}

                {results && (
                  <div className="mt-3 bg-white border border-[#d0d7de] rounded-lg shadow-xs">
                    {results.length === 0 && !searching ? (
                      <p className="px-4 py-6 text-sm text-gray-500 text-center">
                        No tournaments start with &ldquo;{term.trim()}&rdquo;.
                      </p>
                    ) : (
                      <ul className="divide-y divide-[#eaeef2]">
                        {results.map((t) => (
                          <TournamentRow key={t.id} t={t} />
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </section>}

          {/* Mine */}
          {(
            <section>
              <h2 className="text-sm font-bold text-gray-900 mb-2">
                {user ? "Your assigned tournaments" : "Tournaments on this device"}
              </h2>
              {mineError && (
                <p role="alert" className="mb-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  {mineError}
                </p>
              )}
              <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs">
                {loadingMine ? (
                  <p className="px-4 py-6 text-sm text-gray-500 text-center">Loading...</p>
                ) : mine.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-gray-500 text-center">
                    {user
                      ? "No tournaments are assigned to your account."
                      : "There are no tournaments saved on this device."}
                  </p>
                ) : (
                  <ul className="divide-y divide-[#eaeef2]">
                    {mine.map((t) => (
                      <TournamentRow key={t.id} t={t} />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
      </div>
    </SetupShell>
  );
}
