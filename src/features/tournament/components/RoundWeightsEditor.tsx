"use client";

import React, { useState } from "react";
import type { Round } from "@/types";
import { roundWeight } from "@/lib/ballots/ballotRules";

/**
 * Tabbycat's Round.weight: team points earned in a preliminary round count this many times in the
 * team standings (wins, speaks and who-beat-whom are not weighted).
 */
export function RoundWeightsEditor({
  rounds,
  updateRound,
}: {
  rounds: Round[];
  updateRound: (round: Round) => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  const preliminary = rounds.filter((round) => round.stage === "preliminary").sort((a, b) => a.seq - b.seq);
  if (preliminary.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-700">Points weight by round</h4>
      <p className="text-[11px] text-gray-500 mt-1">
        Team points earned in a round are multiplied by its weight (default 1; e.g. 2 doubles them).
      </p>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
        {preliminary.map((round) => (
          <label key={round.id} className="flex items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2 text-xs">
            <span>{round.name}</span>
            <input
              type="number"
              min={0}
              step={1}
              aria-label={`Points weight for ${round.name}`}
              value={roundWeight(round)}
              onChange={(event) => {
                const weight = Number(event.target.value);
                if (!Number.isInteger(weight) || weight < 0) {
                  setError("A round weight must be a whole number of 0 or more.");
                  return;
                }
                setError("");
                void updateRound({ ...round, weight }).catch(() => setError(`Could not update the weight of ${round.name}.`));
              }}
              className="w-16 border border-gray-300 rounded px-2 py-1 text-center font-mono font-bold"
            />
          </label>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
