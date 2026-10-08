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
  Sparkles,
  ExternalLink,
  FileCheck2,
  Lock,
  Presentation,
  ChevronLeft,
  ChevronRight,
  X,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { DebateSide } from "@/types";
import { calculateStandings } from "@/lib/standings/calculator";
import { calculateBreaks } from "@/lib/breakqual/calculator";
import { canShowAggregateTeamScores } from "@/lib/publicScoreVisibility";
import { getPanelistNamesByScore } from "@/lib/adjudicators";

export default function PublicTournamentPage() {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;

  const {
    tournament,
    loading,
    cloudLoadError,
    activeRound,
    rounds,
    setActiveRound,
    debates,
    ballots,
    teams,
    motions,
    breakCategories,
    venues,
    adjudicators,
  } = useTournament();

  const getVenueCategory = (venueId?: string, venueName?: string): string | undefined => {
    if (!venueId && !venueName) return undefined;
    const v = venues.find(
      (item) => (venueId && item.id === venueId) || (venueName && item.name === venueName)
    );
    return v?.category?.trim() || undefined;
  };

  const getTraineeNames = (adjudicatorsSlot?: {
    traineeNames?: string[];
    traineeIds?: string[];
  }): string[] => {
    if (adjudicatorsSlot?.traineeNames && adjudicatorsSlot.traineeNames.length > 0) {
      return adjudicatorsSlot.traineeNames;
    }
    if (adjudicatorsSlot?.traineeIds && adjudicatorsSlot.traineeIds.length > 0) {
      return adjudicatorsSlot.traineeIds
        .map((id) => adjudicators.find((a) => a.id === id)?.name || id)
        .filter(Boolean);
    }
    return [];
  };

  const isBP = tournament?.format === "bp";
  const formatLabel = tournament
    ? {
        bp: "British Parliamentary",
        uadc: "UADC",
        australs: "Australs",
        wsdc: "WSDC",
        custom_2team: "Custom 2-Team",
      }[tournament.format]
    : "Tournament";
  const prefs = tournament?.preferences;

  // S1: Public toggles
  const showPublicDraw = prefs?.publicDraw !== false;
  const showPublicResults = prefs?.publicResults !== false;
  const showPublicStandings = prefs?.publicStandings !== false;
  const showPublicMotions = prefs?.publicMotions !== false;
  const breakHasBeenGenerated = teams.some((team) => team.breakCategoryIds !== undefined);

  // Available tabs based on preferences
  const availableTabs: ("draw" | "results" | "standings" | "motions" | "break")[] = [];
  if (showPublicDraw) availableTabs.push("draw");
  if (showPublicResults) availableTabs.push("results");
  if (showPublicStandings) availableTabs.push("standings");
  if (showPublicMotions) availableTabs.push("motions");
  if (breakHasBeenGenerated) availableTabs.push("break");

  const [activeTab, setActiveTab] = useState<"draw" | "results" | "standings" | "motions" | "break">(
    availableTabs[0] || "draw"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isMotionPresentation, setIsMotionPresentation] = useState(false);
  const [motionSlideIndex, setMotionSlideIndex] = useState(0);

  // Only released debates/rounds
  const releasedDebates = activeRound
    ? debates.filter(
        (d) =>
          d.roundId === activeRound.id &&
          (activeRound.drawStatus === "confirmed" || activeRound.drawStatus === "released")
      )
    : [];

  const roundResultsReleased = Boolean(activeRound?.resultsReleased && !activeRound.silent);
  const showPublicAdjudicators = activeRound?.adjudicatorsRevealed === true;
  const roundTeamSpeaksReleased = Boolean(roundResultsReleased && activeRound?.teamSpeaksReleased);

  const releasedMotions = motions
    .filter((motion) => motion.released === true)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

  const publicRounds = rounds.filter((round) => round.resultsReleased && !round.silent);
  const publicRoundIds = new Set(publicRounds.map((round) => round.id));
  const showAggregateTeamScores = canShowAggregateTeamScores(rounds);
  const publicBallots = ballots.filter(
    (ballot) => ballot.confirmed && !ballot.discarded && publicRoundIds.has(ballot.roundId)
  );
  const publicDebates = debates.filter((debate) => publicRoundIds.has(debate.roundId));
  const publicStandings = tournament
    ? calculateStandings(tournament, publicRounds, teams, publicDebates, publicBallots)
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-gray-500">Loading public tournament details...</p>
        </div>
      </div>
    );
  }

  if (cloudLoadError) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white border border-amber-200 rounded-xl p-8 text-center shadow-sm space-y-3">
          <h1 className="text-lg font-bold text-gray-900">Public tournament data unavailable</h1>
          <p role="alert" className="text-xs text-gray-600 leading-relaxed">{cloudLoadError}</p>
        </div>
      </div>
    );
  }

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
                Official Public Tab &bull; {formatLabel}
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

          {breakHasBeenGenerated && (
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
          )}
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
              <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left tabby-table">
                    <thead>
                      <tr>
                        <th>Venue</th>
                        {isBP ? (
                          <>
                            <th>OG</th>
                            <th>OO</th>
                            <th>CG</th>
                            <th>CO</th>
                          </>
                        ) : (
                          <>
                            <th>Affirmative</th>
                            <th>Negative</th>
                          </>
                        )}
                        <th>Chair</th>
                        <th>Panellists</th>
                        <th>Trainees</th>
                      </tr>
                    </thead>
                    <tbody>
                      {releasedDebates.map((d, idx) => {
                        const venueCategory = getVenueCategory(d.venueId, d.venueName);
                        const panellistNames = getPanelistNamesByScore(d.adjudicators, adjudicators);
                        const traineeNames = getTraineeNames(d.adjudicators);
                        return (
                          <tr key={d.id} className="hover:bg-gray-50">
                            <td className="text-xs">
                              <span className="font-bold text-gray-900">{d.venueName || `Room ${idx + 1}`}</span>
                              {venueCategory && (
                                <span className="block text-[10px] text-blue-700">{venueCategory}</span>
                              )}
                            </td>
                            {isBP ? (
                              (["OG", "OO", "CG", "CO"] as DebateSide[]).map((side) => (
                                <td key={side} className="text-xs font-semibold text-gray-900">
                                  {d.teams?.[side]?.teamName || "—"}
                                </td>
                              ))
                            ) : (
                              (["AFF", "NEG"] as DebateSide[]).map((side) => (
                                <td key={side} className="text-xs font-semibold text-gray-900">
                                  {d.teams?.[side]?.teamName || "—"}
                                </td>
                              ))
                            )}
                            <td className="text-xs font-medium text-gray-900">
                              {showPublicAdjudicators
                                ? d.adjudicators?.chairName || "—"
                                : "TBA"}
                            </td>
                            <td className="text-xs text-gray-700">
                              {showPublicAdjudicators ? panellistNames.join(", ") || "—" : "TBA"}
                            </td>
                            <td className="text-xs text-gray-600">
                              {showPublicAdjudicators ? traineeNames.join(", ") || "—" : "TBA"}
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
                        <th>Adjudicators</th>
                        <th className="text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {releasedDebates.map((d) => {
                        const ballot = ballotMap.get(d.id);
                        const venueCategory = getVenueCategory(d.venueId, d.venueName);
                        const panellistNames = getPanelistNamesByScore(d.adjudicators, adjudicators);
                        const traineeNames = getTraineeNames(d.adjudicators);

                        return (
                          <tr key={d.id} className="hover:bg-gray-50">
                            <td className="text-xs">
                              <div className="font-bold text-gray-900">{d.venueName || "—"}</div>
                              {venueCategory && (
                                <span className="inline-block mt-0.5 text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                  {venueCategory}
                                </span>
                              )}
                            </td>
                            {isBP ? (
                              (["OG", "OO", "CG", "CO"] as DebateSide[]).map((side) => {
                                const tSlot = d.teams[side];
                                const tScore = ballot?.teamScores?.[side];
                                return (
                                  <td key={side} className="text-xs">
                                    <div className="font-semibold text-gray-900">
                                      {tScore && (
                                        tScore.rank === 1
                                          ? <ArrowUp className="inline w-3.5 h-3.5 mr-1 text-emerald-600" aria-label="Winning team" />
                                          : <ArrowDown className="inline w-3.5 h-3.5 mr-1 text-red-600" aria-label="Losing team" />
                                      )}
                                      {tSlot?.teamName || "—"}
                                    </div>
                                    {tScore && (
                                      <div className="text-[11px] text-gray-500 font-mono">
                                        Rank {tScore.rank}
                                        {roundTeamSpeaksReleased && (
                                          <> &bull; {tScore.points} pts &bull; {tScore.totalSpeakerScore} spks</>
                                        )}
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
                                      {tScore && (
                                        tScore.win
                                          ? <ArrowUp className="inline w-3.5 h-3.5 mr-1 text-emerald-600" aria-label="Winning team" />
                                          : <ArrowDown className="inline w-3.5 h-3.5 mr-1 text-red-600" aria-label="Losing team" />
                                      )}
                                      {tSlot?.teamName || "—"}
                                    </div>
                                    {tScore && (
                                      <div className="text-[11px] text-gray-500 font-mono">
                                        {tScore.win ? "WIN" : "LOSS"}
                                        {roundTeamSpeaksReleased && <> &bull; {tScore.totalSpeakerScore} spks</>}
                                      </div>
                                    )}
                                  </td>
                                );
                              })
                            )}
                            <td className="text-xs text-gray-700">
                              <span className="font-semibold text-gray-700">Chair:</span>{" "}
                              <span className="text-gray-900 font-medium">
                                {showPublicAdjudicators
                                  ? d.adjudicators?.chairName
                                    ? `© ${d.adjudicators.chairName}`
                                    : "—"
                                  : "TBA"}
                              </span>
                              <span className="mx-1.5 text-gray-300">|</span>
                              <span className="font-medium text-gray-700">Panellists:</span>{" "}
                              <span>{showPublicAdjudicators ? panellistNames.join(", ") || "—" : "TBA"}</span>
                              <span className="mx-1.5 text-gray-300">|</span>
                              <span className="font-medium text-gray-700">Trainees:</span>{" "}
                              <span className="italic">
                                {showPublicAdjudicators ? traineeNames.join(", ") || "—" : "TBA"}
                              </span>
                            </td>
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
                    {showAggregateTeamScores && <th className="text-right">Points</th>}
                    {showAggregateTeamScores && <th className="text-right">Total Speaks</th>}
                    {showAggregateTeamScores && <th className="text-right">Avg Speaks</th>}
                  </tr>
                </thead>
                <tbody>
                  {publicStandings.teams.map((t) => (
                    <tr key={t.teamId} className="hover:bg-gray-50">
                      <td className="text-center font-mono font-bold text-xs">{t.rank}</td>
                      <td className="font-bold text-gray-900 text-xs">{t.teamName}</td>
                      <td className="text-xs text-gray-600">{t.institutionCode || "—"}</td>
                      {showAggregateTeamScores && <td className="text-right font-mono font-bold text-sm text-blue-600">{t.points}</td>}
                      {showAggregateTeamScores && (
                        <td className="text-right font-mono font-semibold text-xs text-gray-800">
                          {t.totalSpeakerScore.toFixed(1)}
                        </td>
                      )}
                      {showAggregateTeamScores && (
                        <td className="text-right font-mono text-xs text-gray-600">
                          {t.averageSpeakerScore.toFixed(2)}
                        </td>
                      )}
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
              releasedMotions.map((m) => {
                const assignedRounds = rounds.filter((r) => m.rounds && m.rounds.includes(r.id));
                const assignedRoundNames = assignedRounds.map((r) => r.name).join(", ");

                return (
                  <div key={m.id} className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-2xs">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                        {m.reference || "Motion"}
                      </span>
                      {assignedRoundNames ? (
                        <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                          Round: {assignedRoundNames}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Unassigned round</span>
                      )}
                    </div>
                    <blockquote className="text-base font-bold text-gray-900 my-2.5 pl-3 border-l-4 border-amber-500">
                      &ldquo;{m.text}&rdquo;
                    </blockquote>
                    {m.infoSlide && (
                      <div className="mt-2 p-3 bg-amber-50/50 rounded border border-amber-200 text-xs text-amber-950">
                        <div className="flex items-center justify-between mb-1">
                          <strong className="block text-[10px] uppercase font-bold text-amber-800">
                            Infoslide:
                          </strong>
                          {assignedRoundNames && (
                            <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200">
                              Round: {assignedRoundNames}
                            </span>
                          )}
                        </div>
                        <p className="whitespace-pre-line">{m.infoSlide}</p>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 5. Break View */}
        {breakHasBeenGenerated && activeTab === "break" && (
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
                        {showAggregateTeamScores && <th className="text-right">Points</th>}
                        {showAggregateTeamScores && <th className="text-right">Total Speaks</th>}
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
                          {showAggregateTeamScores && (
                            <td className="text-right font-mono font-bold text-xs text-blue-600">
                              {b.standing.points} pts
                            </td>
                          )}
                          {showAggregateTeamScores && (
                            <td className="text-right font-mono text-xs text-gray-800">
                              {b.standing.totalSpeakerScore.toFixed(1)}
                            </td>
                          )}
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

      {isMotionPresentation && releasedMotions[motionSlideIndex] && (() => {
        const currentMotion = releasedMotions[motionSlideIndex];
        const currentAssignedRounds = rounds.filter((r) => currentMotion.rounds && currentMotion.rounds.includes(r.id));
        const currentRoundNames = currentAssignedRounds.map((r) => r.name).join(", ");

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Motion presentation"
            className="fixed inset-0 z-[60] flex flex-col bg-[#111820] text-white"
          >
            <header className="flex items-center justify-between border-b border-white/15 px-5 py-4 sm:px-8">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-bold uppercase text-amber-300">
                    Motion {motionSlideIndex + 1} of {releasedMotions.length}
                  </p>
                  {currentRoundNames && (
                    <span className="text-[11px] font-semibold text-amber-200 bg-amber-500/20 px-2 py-0.5 rounded border border-amber-400/30">
                      Round: {currentRoundNames}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-gray-200">
                  {currentMotion.reference || "Tournament motion"}
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
              {currentRoundNames && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-xs font-semibold text-amber-300 uppercase tracking-wider">
                  <span>Assigned to: {currentRoundNames}</span>
                </div>
              )}
              <p className="max-w-5xl text-3xl font-bold leading-tight sm:text-5xl">
                {currentMotion.text}
              </p>
              {currentMotion.infoSlide && (
                <div className="w-full max-w-4xl border-t border-amber-300/50 pt-6 text-left">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase text-amber-300">Information slide</p>
                    {currentRoundNames && (
                      <span className="text-xs font-semibold text-amber-200 bg-amber-500/20 px-2.5 py-0.5 rounded border border-amber-400/30">
                        Round: {currentRoundNames}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-line text-base leading-relaxed text-gray-200 sm:text-lg">
                    {currentMotion.infoSlide}
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
        );
      })()}

      {/* Footer */}
      <footer className="bg-white border-t border-[#d0d7de] py-4 px-6 text-center text-xs text-gray-500">
        CrabbyTab Debate Tabulation System &bull; Live Real-Time Tab
      </footer>
    </div>
  );
}
