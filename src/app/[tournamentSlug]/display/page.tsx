"use client";

import React, { useEffect, useState } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { SideBadge } from "@/components/ui/SideBadge";
import { DebateSide } from "@/types";
import { Monitor } from "lucide-react";

export default function DisplayPage() {
  const { tournament, activeRound, debates, motions } = useTournament();
  const [scale, setScale] = useState(1);
  const [autoScroll, setAutoScroll] = useState(true);

  const isBP = tournament?.format === "bp";
  const roundDebates = activeRound ? debates.filter((d) => d.roundId === activeRound.id) : [];
  const motion = activeRound ? motions.find((m) => m.rounds && m.rounds.includes(activeRound.id)) : null;
  const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];

  useEffect(() => {
    if (!autoScroll) return;
    let dir = 1;
    const id = window.setInterval(() => {
      const el = document.getElementById("display-scroll");
      if (!el) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) dir = -1;
      if (el.scrollTop <= 0) dir = 1;
      el.scrollBy({ top: 2 * dir });
    }, 40);
    return () => window.clearInterval(id);
  }, [autoScroll, roundDebates.length]);

  return (
    <div className="min-h-screen text-white p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm uppercase tracking-widest text-gray-400 flex items-center space-x-2">
            <Monitor className="w-4 h-4" />
            <span>General assembly display</span>
          </div>
          <h1 className="text-3xl font-bold mt-1">
            {tournament?.name} — {activeRound?.name || "No round"}
          </h1>
          {motion && <p className="text-lg text-gray-300 mt-2 italic">{motion.text}</p>}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setScale((s) => Math.max(0.8, s - 0.1))}
            className="px-3 py-1 bg-gray-700 rounded text-sm"
          >
            A−
          </button>
          <button
            onClick={() => setScale((s) => Math.min(1.6, s + 0.1))}
            className="px-3 py-1 bg-gray-700 rounded text-sm"
          >
            A+
          </button>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className="px-3 py-1 bg-gray-700 rounded text-sm"
          >
            {autoScroll ? "Pause scroll" : "Auto-scroll"}
          </button>
        </div>
      </div>

      <div id="display-scroll" className="overflow-y-auto max-h-[calc(100vh-9rem)] pr-2" style={{ fontSize: `${scale}rem` }}>
        {roundDebates.length === 0 ? (
          <p className="text-gray-400">No draw for this round yet. Generate it from Availability → Draw.</p>
        ) : (
          <div className="space-y-3">
            {roundDebates.map((debate) => (
              <div key={debate.id} className="bg-[#2d333b] rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-blue-300">{debate.venueName || `Room ${debate.roomRank}`}</span>
                  <span className="text-sm text-gray-400">
                    Chair: {debate.adjudicators?.chairName || "TBA"}
                  </span>
                </div>
                <div className={`grid gap-3 ${isBP ? "grid-cols-4" : "grid-cols-2"}`}>
                  {sides.map((side) => (
                    <div key={side} className="bg-[#22272e] rounded p-3">
                      <SideBadge side={side} />
                      <div className="mt-2 font-semibold">{debate.teams[side]?.teamName || "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
