"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Sparkles,
  ArrowRight,
  Layers,
} from "lucide-react";
import { TournamentFormat } from "@/types";
import { useAuth } from "@/contexts/AuthContext";

interface StoredTournamentSummary {
  slug: string;
  name: string;
  format: TournamentFormat;
  createdAt: string;
}

export default function HomePage() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [tournaments, setTournaments] = useState<StoredTournamentSummary[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [format, setFormat] = useState<TournamentFormat>("bp");

  useEffect(() => {
    // Scan localStorage for created tournaments
    const list: StoredTournamentSummary[] = [];

    // Always include the demo tournament
    list.push({
      slug: "wudc-demo",
      name: "World Universities Debating Championship (Demo)",
      format: "bp",
      createdAt: new Date().toISOString(),
    });

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("crabbytab_t_") && key.endsWith("_meta")) {
        try {
          const item = JSON.parse(localStorage.getItem(key) || "{}");
          if (item.slug && item.slug !== "wudc-demo") {
            list.push({
              slug: item.slug,
              name: item.name || item.slug,
              format: item.format || "bp",
              createdAt: item.createdAt || new Date().toISOString(),
            });
          }
        } catch (e) {
          // ignore
        }
      }
    }

    setTournaments(list);
  }, []);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      router.push("/login");
      return;
    }
    if (!name.trim() || !slug.trim()) return;

    const formattedSlug = slug
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, "-");

    router.push(`/${formattedSlug}`);
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9-]/g, "-")) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col">
      {/* Top Banner */}
      <header className="bg-[#24292e] text-white border-b border-[#1b1f23] py-4 px-6 shadow-xs">
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
            {loading ? null : user ? (
              <>
                <span className="hidden sm:inline text-xs text-gray-300">{user.email}</span>
                <button
                  onClick={() => logout()}
                  className="text-xs text-gray-300 hover:text-white"
                >
                  Sign out
                </button>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold shadow-xs transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Tournament</span>
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="text-xs text-gray-300 hover:text-white">
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
      <main className="max-w-6xl mx-auto px-6 py-8 flex-1 w-full">
        {/* Welcome Card */}
        <div className="bg-white rounded-lg border border-[#d0d7de] p-6 shadow-xs mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">
                Welcome to CrabbyTab Debate Tabulation
              </h2>
              <p className="text-sm text-gray-600 max-w-2xl">
                A serverless Tabbycat-style tab: public draw and standings for participants, a staff tab room for directors,
                and pairing/allocation computed on this machine — not on a Django server.
              </p>
            </div>
            <div className="flex items-center space-x-3 shrink-0">
              {!user && !loading && (
                <Link
                  href="/login"
                  className="inline-flex items-center px-4 py-2.5 border border-gray-300 text-gray-800 rounded-md text-xs font-bold"
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

        {/* Tournaments List Section */}
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center space-x-2">
            <Layers className="w-4 h-4 text-gray-600" />
            <span>Tournaments Hosted on this System</span>
          </h3>
          <span className="text-xs text-gray-500">{tournaments.length} tournament(s) available</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {tournaments.map((t) => (
            <div
              key={t.slug}
              className="bg-white rounded-lg border border-[#d0d7de] p-5 hover:border-blue-500 hover:shadow-md transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-800 uppercase tracking-wide">
                    {t.format === "bp" ? "British Parliamentary (BP)" : "UADC / 2-Team"}
                  </span>
                  <span className="text-xs text-gray-400 font-mono">/{t.slug}</span>
                </div>
                <h4 className="text-base font-bold text-gray-900 mb-1 line-clamp-2">{t.name}</h4>
                <p className="text-xs text-gray-500 mb-4">
                  Created {new Date(t.createdAt).toLocaleDateString()}
                </p>
              </div>

              <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                <Link
                  href={`/${t.slug}/public`}
                  className="text-xs font-medium text-gray-600 hover:text-gray-900"
                >
                  Public Tab
                </Link>
                <Link
                  href={`/${t.slug}`}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded text-xs transition"
                >
                  <span>Enter Tab Room</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-[#d0d7de] py-4 px-6 text-center text-xs text-gray-500">
        CrabbyTab — Serverless Tabbycat Clone &bull; Powered by Next.js 15 &bull; Realtime Cloud Firestore
      </footer>

      {/* Create Tournament Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-lg w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Plus className="w-5 h-5 text-blue-600" />
              <span>Create New Tournament</span>
            </h3>
            <form onSubmit={handleCreate} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Full Tournament Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Australasian Debating Championship 2026"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  URL Slug (Sub-directory)
                </label>
                <div className="flex items-center">
                  <span className="bg-gray-100 border border-r-0 border-gray-300 rounded-l px-3 py-2 text-xs text-gray-500 font-mono">
                    /
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="australs2026"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                    className="w-full border border-gray-300 rounded-r px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Tournament Format
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as TournamentFormat)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="bp">British Parliamentary (BP) — 4 teams, 2 speakers/team</option>
                  <option value="uadc">Asian Parliamentary (UADC) — 2 teams, 3 speakers + reply</option>
                  <option value="australs">Australs Format — 2 teams, 3 speakers + reply</option>
                  <option value="wsdc">World Schools (WSDC) — 2 teams, 3 speakers + reply</option>
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs"
                >
                  Launch Tournament
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
