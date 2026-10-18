"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { SideBadge } from "@/components/ui/SideBadge";
import { DebateSide, Motion } from "@/types";
import { Monitor, Lock, ChevronLeft, ChevronRight } from "lucide-react";
import {
  buildAlphabeticalDraw,
  buildMotionRevealSteps,
  motionsForDisplay,
  nextRevealStep,
} from "@/lib/display";
import { safeJsonParse } from "@/lib/safeJson";

type DisplayView = "rooms" | "teams" | "motions";

const VIEW_LABELS: Record<DisplayView, string> = {
  rooms: "Draw by room",
  teams: "Draw by team",
  motions: "Motion reveal",
};

export default function DisplayPage() {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;
  const { tournament, activeRound, debates, motions, isOwnerOrAdmin } = useTournament();
  const [scale, setScale] = useState(1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [view, setView] = useState<DisplayView>("rooms");
  const [revealIndex, setRevealIndex] = useState(0);
  const [staffMotions, setStaffMotions] = useState<Motion[] | null>(null);

  const isBP = tournament?.format === "bp";
  const prefs = tournament?.preferences;

  // Staff (server-verified tournament administrators, never a device-local owner id) may show the
  // draw and reveal motions before they are public. Shared pages load only the public projection,
  // so unreleased motions come from the administrator's own working copy on this device.
  useEffect(() => {
    if (!isOwnerOrAdmin || typeof window === "undefined") {
      setStaffMotions(null);
      return;
    }
    try {
      setStaffMotions(safeJsonParse<Motion[]>(localStorage.getItem(`crabbytab_t_${tournamentSlug}_motions`), []));
    } catch (error) {
      console.warn("Could not read local motions for the staff display:", error);
      setStaffMotions(null);
    }
  }, [isOwnerOrAdmin, tournamentSlug]);

  // For non-staff viewers, require publicDraw to be enabled AND the round draw to be released.
  const showDraw =
    isOwnerOrAdmin ||
    (prefs?.publicDraw !== false &&
      (activeRound?.drawStatus === "confirmed" || activeRound?.drawStatus === "released"));
  const showAdjudicators = isOwnerOrAdmin || activeRound?.adjudicatorsRevealed === true;
  const showMotions = isOwnerOrAdmin || prefs?.publicMotions !== false;

  const roundDebates = activeRound && showDraw ? debates.filter((d) => d.roundId === activeRound.id) : [];
  const roundMotions = showMotions
    ? motionsForDisplay(isOwnerOrAdmin && staffMotions ? staffMotions : motions, activeRound?.id, isOwnerOrAdmin)
    : [];
  const revealSteps = buildMotionRevealSteps(roundMotions);
  const revealStep = revealSteps[Math.min(revealIndex, revealSteps.length - 1)];
  const releasedHeaderMotion = roundMotions.find((motion) => motion.released === true);
  const alphabeticalRows = view === "teams" ? buildAlphabeticalDraw(roundDebates, isBP) : [];
  const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];

  useEffect(() => {
    setRevealIndex(0);
  }, [activeRound?.id, revealSteps.length]);

  useEffect(() => {
    if (view !== "motions") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "Escape") {
        setView("rooms");
        return;
      }
      setRevealIndex((current) => {
        const next = nextRevealStep(current, event.key, revealSteps.length);
        if (next !== current) event.preventDefault();
        return next;
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, revealSteps.length]);

  useEffect(() => {
    if (!autoScroll || view === "motions") return;
    let dir = 1;
    const id = window.setInterval(() => {
      const el = document.getElementById("display-scroll");
      if (!el) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) dir = -1;
      if (el.scrollTop <= 0) dir = 1;
      el.scrollBy({ top: 2 * dir });
    }, 40);
    return () => window.clearInterval(id);
  }, [autoScroll, view, roundDebates.length]);

  const drawHidden = (
    <div className="bg-[#22272e] border border-gray-700 rounded-lg p-10 text-center text-gray-400 flex flex-col items-center justify-center space-y-2">
      <Lock className="w-8 h-8 text-gray-500" aria-hidden="true" />
      <p className="font-semibold text-base">Public draw display is currently disabled.</p>
      <p className="text-xs text-gray-500">
        The tournament organizers have not released this round or public draw visibility is turned off.
      </p>
    </div>
  );

  return (
    <div className="min-h-screen text-white p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6">
        <div className="min-w-0">
          <div className="text-sm uppercase tracking-widest text-gray-400 flex items-center space-x-2">
            <Monitor className="w-4 h-4" aria-hidden="true" />
            <span>General assembly display</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold mt-1">
            {tournament?.name} — {activeRound?.name || "No round"}
          </h1>
          {view !== "motions" && releasedHeaderMotion && (
            <p className="text-lg text-gray-300 mt-2 italic">{releasedHeaderMotion.text}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Display view" className="flex rounded overflow-hidden border border-gray-600">
            {(Object.keys(VIEW_LABELS) as DisplayView[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                aria-pressed={view === item}
                className={`px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                  view === item ? "bg-blue-600 text-white" : "bg-gray-700 hover:bg-gray-600"
                }`}
              >
                {VIEW_LABELS[item]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.8, s - 0.1))}
            aria-label="Decrease text size"
            className="px-3 py-1 bg-gray-700 rounded text-sm hover:bg-gray-600"
          >
            A−
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(1.6, s + 0.1))}
            aria-label="Increase text size"
            className="px-3 py-1 bg-gray-700 rounded text-sm hover:bg-gray-600"
          >
            A+
          </button>
          {view !== "motions" && (
            <button
              type="button"
              onClick={() => setAutoScroll((v) => !v)}
              aria-pressed={autoScroll}
              className="px-3 py-1 bg-gray-700 rounded text-sm hover:bg-gray-600"
            >
              {autoScroll ? "Pause scroll" : "Auto-scroll"}
            </button>
          )}
        </div>
      </div>

      {view === "motions" ? (
        <section
          aria-label="Motion reveal"
          aria-live="polite"
          className="flex min-h-[calc(100vh-12rem)] flex-col rounded-lg border border-gray-700 bg-[#111820]"
          style={{ fontSize: `${scale}rem` }}
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center sm:px-14">
            {!showMotions ? (
              <p className="text-gray-400">Motions are not public for this tournament.</p>
            ) : roundMotions.length === 0 || !revealStep ? (
              <p className="text-gray-400">
                {isOwnerOrAdmin
                  ? "No motions are assigned to this round on this device."
                  : "No motions have been released for this round yet."}
              </p>
            ) : revealStep.kind === "cover" ? (
              <>
                <p className="text-sm font-bold uppercase tracking-widest text-amber-300">{activeRound?.name}</p>
                <p className="text-4xl font-bold sm:text-6xl">
                  {roundMotions.length === 1 ? "The motion" : `${roundMotions.length} motions`}
                </p>
                <p className="text-sm text-gray-400">Press → or Space to reveal.</p>
              </>
            ) : revealStep.kind === "info" ? (
              <div className="w-full max-w-4xl text-left">
                <p className="mb-3 text-sm font-bold uppercase text-amber-300">
                  Information slide{roundMotions.length > 1 ? ` · Motion ${revealStep.index + 1}` : ""}
                </p>
                <p className="whitespace-pre-line text-xl leading-relaxed text-gray-100 sm:text-2xl">
                  {revealStep.motion.infoSlide}
                </p>
              </div>
            ) : (
              <>
                {(roundMotions.length > 1 || revealStep.motion.reference) && (
                  <p className="text-sm font-bold uppercase text-amber-300">
                    {roundMotions.length > 1 ? `Motion ${revealStep.index + 1}` : ""}
                    {roundMotions.length > 1 && revealStep.motion.reference ? " · " : ""}
                    {revealStep.motion.reference}
                  </p>
                )}
                <p className="max-w-5xl text-3xl font-bold leading-tight sm:text-5xl">{revealStep.motion.text}</p>
              </>
            )}
            {isOwnerOrAdmin && revealStep && revealStep.kind !== "cover" && revealStep.motion.released !== true && (
              <p className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-200">
                Staff preview: this motion is not released publicly yet.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-white/15 px-5 py-3 text-sm">
            <button
              type="button"
              onClick={() => setRevealIndex((index) => nextRevealStep(index, "ArrowLeft", revealSteps.length))}
              disabled={revealIndex === 0}
              className="inline-flex items-center gap-1 rounded px-3 py-2 font-semibold text-gray-200 hover:bg-white/10 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back
            </button>
            <span className="text-gray-400">
              Step {Math.min(revealIndex, revealSteps.length - 1) + 1} of {revealSteps.length} · ← → to move, Esc to exit
            </span>
            <button
              type="button"
              onClick={() => setRevealIndex((index) => nextRevealStep(index, "ArrowRight", revealSteps.length))}
              disabled={revealIndex >= revealSteps.length - 1}
              className="inline-flex items-center gap-1 rounded px-3 py-2 font-semibold text-gray-200 hover:bg-white/10 disabled:opacity-40"
            >
              Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : (
        <div
          id="display-scroll"
          className="overflow-y-auto max-h-[calc(100vh-11rem)] pr-2"
          style={{ fontSize: `${scale}rem` }}
        >
          {!showDraw ? (
            drawHidden
          ) : roundDebates.length === 0 ? (
            <p className="text-gray-400">No draw for this round yet.</p>
          ) : view === "teams" ? (
            <div className="overflow-x-auto rounded-lg border border-gray-700">
              <table className="w-full text-left">
                <caption className="sr-only">Draw sorted by team name</caption>
                <thead className="bg-[#2d333b] text-sm uppercase text-gray-400">
                  <tr>
                    <th scope="col" className="px-4 py-2">Team</th>
                    <th scope="col" className="px-4 py-2">Side</th>
                    <th scope="col" className="px-4 py-2">Room</th>
                    <th scope="col" className="px-4 py-2">Against</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {alphabeticalRows.map((row) => (
                    <tr key={row.teamId} className="bg-[#22272e]">
                      <th scope="row" className="px-4 py-2 font-semibold">{row.teamName}</th>
                      <td className="px-4 py-2">{row.side ? <SideBadge side={row.side} /> : "Bye"}</td>
                      <td className="px-4 py-2 text-blue-300">{row.bye ? "—" : row.venueName || "TBA"}</td>
                      <td className="px-4 py-2 text-gray-300">{row.opponents.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-3">
              {roundDebates.map((debate) => {
                const byeTeam = debate.byeTeamId
                  ? Object.values(debate.teams).find((slot) => slot?.teamId === debate.byeTeamId)
                  : undefined;
                return (
                  <div key={debate.id} className="bg-[#2d333b] rounded-lg p-4 border border-gray-700">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
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
                      <div
                        className={`grid gap-3 grid-cols-1 sm:grid-cols-2 ${isBP ? "xl:grid-cols-4" : ""}`}
                      >
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
      )}
    </div>
  );
}
