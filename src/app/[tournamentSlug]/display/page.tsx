"use client";

import React, { useEffect, useState } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { SideBadge } from "@/components/ui/SideBadge";
import { DebateSide } from "@/types";
import { Monitor, Lock } from "lucide-react";

export default function DisplayPage() {
  const { tournament, activeRound, debates, motions, isOwnerOrAdmin } = useTournament();
  const [scale, setScale] = useState(1);
  const [autoScroll, setAutoScroll] = useState(true);

  const isBP = tournament?.format === "bp";
  const prefs = tournament?.preferences;

  // S1: Staff pages always show everything.
  // For non-staff (general display viewers), require publicDraw to be enabled AND round draw to be released.
  const showDraw = isOwnerOrAdmin || (prefs?.publicDraw !== false && activeRound?.drawStatus === "confirmed");
  const showAdjudicators = isOwnerOrAdmin || activeRound?.adjudicatorsRevealed === true;
  const showMotion = isOwnerOrAdmin || prefs?.publicMotions !== false;

  const roundDebates = activeRound && showDraw ? debates.filter((d) => d.roundId === activeRound.id) : [];
  const motion = activeRound && showMotion
    ? motions.find(
        (item) =>
          item.rounds?.includes(activeRound.id) &&
          (isOwnerOrAdmin || item.released === true)
      )
    : null;
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
            className="px-3 py-1 bg-gray-700 rounded text-sm hover:bg-gray-600"
          >
            A−
          </button>
          <button
            onClick={() => setScale((s) => Math.min(1.6, s + 0.1))}
            className="px-3 py-1 bg-gray-700 rounded text-sm hover:bg-gray-600"
          >
            A+
          </button>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className="px-3 py-1 bg-gray-700 rounded text-sm hover:bg-gray-600"
          >
            {autoScroll ? "Pause scroll" : "Auto-scroll"}
          </button>
        </div>
      </div>

      <div id="display-scroll" className="overflow-y-auto max-h-[calc(100vh-9rem)] pr-2" style={{ fontSize: `${scale}rem` }}>
        {!showDraw ? (
          <div className="bg-[#22272e] border border-gray-700 rounded-lg p-10 text-center text-gray-400 flex flex-col items-center justify-center space-y-2">
            <Lock className="w-8 h-8 text-gray-500" />
            <p className="font-semibold text-base">Public draw display is currently disabled.</p>
            <p className="text-xs text-gray-500">
              The tournament organizers have not released this round or public draw visibility is turned off.
            </p>
          </div>
        ) : roundDebates.length === 0 ? (
          <p className="text-gray-400">No draw for this round yet. Generate it from Availability → Draw.</p>
        ) : (
          <div className="space-y-3">
            {roundDebates.map((debate) => {
              const byeTeam = debate.byeTeamId
                ? Object.values(debate.teams).find((slot) => slot?.teamId === debate.byeTeamId)
                : undefined;
              return (
                <div key={debate.id} className="bg-[#2d333b] rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-blue-300">
                      {debate.byeTeamId ? "Bye" : debate.venueName || `Room ${debate.roomRank}`}
                    </span>
                    <span className="text-sm text-gray-400">
                      {debate.byeTeamId
                        ? "No adjudicator required"
                        : `Chair: ${showAdjudicators ? debate.adjudicators?.chairName || "TBA" : "TBA"}`}
                    </span>
                  </div>
                  {debate.byeTeamId ? (
                    <div className="bg-[#22272e] rounded p-4">
                      <div className="font-semibold">{byeTeam?.teamName || "Team"}</div>
                      <div className="mt-1 text-sm text-gray-400">
                        {debate.byeResult === "win" ? "Full win awarded" : "Absent — no standings result"}
                      </div>
                    </div>
                  ) : (
                    <div className={`grid gap-3 ${isBP ? "grid-cols-4" : "grid-cols-2"}`}>
                      {sides.map((side) => (
                        <div key={side} className="bg-[#22272e] rounded p-3">
                          <SideBadge side={side} />
                          <div className="mt-2 font-semibold">{debate.teams[side]?.teamName || "—"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {showAdjudicators && !debate.byeTeamId &&
                    ((debate.adjudicators?.panellistNames?.length || 0) > 0 ||
                      (debate.adjudicators?.traineeNames?.length || 0) > 0) && (
                    <div className="mt-3 space-y-1 text-sm text-gray-400">
                      {debate.adjudicators?.panellistNames?.length ? (
                        <p>Panellists: {debate.adjudicators.panellistNames.join(", ")}</p>
                      ) : null}
                      {debate.adjudicators?.traineeNames?.length ? (
                        <p>Trainees: {debate.adjudicators.traineeNames.join(", ")}</p>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
