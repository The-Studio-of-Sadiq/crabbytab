"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { SideBadge } from "@/components/ui/SideBadge";
import {
  Trophy,
  Shuffle,
  Lightbulb,
  Award,
  ArrowLeft,
  MapPin,
  Search,
  Sparkles,
  ExternalLink,
  FileCheck2,
  Lock,
  Presentation,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { DebateSide } from "@/types";
import { calculateStandings } from "@/lib/standings/calculator";
import { calculateBreaks } from "@/lib/breakqual/calculator";

export default function PublicTournamentPage() {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;

  const {
    tournament,
    activeRound,
    rounds,
    setActiveRound,
    debates,
    ballots,
    teams,
    motions,
    breakCategories,
  } = useTournament();

  const isBP = tournament?.format === "bp";
  const prefs = tournament?.preferences;

  // S1: Public toggles
  const showPublicDraw = prefs?.publicDraw !== false;
  const showPublicResults = prefs?.publicResults !== false;
  const showPublicStandings = prefs?.publicStandings !== false;
  const showPublicMotions = prefs?.publicMotions !== false;

  // Available tabs based on preferences
  const availableTabs: ("draw" | "results" | "standings" | "motions" | "break")[] = [];
  if (showPublicDraw) availableTabs.push("draw");
  if (showPublicResults) availableTabs.push("results");
  if (showPublicStandings) availableTabs.push("standings");
  if (showPublicMotions) availableTabs.push("motions");
  availableTabs.push("break"); // Break is always an available public tab

  const [activeTab, setActiveTab] = useState<"draw" | "results" | "standings" | "motions" | "break">(
    availableTabs[0] || "draw"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isMotionPresentation, setIsMotionPresentation] = useState(false);
  const [motionSlideIndex, setMotionSlideIndex] = useState(0);

  // Only released debates/rounds
  const releasedDebates = activeRound
    ? debates.filter((d) => d.roundId === activeRound.id && activeRound.drawStatus === "confirmed")
    : [];

  const roundResultsReleased = Boolean(activeRound?.resultsReleased && !activeRound.silent);

  const releasedMotions = motions
    .filter((motion) => motion.released !== false)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  const publicRoundIds = new Set(
    rounds.filter((round) => round.resultsReleased && !round.silent).map((round) => round.id)
  );
  const publicBallots = ballots.filter(
    (ballot) => ballot.confirmed && !ballot.discarded && publicRoundIds.has(ballot.roundId)
  );
  const publicDebates = debates.filter((debate) => publicRoundIds.has(debate.roundId));
  const publicStandings = tournament
    ? calculateStandings(tournament, rounds.filter((round) => publicRoundIds.has(round.id)), teams, publicDebates, publicBallots)
    : { teams: [], speakers: [], replies: [] };
  const publicBreakResults = calculateBreaks(breakCategories, teams, publicStandings.teams);

  const ballotMap = new Map<string, any>();
  publicBallots.forEach((ballot) => ballotMap.set(ballot.debateId, ballot));

  useEffect(() => {
    setMotionSlideIndex((index) => Math.min(index, Math.max(0, releasedMotions.length - 1)));
  }, [releasedMotions.length]);

  useEffect(() => {
    if (!isMotionPresentation) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMotionPresentation(false);
      if (event.key === "ArrowRight") {
        setMotionSlideIndex((index) => Math.min(index + 1, releasedMotions.length - 1));
      }
      if (event.key === "ArrowLeft") setMotionSlideIndex((index) => Math.max(index - 1, 0));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMotionPresentation, releasedMotions.length]);

  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col">
      {/* Public Header */}
      <header className="bg-[#24292e] text-white border-b border-[#1b1f23] py-4 px-6 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link
              href="/"
              className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center font-mono font-bold text-sm text-white"
            >
              CT
            </Link>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight">
                {tournament?.name || "Debate Tournament Tab"}
              </h1>
              <span className="text-[11px] text-gray-400">
                Official Public Tab &bull; {isBP ? "British Parliamentary" : "2-Team Asian/Australs"}
              </span>
            </div>
          </div>

          <Link
            href={`/${tournamentSlug}`}
            className="inline-flex items-center space-x-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold transition shadow-xs"
          >
            <span>Admin Tab Room</span>
            <ExternalLink className="w-3 h-3 ml-1" />
          </Link>
        </div>
      </header>

      {/* Navigation Pills (S1: hide matching sections if toggle is off) */}
      <div className="bg-white border-b border-[#d0d7de] sticky top-14 z-40">
        <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center space-x-2 overflow-x-auto">
          {showPublicDraw && (
            <button
              onClick={() => setActiveTab("draw")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
                activeTab === "draw"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>Draw</span>
            </button>
          )}

          {showPublicResults && (
            <button
              onClick={() => setActiveTab("results")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
                activeTab === "results"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>Results & Scores</span>
            </button>
          )}

          {showPublicStandings && (
            <button
              onClick={() => setActiveTab("standings")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
                activeTab === "standings"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>Standings Tab</span>
            </button>
          )}

          {showPublicMotions && (
            <button
              onClick={() => setActiveTab("motions")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
                activeTab === "motions"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span>Motions ({releasedMotions.length})</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab("break")}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center space-x-1.5 ${
              activeTab === "break"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Break</span>
          </button>
        </div>
      </div>

      {/* Main Public Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full space-y-6">
        {/* 1. Draw View */}
        {showPublicDraw && activeTab === "draw" && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 overflow-x-auto pb-1">
              <span className="text-xs font-bold text-gray-500 uppercase mr-1">Round:</span>
              {rounds.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setActiveRound(r)}
                  className={`px-3 py-1 text-xs font-bold rounded border ${
                    activeRound?.id === r.id
                      ? "bg-blue-600 text-white border-blue-700"
                      : "bg-white text-gray-700 border-gray-300"
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>

            {releasedDebates.length === 0 ? (
              <div className="bg-white border border-[#d0d7de] rounded-lg p-10 text-center text-gray-500 text-xs">
                The draw for {activeRound?.name || "this round"} has not been released to the public yet.
              </div>
            ) : (
              <div className="space-y-3">
                {releasedDebates.map((d, idx) => (
                  <div key={d.id} className="bg-white border border-[#d0d7de] rounded-lg p-4 shadow-2xs">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-3">
                      <span className="font-bold text-xs text-gray-900 flex items-center space-x-1">
                        <MapPin className="w-3.5 h-3.5 text-blue-600" />
                        <span>{d.venueName || `Room ${idx + 1}`}</span>
                      </span>
                      <span className="text-xs text-gray-600 font-medium">
                        Chair: <strong className="text-gray-900">{d.adjudicators?.chairName || "TBD"}</strong>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                      {isBP ? (
                        <>
                          <div className="p-2 bg-rose-50/60 rounded border border-rose-200 font-bold text-gray-900">
                            <span className="text-[10px] text-rose-700 block uppercase">OG</span>
                            {d.teams?.OG?.teamName || "—"}
                          </div>
                          <div className="p-2 bg-sky-50/60 rounded border border-sky-200 font-bold text-gray-900">
                            <span className="text-[10px] text-sky-700 block uppercase">OO</span>
                            {d.teams?.OO?.teamName || "—"}
                          </div>
                          <div className="p-2 bg-amber-50/60 rounded border border-amber-200 font-bold text-gray-900">
                            <span className="text-[10px] text-amber-700 block uppercase">CG</span>
                            {d.teams?.CG?.teamName || "—"}
                          </div>
                          <div className="p-2 bg-purple-50/60 rounded border border-purple-200 font-bold text-gray-900">
                            <span className="text-[10px] text-purple-700 block uppercase">CO</span>
                            {d.teams?.CO?.teamName || "—"}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="p-2.5 bg-emerald-50/60 rounded border border-emerald-200 font-bold text-gray-900 sm:col-span-2">
                            <span className="text-[10px] text-emerald-700 block uppercase">Affirmative</span>
                            {d.teams?.AFF?.teamName || "—"}
                          </div>
                          <div className="p-2.5 bg-slate-50 rounded border border-slate-200 font-bold text-gray-900 sm:col-span-2">
                            <span className="text-[10px] text-slate-700 block uppercase">Negative</span>
                            {d.teams?.NEG?.teamName || "—"}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 2. Results & Scores View (S1: publicResults) */}
        {showPublicResults && activeTab === "results" && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2 overflow-x-auto pb-1">
              <span className="text-xs font-bold text-gray-500 uppercase mr-1">Round:</span>
              {rounds.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setActiveRound(r)}
                  className={`px-3 py-1 text-xs font-bold rounded border ${
                    activeRound?.id === r.id
                      ? "bg-blue-600 text-white border-blue-700"
                      : "bg-white text-gray-700 border-gray-300"
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>

            {activeRound?.silent ? (
              <div className="bg-white border border-amber-300 rounded-lg p-10 text-center text-amber-900 text-xs">
                Results for {activeRound.name} are withheld because this is a silent round.
              </div>
            ) : !roundResultsReleased || releasedDebates.length === 0 ? (
              <div className="bg-white border border-[#d0d7de] rounded-lg p-10 text-center text-gray-500 text-xs">
                Results for {activeRound?.name || "this round"} have not been released to the public yet.
              </div>
            ) : (
              <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
                <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">
                  {activeRound?.name} Official Confirmed Results
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left tabby-table">
                    <thead>
                      <tr>
                        <th>Venue</th>
                        {isBP ? (
                          <>
                            <th>Opening Gov (1st/2nd/3rd/4th)</th>
                            <th>Opening Opp</th>
                            <th>Closing Gov</th>
                            <th>Closing Opp</th>
                          </>
                        ) : (
                          <>
                            <th>Affirmative</th>
                            <th>Negative</th>
                          </>
                        )}
                        <th className="text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {releasedDebates.map((d) => {
                        const ballot = ballotMap.get(d.id);
                        return (
                          <tr key={d.id} className="hover:bg-gray-50">
                            <td className="font-bold text-xs text-gray-900">{d.venueName}</td>
                            {isBP ? (
                              (["OG", "OO", "CG", "CO"] as DebateSide[]).map((side) => {
                                const tSlot = d.teams[side];
                                const tScore = ballot?.teamScores?.[side];
                                return (
                                  <td key={side} className="text-xs">
                                    <div className="font-semibold text-gray-900">
                                      {tSlot?.teamName || "—"}
                                    </div>
                                    {tScore && (
                                      <div className="text-[11px] text-gray-500 font-mono">
                                        Rank {tScore.rank} &bull; {tScore.points} pts &bull;{" "}
                                        {tScore.totalSpeakerScore} spks
                                      </div>
                                    )}
                                  </td>
                                );
                              })
                            ) : (
                              (["AFF", "NEG"] as DebateSide[]).map((side) => {
                                const tSlot = d.teams[side];
                                const tScore = ballot?.teamScores?.[side];
                                return (
                                  <td key={side} className="text-xs">
                                    <div className="font-semibold text-gray-900">
                                      {tSlot?.teamName || "—"}
                                    </div>
                                    {tScore && (
                                      <div className="text-[11px] text-gray-500 font-mono">
                                        {tScore.win ? "WIN" : "LOSS"} &bull; {tScore.totalSpeakerScore} spks
                                      </div>
                                    )}
                                  </td>
                                );
                              })
                            )}
                            <td className="text-center">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  ballot?.confirmed
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-gray-100 text-gray-600"
                                }`}
                              >
                                {ballot?.confirmed ? "Confirmed" : "Pending"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. Standings View (S1: publicStandings) */}
        {showPublicStandings && activeTab === "standings" && (
          <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
            <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">
              Team Standings Tab
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left tabby-table">
                <thead>
                  <tr>
                    <th className="w-12 text-center">#</th>
                    <th>Team</th>
                    <th>Institution</th>
                    <th className="text-right">Points</th>
                    <th className="text-right">Total Speaks</th>
                    <th className="text-right">Avg Speaks</th>
                  </tr>
                </thead>
                <tbody>
                  {publicStandings.teams.map((t) => (
                    <tr key={t.teamId} className="hover:bg-gray-50">
                      <td className="text-center font-mono font-bold text-xs">{t.rank}</td>
                      <td className="font-bold text-gray-900 text-xs">{t.teamName}</td>
                      <td className="text-xs text-gray-600">{t.institutionCode || "—"}</td>
                      <td className="text-right font-mono font-bold text-sm text-blue-600">{t.points}</td>
                      <td className="text-right font-mono font-semibold text-xs text-gray-800">
                        {t.totalSpeakerScore.toFixed(1)}
                      </td>
                      <td className="text-right font-mono text-xs text-gray-600">
                        {t.averageSpeakerScore.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. Motions View (S1: publicMotions) */}
        {showPublicMotions && activeTab === "motions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-gray-900">Released Motions</h2>
              <button
                type="button"
                onClick={() => setIsMotionPresentation(true)}
                disabled={releasedMotions.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-black text-white rounded text-xs font-semibold disabled:opacity-50"
              >
                <Presentation className="w-3.5 h-3.5" />
                Present Motions
              </button>
            </div>
            {releasedMotions.length === 0 ? (
              <div className="bg-white border border-[#d0d7de] rounded-lg p-10 text-center text-gray-500 text-xs">
                No motions have been released to the public yet.
              </div>
            ) : (
              releasedMotions.map((m) => (
                <div key={m.id} className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-2xs">
                  <span className="text-xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                    {m.reference || "Motion"}
                  </span>
                  <blockquote className="text-base font-bold text-gray-900 my-2.5 pl-3 border-l-4 border-amber-500">
                    &ldquo;{m.text}&rdquo;
                  </blockquote>
                  {m.infoSlide && (
                    <div className="mt-2 p-3 bg-amber-50/50 rounded border border-amber-200 text-xs text-amber-950">
                      <strong className="block text-[10px] uppercase font-bold text-amber-800">
                        Infoslide:
                      </strong>
                      <p>{m.infoSlide}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* 5. Break View */}
        {activeTab === "break" && (
          <div className="space-y-6">
            {publicBreakResults.map((res) => (
              <div
                key={res.category.id}
                className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden"
              >
                <div className="p-3 bg-purple-50 border-b border-purple-200 font-bold text-xs text-purple-900">
                  {res.category.name} Breaking Teams (Top {res.category.breakSize})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left tabby-table">
                    <thead>
                      <tr>
                        <th className="w-16 text-center">Seed</th>
                        <th>Team</th>
                        <th>Institution</th>
                        <th className="text-right">Points</th>
                        <th className="text-right">Total Speaks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.breakingTeams.map((b) => (
                        <tr key={b.team.id} className="hover:bg-purple-50/30">
                          <td className="text-center font-mono font-bold text-xs text-purple-700">
                            {b.seed}
                          </td>
                          <td className="font-bold text-gray-900 text-xs">{b.team.name}</td>
                          <td className="text-xs text-gray-600">{b.team.institutionName || "—"}</td>
                          <td className="text-right font-mono font-bold text-xs text-blue-600">
                            {b.standing.points} pts
                          </td>
                          <td className="text-right font-mono text-xs text-gray-800">
                            {b.standing.totalSpeakerScore.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {isMotionPresentation && releasedMotions[motionSlideIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Motion presentation"
          className="fixed inset-0 z-[60] flex flex-col bg-[#111820] text-white"
        >
          <header className="flex items-center justify-between border-b border-white/15 px-5 py-4 sm:px-8">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase text-amber-300">
                Motion {motionSlideIndex + 1} of {releasedMotions.length}
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-gray-200">
                {releasedMotions[motionSlideIndex].reference || "Tournament motion"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsMotionPresentation(false)}
              aria-label="Close presentation"
              title="Close presentation"
              className="p-2 text-gray-300 hover:bg-white/10 hover:text-white rounded"
            >
              <X className="w-5 h-5" />
            </button>
          </header>
          <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-6 py-10 text-center sm:px-14">
            <p className="max-w-5xl text-3xl font-bold leading-tight sm:text-5xl">
              {releasedMotions[motionSlideIndex].text}
            </p>
            {releasedMotions[motionSlideIndex].infoSlide && (
              <div className="w-full max-w-4xl border-t border-amber-300/50 pt-6 text-left">
                <p className="mb-2 text-xs font-bold uppercase text-amber-300">Information slide</p>
                <p className="whitespace-pre-line text-base leading-relaxed text-gray-200 sm:text-lg">
                  {releasedMotions[motionSlideIndex].infoSlide}
                </p>
              </div>
            )}
          </div>
          <footer className="flex items-center justify-between border-t border-white/15 px-5 py-4 sm:px-8">
            <button
              type="button"
              onClick={() => setMotionSlideIndex((index) => Math.max(index - 1, 0))}
              disabled={motionSlideIndex === 0}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10 rounded disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" /> Previous
            </button>
            <div className="flex items-center gap-1.5" aria-label={`Slide ${motionSlideIndex + 1}`}>
              {releasedMotions.map((motion, index) => (
                <span
                  key={motion.id}
                  className={`h-1.5 w-5 rounded-full ${index === motionSlideIndex ? "bg-amber-300" : "bg-white/25"}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMotionSlideIndex((index) => Math.min(index + 1, releasedMotions.length - 1))}
              disabled={motionSlideIndex === releasedMotions.length - 1}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10 rounded disabled:opacity-40"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </footer>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-[#d0d7de] py-4 px-6 text-center text-xs text-gray-500">
        CrabbyTab Debate Tabulation System &bull; Live Real-Time Tab
      </footer>
    </div>
  );
}
