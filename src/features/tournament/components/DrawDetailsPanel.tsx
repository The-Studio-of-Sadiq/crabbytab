"use client";

import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { DebateSide } from "@/types";
import type { RoundSide, TeamDrawDetails } from "@/lib/draw/drawFlags";

/**
 * "Draw details": one row per team with its points, this round's room and opponents, sides by
 * round, previous opponents and pull-ups, for checking a draw before it is released.
 */

function sideText(side: RoundSide | null): string {
  if (side === null) return "—";
  if (side === "bye") return "Bye";
  if (side === "tbc") return "TBC";
  return side;
}

function sideTitle(side: RoundSide | null): string {
  if (side === null) return "Did not debate";
  if (side === "bye") return "Bye";
  if (side === "tbc") return "Side not recorded yet (chosen on the ballot)";
  return side;
}

export function DrawDetailsPanel({ rows, sides }: { rows: TeamDrawDetails[]; sides: readonly DebateSide[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return rows;
    return rows.filter((row) =>
      [row.teamName, row.institutionName ?? "", ...row.opponents.map((opponent) => opponent.teamName)]
        .some((value) => value.toLowerCase().includes(text))
    );
  }, [rows, query]);
  const roundLabels = rows[0]?.sidesByRound.map((entry) => entry.roundLabel) ?? [];

  return (
    <section aria-labelledby="draw-details-heading" className="space-y-2 rounded-lg border border-[#d0d7de] bg-white p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="draw-details-heading" className="text-sm font-bold text-gray-900">Draw details</h2>
        <label className="relative w-full max-w-xs">
          <span className="sr-only">Filter draw details by team, institution or opponent</span>
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter teams…"
            className="w-full rounded border border-gray-300 py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <caption className="sr-only">
            Each team&apos;s points, this round&apos;s placement, sides by round, previous opponents and pull-ups
          </caption>
          <thead>
            <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500">
              <th scope="col" className="py-1.5 pr-3 font-semibold">Team</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Pts</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">This round</th>
              {roundLabels.map((label) => (
                <th key={label} scope="col" className="py-1.5 pr-2 font-semibold">{label}</th>
              ))}
              <th scope="col" className="py-1.5 pr-3 font-semibold">Sides</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Previous opponents</th>
              <th scope="col" className="py-1.5 font-semibold">Pull-ups</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.teamId} className="border-b border-gray-100 align-top">
                <th scope="row" className="py-1.5 pr-3 font-semibold text-gray-900">
                  {row.teamName}
                  {row.isSwing && <span className="ml-1 rounded border border-gray-300 px-1 text-[10px] font-semibold text-gray-600">Swing</span>}
                  {row.institutionName && <div className="text-[11px] font-normal text-gray-500">{row.institutionName}</div>}
                </th>
                <td className="py-1.5 pr-3 tabular-nums">{row.points ?? "—"}</td>
                <td className="py-1.5 pr-3">
                  {row.current ? (
                    <>
                      <span className="font-semibold">{row.current.room}</span>{" "}
                      <span title={sideTitle(row.current.side)}>({sideText(row.current.side)})</span>
                      {row.current.opponents.length > 0 && <div className="text-gray-600">vs {row.current.opponents.join(", ")}</div>}
                      {row.current.pulledUp && <div className="font-semibold text-amber-800">Pulled up</div>}
                    </>
                  ) : (
                    <span className="font-semibold text-red-700">Not placed</span>
                  )}
                </td>
                {row.sidesByRound.map((entry) => (
                  <td key={entry.roundLabel} className="py-1.5 pr-2" title={`${entry.roundLabel}: ${sideTitle(entry.side)}`}>
                    {sideText(entry.side)}
                  </td>
                ))}
                <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                  {sides.map((side) => `${side} ${row.sideCounts[side] ?? 0}`).join(" · ")}
                </td>
                <td className="py-1.5 pr-3 text-gray-700">
                  {row.opponents.length === 0
                    ? "—"
                    : row.opponents.map((opponent) => `${opponent.teamName} (${opponent.rounds.join(", ")})`).join("; ")}
                </td>
                <td className="py-1.5 tabular-nums">{row.pullups}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="py-3 text-center text-xs text-gray-500">No teams match the filter.</p>}
      </div>
    </section>
  );
}
