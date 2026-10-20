"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { BallotSubmission, Debate, Motion, Tournament } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { SetupShell } from "@/components/setup/SetupShell";
import { getLocalStore, readLocalTournamentMetas, tournamentKeyPrefix } from "@/lib/offline/localStore";
import { safeJsonParse } from "@/lib/safeJson";
import {
  crossTournamentMotionStatistics,
  type TournamentMotionData,
} from "@/lib/motions/crossTournament";

type Meta = Pick<Tournament, "id" | "name" | "slug" | "format" | "ownerId">;

async function readDeviceMetas(): Promise<Meta[]> {
  const metas: Meta[] = [];
  for (const { raw } of await readLocalTournamentMetas(getLocalStore())) {
    const value = safeJsonParse<Partial<Tournament> | null>(raw, null);
    if (value?.id && value.slug && value.name && value.format) {
      metas.push({ id: value.id, slug: value.slug, name: value.name, format: value.format, ownerId: value.ownerId ?? "" });
    }
  }
  return metas;
}

async function readWorkingCopy(meta: Meta): Promise<TournamentMotionData> {
  const store = getLocalStore();
  const prefix = tournamentKeyPrefix(meta.slug);
  const [motions, debates, ballots] = await Promise.all([
    store.read(`${prefix}motions`),
    store.read(`${prefix}debates`),
    store.read(`${prefix}ballots`),
  ]);
  return {
    tournament: meta,
    motions: safeJsonParse<Motion[]>(motions, []),
    debates: safeJsonParse<Debate[]>(debates, []),
    ballots: safeJsonParse<BallotSubmission[]>(ballots, []),
  };
}

/**
 * Motion statistics across the tournaments you run, computed from their working copies on this
 * device: no cloud reads, and nothing from tournaments where you are not an administrator.
 */
export default function CrossTournamentMotionsPage() {
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<TournamentMotionData[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const metas = await readDeviceMetas();
        let adminIds = new Set<string>();
        const notOnDevice: string[] = [];
        if (user) {
          const token = await user.getIdToken();
          const response = await fetch("/api/tournaments", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
          const result = (await response.json()) as { error?: string; tournaments?: Array<{ id: string; name: string; accessRole?: string }> };
          if (!response.ok) throw new Error(result.error || "Could not check which tournaments you administer.");
          const administered = (result.tournaments || []).filter((item) => item.accessRole === "admin");
          adminIds = new Set(administered.map((item) => item.id));
          const local = new Set(metas.map((meta) => meta.id));
          notOnDevice.push(...administered.filter((item) => !local.has(item.id)).map((item) => item.name));
        }
        // Device-only tournaments (created signed out) belong to whoever runs this device.
        const allowed = metas.filter((meta) => adminIds.has(meta.id) || meta.ownerId === "local");
        const copies = await Promise.all(allowed.map(readWorkingCopy));
        if (!active) return;
        const withMotions = copies.filter((copy) => copy.motions.length > 0);
        setData(withMotions);
        setSelected(new Set(withMotions.map((copy) => copy.tournament.id)));
        setMissing(notOnDevice);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load your tournaments.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authLoading, user]);

  const statistics = useMemo(
    () => crossTournamentMotionStatistics(data.filter((copy) => selected.has(copy.tournament.id))),
    [data, selected]
  );

  return (
    <SetupShell maxWidth="max-w-5xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Motion statistics across tournaments</h1>
          <p className="mt-1 text-sm text-gray-600">
            Side results for motions set at the tournaments you administer, from the copies saved on this device.
            The same motion at two tournaments is matched by its text. BP and two-team results are kept apart.
          </p>
        </div>

        {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {loading && <p role="status" className="text-sm text-gray-600">Loading tournaments…</p>}

        {!loading && data.length === 0 && !error && (
          <p className="rounded border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600">
            No tournament you administer has motions on this device. Open a tournament to download it here first.
          </p>
        )}

        {data.length > 0 && (
          <fieldset className="rounded border border-gray-200 bg-white p-4">
            <legend className="px-1 text-sm font-semibold text-gray-800">Tournaments</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {data.map((copy) => (
                <label key={copy.tournament.id} className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={selected.has(copy.tournament.id)}
                    onChange={(event) => setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(copy.tournament.id);
                      else next.delete(copy.tournament.id);
                      return next;
                    })}
                    className="rounded border-gray-300"
                  />
                  {copy.tournament.name}
                  <span className="text-xs uppercase text-gray-500">{copy.tournament.format === "bp" ? "BP" : "Two-team"}</span>
                </label>
              ))}
            </div>
            {missing.length > 0 && (
              <p className="mt-3 text-xs text-gray-500">Not on this device: {missing.join(", ")}. Open them once to include them.</p>
            )}
          </fieldset>
        )}

        {statistics.length > 0 && (
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
                <tr>
                  <th scope="col" className="px-3 py-2">Motion</th>
                  <th scope="col" className="px-3 py-2">Tournaments</th>
                  <th scope="col" className="px-3 py-2 text-right">Debates</th>
                  <th scope="col" className="px-3 py-2">Wins by position</th>
                  <th scope="col" className="px-3 py-2 text-right">Vetoes</th>
                  <th scope="col" className="px-3 py-2 text-right">Balance p</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {statistics.map((statistic) => (
                  <tr key={statistic.key}>
                    <th scope="row" className="max-w-md px-3 py-2 text-left font-medium text-gray-900">{statistic.text}</th>
                    <td className="px-3 py-2 text-gray-700">
                      {statistic.tournaments.map((item) => `${item.name} (${item.debates})`).join(", ")}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{statistic.debatesCounted}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
                      {statistic.positionWins.map((item) => `${item.side} ${item.wins}`).join(" · ")}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{statistic.vetoes}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {statistic.balance.pValue === null ? "—" : statistic.balance.pValue.toFixed(3)}
                      {statistic.balance.lowExpectedCount && statistic.balance.pValue !== null && (
                        <span className="sr-only"> (few debates; treat with care)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Link href="/tournaments" className="inline-block text-sm font-semibold text-blue-700 hover:underline">Back to tournaments</Link>
      </div>
    </SetupShell>
  );
}
