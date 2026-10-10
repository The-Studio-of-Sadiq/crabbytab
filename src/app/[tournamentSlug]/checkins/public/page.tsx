"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface PublicRoundStatus {
  id: string;
  name: string;
  teamsPresent: number;
  teamsTotal: number;
  adjudicatorsPresent: number;
  adjudicatorsTotal: number;
}

interface PublicCheckInStatus {
  tournamentName: string;
  updatedAt: string;
  rounds: PublicRoundStatus[];
}

export default function PublicCheckinsPage() {
  const params = useParams<{ tournamentSlug: string }>();
  const [status, setStatus] = useState<PublicCheckInStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/public/tournaments/${encodeURIComponent(params.tournamentSlug)}/checkins`,
          { cache: "no-store" }
        );
        const result = await response.json() as PublicCheckInStatus & { error?: string };
        if (!response.ok) throw new Error(result.error || "Could not load public check-in status.");
        if (active) {
          setStatus(result);
          setError("");
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load public check-in status.");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [params.tournamentSlug]);

  if (error && !status) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-xl font-bold text-gray-900">Public check-in status</h1>
        <p role="alert" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>
        <Link href={`/${params.tournamentSlug}/public`} className="text-sm font-semibold text-blue-700 hover:underline">
          Back to public tournament page
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">{status?.tournamentName || "Tournament"} check-in status</h1>
        <p className="mt-1 text-sm text-gray-600">Counts refresh automatically every 30 seconds. Individual check-in details are private.</p>
      </header>
      {error && <p role="alert" className="text-sm text-amber-800">{error}</p>}
      {!status ? <p className="text-sm text-gray-600">Loading status…</p> : (
        <>
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="px-4 py-3">Round</th>
                  <th className="px-4 py-3">Teams present</th>
                  <th className="px-4 py-3">Adjudicators present</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {status.rounds.map((round) => (
                  <tr key={round.id}>
                    <th scope="row" className="px-4 py-3 font-semibold text-gray-900">{round.name}</th>
                    <td className="px-4 py-3">{round.teamsPresent} / {round.teamsTotal}</td>
                    <td className="px-4 py-3">{round.adjudicatorsPresent} / {round.adjudicatorsTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">Last updated {new Date(status.updatedAt).toLocaleTimeString()}.</p>
        </>
      )}
    </main>
  );
}
