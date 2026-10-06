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

type Summary = Pick<Tournament, "id" | "name" | "slug" | "format" | "createdAt" | "ownerId" | "admins">;

function toSummary(id: string, data: Record<string, any>): Summary {
  const slug: string = data.slug || id.replace(/^tourn-/, "");
  return {
    id,
    slug,
    name: data.name || slug,
    format: data.format || "bp",
    createdAt: data.createdAt || "",
    ownerId: data.ownerId || "",
    admins: data.admins || {},
  };
}

function mergeById(lists: Summary[][]): Summary[] {
  const map = new Map<string, Summary>();
  lists.flat().forEach((t) => map.set(t.id, t));
  return Array.from(map.values());
}

function TournamentRow({ t, uid }: { t: Summary; uid?: string }) {
  const isMine = Boolean(uid && (t.ownerId === uid || t.admins[uid]));
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
              {t.ownerId === uid ? "Owner" : "Admin"}
            </span>
          )}
          <ArrowRight className="w-4 h-4 text-gray-400" />
        </div>
      </Link>
    </li>
  );
}

export default function TournamentsHubPage() {
  const { user, configured } = useAuth();

  const [mine, setMine] = useState<Summary[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Summary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchSeq = useRef(0);

  // The local tournament list is available without sign-in or a network connection.
  useEffect(() => {
    if (typeof window === "undefined") {
      setLoadingMine(false);
      return;
    }
    const list: Summary[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith("crabbytab_t_") || !key.endsWith("_meta")) continue;
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null") as Partial<Tournament> | null;
        if (value?.id && value.slug && value.name && value.format && value.createdAt) {
          list.push({
            id: value.id,
            slug: value.slug,
            name: value.name,
            format: value.format,
            createdAt: value.createdAt,
            ownerId: value.ownerId || "director",
            admins: value.admins || {},
          });
        }
      } catch (error) {
        console.warn(`Could not read local tournament at ${key}:`, error);
      }
    }
    setMine(list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setLoadingMine(false);
  }, []);

  // Search: prefix match on slug and on the lowercase name, debounced.
  useEffect(() => {
    const q = term.trim().toLowerCase();
    if (!q) {
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
  }, [term]);

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
          <Link
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
          </Link>

          {/* Search */}
          <section>
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
                          <TournamentRow key={t.id} t={t} uid={user?.uid} />
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Mine */}
          {(
            <section>
              <h2 className="text-sm font-bold text-gray-900 mb-2">Tournaments on this device</h2>
              <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs">
                {loadingMine ? (
                  <p className="px-4 py-6 text-sm text-gray-500 text-center">Loading...</p>
                ) : mine.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-gray-500 text-center">
                    You don&apos;t own or administer any tournaments yet.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#eaeef2]">
                    {mine.map((t) => (
                      <TournamentRow key={t.id} t={t} uid={user?.uid} />
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
