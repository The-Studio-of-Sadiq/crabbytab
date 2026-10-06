"use client";

import React, { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import {
  Users,
  MessageSquareHeart,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  ThumbsUp,
  ThumbsDown,
  X,
  ExternalLink,
  Shield,
  Clock,
  Lock,
  Award,
} from "lucide-react";
import { Debate, DebateSide } from "@/types";
import { validateFeedbackScore } from "@/lib/scoring/validator";

export default function TeamPrivatePortalPage() {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;
  const privateKey = params.key as string;

  const {
    tournament,
    loading,
    teams,
    rounds,
    activeRound,
    debates,
    feedback,
    addFeedback,
    updateTeam,
  } = useTournament();

  // The unique private URL key is the team's passcode.
  const team = useMemo(() => {
    return teams.find((t) => t.privateUrlKey === privateKey);
  }, [teams, privateKey]);

  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;
  const minFeedbackScore = tournament?.preferences?.feedbackMinScore ?? 1;
  const maxFeedbackScore = tournament?.preferences?.feedbackMaxScore ?? 10;
  const isBP = tournament?.format === "bp";

  // Filter state
  const [selectedRoundTab, setSelectedRoundTab] = useState<string>("active");

  // Feedback Modal State
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackTargetAdjId, setFeedbackTargetAdjId] = useState("");
  const [feedbackTargetAdjName, setFeedbackTargetAdjName] = useState("");
  const [feedbackTargetAdjRole, setFeedbackTargetAdjRole] = useState("");
  const [feedbackDebateId, setFeedbackDebateId] = useState("");
  const [feedbackRoundId, setFeedbackRoundId] = useState("");
  const [feedbackScore, setFeedbackScore] = useState<number>(
    Math.round((minFeedbackScore + maxFeedbackScore) / 2)
  );
  const [feedbackAgree, setFeedbackAgree] = useState<boolean>(true);
  const [feedbackComments, setFeedbackComments] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSuccessNotice, setFeedbackSuccessNotice] = useState("");

  // Check-in toggle
  const [isUpdatingCheckIn, setIsUpdatingCheckIn] = useState(false);
  const [checkInError, setCheckInError] = useState("");
  const handleToggleCheckIn = async () => {
    if (!team) return;
    setIsUpdatingCheckIn(true);
    setCheckInError("");
    try {
      await updateTeam({
        ...team,
        checkedIn: !team.checkedIn,
      }, privateKey);
    } catch (error) {
      setCheckInError(error instanceof Error ? error.message : "Could not update check-in.");
    } finally {
      setIsUpdatingCheckIn(false);
    }
  };

  // Find all debates this team competed in
  const teamDebates = useMemo(() => {
    if (!team) return [];
    return debates.filter((d) => {
      const sides = Object.values(d.teams || {});
      return sides.some((slot) => slot?.teamId === team.id);
    });
  }, [debates, team]);

  // Round mapping
  const roundsMap = useMemo(() => {
    const map = new Map<string, (typeof rounds)[0]>();
    rounds.forEach((r) => map.set(r.id, r));
    return map;
  }, [rounds]);

  // Active round debates vs all debates
  const displayedDebates = useMemo(() => {
    if (selectedRoundTab === "all") {
      return [...teamDebates].sort((a, b) => b.roundSeq - a.roundSeq);
    }
    if (activeRound) {
      return teamDebates.filter((d) => d.roundId === activeRound.id);
    }
    return teamDebates;
  }, [teamDebates, selectedRoundTab, activeRound]);

  // Check if feedback already submitted by this team for target adjudicator in debate
  const hasSubmittedFeedback = (targetId: string, debateId: string) => {
    if (!team) return false;
    return feedback.some(
      (f) =>
        f.sourceId === team.id &&
        f.targetAdjudicatorId === targetId &&
        f.debateId === debateId
    );
  };

  const getSubmittedFeedback = (targetId: string, debateId: string) => {
    if (!team) return null;
    return feedback.find(
      (f) =>
        f.sourceId === team.id &&
        f.targetAdjudicatorId === targetId &&
        f.debateId === debateId
    );
  };

  // Open feedback modal pre-filled
  const handleOpenFeedbackModal = (
    targetAdj: { id: string; name: string; role: string },
    debate: Debate
  ) => {
    setFeedbackTargetAdjId(targetAdj.id);
    setFeedbackTargetAdjName(targetAdj.name);
    setFeedbackTargetAdjRole(targetAdj.role);
    setFeedbackDebateId(debate.id);
    setFeedbackRoundId(debate.roundId);
    setFeedbackScore(Math.round((minFeedbackScore + maxFeedbackScore) / 2));
    setFeedbackAgree(true);
    setFeedbackComments("");
    setFeedbackError("");
    setShowFeedbackModal(true);
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!team) return;
    setFeedbackError("");

    const check = validateFeedbackScore(feedbackScore, tournament?.preferences);
    if (!check.valid && check.error) {
      setFeedbackError(check.error);
      return;
    }

    setFeedbackSubmitting(true);
    try {
      await addFeedback({
        debateId: feedbackDebateId,
        roundId: feedbackRoundId,
        targetAdjudicatorId: feedbackTargetAdjId,
        targetAdjudicatorName: feedbackTargetAdjName,
        sourceType: "team",
        sourceId: team.id,
        sourceName: team.name,
        score: feedbackScore,
        agreeWithDecision: feedbackAgree,
        comments: feedbackComments.trim(),
        confirmed: true,
      }, privateKey);
      setShowFeedbackModal(false);
      setFeedbackSuccessNotice(
        `Feedback for ${feedbackTargetAdjName} (${feedbackTargetAdjRole}) was recorded successfully.`
      );
      setTimeout(() => setFeedbackSuccessNotice(""), 5000);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : "Failed to submit feedback.");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-gray-500">Loading your team portal...</p>
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-[#d0d7de] rounded-xl p-8 text-center shadow-sm space-y-4">
          <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Private Team Link Invalid</h1>
          <p className="text-xs text-gray-600 leading-relaxed">
            The private URL you visited is not associated with a registered team in this tournament.
            Please contact the tournament tabroom / organizing committee for your team&apos;s personal link.
          </p>
          <Link
            href={`/${tournamentSlug}/public`}
            className="inline-block px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 transition"
          >
            Visit Public Tournament Page
          </Link>
        </div>
      </div>
    );
  }

  // Count feedback submissions by this team
  const teamFeedbackCount = feedback.filter((f) => f.sourceId === team.id).length;

  return (
    <div className="min-h-screen bg-[#f6f8fa] text-gray-900 pb-16">
      {/* Top Header / Identity Bar */}
      <header className="bg-white border-b border-[#d0d7de] sticky top-0 z-30 shadow-2xs">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-base shadow-xs">
              👥
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">
                  {tournament?.shortName || tournament?.name || "Tournament"} &bull; Team Portal
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Private Link
                </span>
              </div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
                <span>{team.name}</span>
                {team.institutionName && (
                  <span className="text-xs font-normal text-gray-500">
                    ({team.institutionName})
                  </span>
                )}
              </h1>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleToggleCheckIn}
              disabled={isUpdatingCheckIn}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition border ${
                team.checkedIn
                  ? "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                  : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
              }`}
            >
              <UserCheck className={`w-3.5 h-3.5 ${team.checkedIn ? "text-emerald-600" : "text-gray-500"}`} />
              <span>{team.checkedIn ? "Checked In ✓" : "Mark Checked In"}</span>
            </button>

            <Link
              href={`/${tournamentSlug}/public`}
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md transition text-xs flex items-center space-x-1"
              title="View Public Draw & Standings"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Public Hub</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {checkInError && (
          <p role="alert" className="text-xs text-red-700">{checkInError}</p>
        )}
        {/* Success Notices */}
        {feedbackSuccessNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-xs font-semibold text-emerald-800 flex items-center space-x-2 shadow-2xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackSuccessNotice}</span>
          </div>
        )}

        {/* Team Information Card */}
        <div className="bg-white border border-[#d0d7de] rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Speakers:</span>
              {team.speakers && team.speakers.length > 0 ? (
                team.speakers.map((spk, idx) => (
                  <span
                    key={spk.id || idx}
                    className="px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-800 border border-gray-200"
                  >
                    {spk.name}
                  </span>
                ))
              ) : (
                <span className="text-xs text-gray-500 italic">No speakers listed</span>
              )}
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Welcome to your private team dashboard. Here you can check your debate venues, track assigned
              judges, and <strong>submit constructive feedback on adjudicators</strong> who judged your debates.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 text-xs">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-center min-w-[90px]">
              <span className="block text-lg font-extrabold text-emerald-700">{teamDebates.length}</span>
              <span className="text-[10px] text-emerald-800 font-medium">Debates Found</span>
            </div>
            <div className="bg-pink-50 border border-pink-200 rounded-lg p-2.5 text-center min-w-[90px]">
              <span className="block text-lg font-extrabold text-pink-700">{teamFeedbackCount}</span>
              <span className="text-[10px] text-pink-800 font-medium">Feedback Sent</span>
            </div>
          </div>
        </div>

        {/* Feedback Requirement Notice */}
        {feedbackEnabled && (
          <div className="p-4 bg-pink-50/70 border border-pink-200 rounded-xl text-xs text-pink-950 flex items-start space-x-3">
            <MessageSquareHeart className="w-5 h-5 text-pink-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold block">Adjudicator Feedback (Feedback Only Portal)</span>
              <p className="text-pink-900 leading-relaxed text-[11px]">
                To maintain high adjudication quality, teams are encouraged to submit feedback for every
                debate. Your ratings are kept strictly confidential by the Adjudication Core and are used
                for judge tracking and allocation.
              </p>
            </div>
          </div>
        )}

        {/* Tab Controls for Assigned Debates */}
        <div className="flex items-center justify-between border-b border-[#d0d7de] pb-2">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setSelectedRoundTab("active")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                selectedRoundTab === "active"
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              }`}
            >
              Current Round {activeRound ? `(${activeRound.name})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setSelectedRoundTab("all")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                selectedRoundTab === "all"
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              }`}
            >
              All Rounds & History ({teamDebates.length})
            </button>
          </div>

          <span className="text-xs text-gray-500 font-medium hidden sm:inline">
            Showing {displayedDebates.length} debate(s)
          </span>
        </div>

        {/* Debates List */}
        {displayedDebates.length === 0 ? (
          <div className="bg-white border border-[#d0d7de] rounded-xl p-10 text-center text-gray-500 text-xs shadow-xs space-y-2">
            <Clock className="w-8 h-8 text-gray-400 mx-auto" />
            <p className="font-semibold text-gray-700">No debates available for this round view.</p>
            <p className="text-[11px] text-gray-500">
              When the round draw is published by the tabroom, your room, side, and adjudicators will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {displayedDebates.map((debate) => {
              const round = roundsMap.get(debate.roundId);

              // Determine team's side
              let mySide: DebateSide | null = null;
              for (const [sKey, slot] of Object.entries(debate.teams || {})) {
                if (slot?.teamId === team.id) {
                  mySide = sKey as DebateSide;
                  break;
                }
              }

              // Collect panel of adjudicators who judged this debate
              const panel: { id: string; name: string; role: string }[] = [];
              if (debate.adjudicators?.chairId) {
                panel.push({
                  id: debate.adjudicators.chairId,
                  name: debate.adjudicators.chairName || "Chair",
                  role: "Chair",
                });
              }
              debate.adjudicators?.panellistIds?.forEach((pid, idx) => {
                panel.push({
                  id: pid,
                  name: debate.adjudicators?.panellistNames?.[idx] || "Panellist",
                  role: "Panellist",
                });
              });
              debate.adjudicators?.traineeIds?.forEach((tid, idx) => {
                panel.push({
                  id: tid,
                  name: debate.adjudicators?.traineeNames?.[idx] || "Trainee",
                  role: "Trainee",
                });
              });

              return (
                <div
                  key={debate.id}
                  className="bg-white border border-[#d0d7de] rounded-xl shadow-xs overflow-hidden transition hover:border-gray-400"
                >
                  {/* Debate Card Header */}
                  <div className="bg-[#f6f8fa] px-5 py-3.5 border-b border-[#d0d7de] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center space-x-2.5">
                      <span className="font-bold text-gray-900 text-sm">
                        {round ? round.name : `Round ${debate.roundSeq}`}
                      </span>
                      <span className="text-gray-400">&bull;</span>
                      <div className="flex items-center space-x-1 text-xs text-gray-700 font-semibold">
                        <MapPin className="w-3.5 h-3.5 text-gray-500" />
                        <span>{debate.venueName}</span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {mySide && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 uppercase">
                          Your Side: {mySide}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-5 space-y-4">
                    {/* Motion if released */}
                    {debate.motionText ? (
                      <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs">
                        <span className="font-bold text-amber-900 block mb-0.5">Motion:</span>
                        <p className="text-gray-800 italic">&ldquo;{debate.motionText}&rdquo;</p>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-[11px] text-gray-500 italic">
                        Motion will be announced before debate preparation.
                      </div>
                    )}

                    {/* Room Matchup */}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                        Debate Matchup
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                        {isBP ? (
                          <>
                            <div
                              className={`p-2.5 rounded border text-xs ${
                                mySide === "OG"
                                  ? "bg-emerald-50 border-emerald-300 font-bold"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span className="text-[10px] font-bold text-gray-500 block">OG &bull; Opening Gov</span>
                              <span className="text-gray-900">{debate.teams.OG?.teamName || "TBD"}</span>
                              {mySide === "OG" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">(You)</span>}
                            </div>
                            <div
                              className={`p-2.5 rounded border text-xs ${
                                mySide === "OO"
                                  ? "bg-emerald-50 border-emerald-300 font-bold"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span className="text-[10px] font-bold text-gray-500 block">OO &bull; Opening Opp</span>
                              <span className="text-gray-900">{debate.teams.OO?.teamName || "TBD"}</span>
                              {mySide === "OO" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">(You)</span>}
                            </div>
                            <div
                              className={`p-2.5 rounded border text-xs ${
                                mySide === "CG"
                                  ? "bg-emerald-50 border-emerald-300 font-bold"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span className="text-[10px] font-bold text-gray-500 block">CG &bull; Closing Gov</span>
                              <span className="text-gray-900">{debate.teams.CG?.teamName || "TBD"}</span>
                              {mySide === "CG" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">(You)</span>}
                            </div>
                            <div
                              className={`p-2.5 rounded border text-xs ${
                                mySide === "CO"
                                  ? "bg-emerald-50 border-emerald-300 font-bold"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span className="text-[10px] font-bold text-gray-500 block">CO &bull; Closing Opp</span>
                              <span className="text-gray-900">{debate.teams.CO?.teamName || "TBD"}</span>
                              {mySide === "CO" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">(You)</span>}
                            </div>
                          </>
                        ) : (
                          <>
                            <div
                              className={`p-2.5 rounded border text-xs ${
                                mySide === "AFF"
                                  ? "bg-emerald-50 border-emerald-300 font-bold"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span className="text-[10px] font-bold text-gray-500 block">AFF &bull; Affirmative</span>
                              <span className="text-gray-900">{debate.teams.AFF?.teamName || "TBD"}</span>
                              {mySide === "AFF" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">(You)</span>}
                            </div>
                            <div
                              className={`p-2.5 rounded border text-xs ${
                                mySide === "NEG"
                                  ? "bg-emerald-50 border-emerald-300 font-bold"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span className="text-[10px] font-bold text-gray-500 block">NEG &bull; Negative</span>
                              <span className="text-gray-900">{debate.teams.NEG?.teamName || "TBD"}</span>
                              {mySide === "NEG" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">(You)</span>}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Section: Feedback on Adjudicators */}
                    {feedbackEnabled && (
                      <div className="pt-3 border-t border-gray-100 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-800 flex items-center space-x-1.5">
                            <MessageSquareHeart className="w-4 h-4 text-pink-600" />
                            <span>Adjudicators Assigned to Your Debate</span>
                          </span>
                          <span className="text-[10px] text-gray-500 font-mono">
                            Rating Scale: {minFeedbackScore}–{maxFeedbackScore}
                          </span>
                        </div>

                        {panel.length === 0 ? (
                          <p className="text-[11px] text-gray-500 italic">
                            No adjudicators allocated to this room yet.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                            {panel.map((adj) => {
                              const submitted = hasSubmittedFeedback(adj.id, debate.id);
                              const pastFb = getSubmittedFeedback(adj.id, debate.id);

                              return (
                                <div
                                  key={adj.id}
                                  className="p-3 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-between gap-2"
                                >
                                  <div>
                                    <span className="font-bold text-gray-900 text-xs block">{adj.name}</span>
                                    <span className="text-[10px] text-gray-500 font-medium">{adj.role}</span>
                                  </div>

                                  {submitted ? (
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded flex items-center space-x-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      <span>Done ({pastFb?.score})</span>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenFeedbackModal(adj, debate)}
                                      className="px-3 py-1 bg-pink-600 text-white hover:bg-pink-700 rounded text-xs font-semibold transition shadow-2xs"
                                    >
                                      Submit Feedback
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* FEEDBACK MODAL */}
      {showFeedbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center space-x-2">
                <MessageSquareHeart className="w-5 h-5 text-pink-600" />
                <h3 className="font-bold text-gray-900 text-sm">Adjudicator Feedback</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowFeedbackModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {feedbackError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center space-x-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{feedbackError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitFeedback} className="space-y-4 text-xs">
              <div className="p-2.5 rounded bg-gray-50 border border-gray-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-500 font-bold uppercase block">Target Adjudicator</span>
                  <span className="text-sm font-bold text-gray-900">{feedbackTargetAdjName}</span>
                </div>
                <span className="text-[11px] font-semibold text-gray-600 px-2 py-0.5 rounded bg-white border border-gray-200">
                  {feedbackTargetAdjRole}
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-gray-700">
                    Feedback Score ({minFeedbackScore}–{maxFeedbackScore})
                  </label>
                  <span className="text-sm font-bold text-emerald-600">{feedbackScore} / {maxFeedbackScore}</span>
                </div>
                <input
                  type="range"
                  min={minFeedbackScore}
                  max={maxFeedbackScore}
                  step={1}
                  value={feedbackScore}
                  onChange={(e) => setFeedbackScore(parseInt(e.target.value, 10))}
                  className="w-full accent-emerald-600 cursor-pointer"
                />
              </div>

              <div>
                <label className="font-semibold text-gray-700 block mb-1.5">
                  Did you agree with this adjudicator&apos;s decision/call?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFeedbackAgree(true)}
                    className={`py-2 px-3 rounded-md font-semibold text-xs flex items-center justify-center space-x-1.5 border transition ${
                      feedbackAgree
                        ? "bg-emerald-50 border-emerald-500 text-emerald-800 font-bold"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Yes, Agreed</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedbackAgree(false)}
                    className={`py-2 px-3 rounded-md font-semibold text-xs flex items-center justify-center space-x-1.5 border transition ${
                      !feedbackAgree
                        ? "bg-amber-50 border-amber-500 text-amber-800 font-bold"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <ThumbsDown className="w-3.5 h-3.5 text-amber-600" />
                    <span>No, Disagreed</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-gray-700 block mb-1">
                  Constructive Feedback & Justification (Confidential to Adjudication Core)
                </label>
                <textarea
                  rows={3}
                  value={feedbackComments}
                  onChange={(e) => setFeedbackComments(e.target.value)}
                  placeholder="Explain constructive points: quality of oral adjudication, tracking of clash, fairness..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowFeedbackModal(false)}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={feedbackSubmitting}
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-md font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {feedbackSubmitting ? "Submitting..." : "Submit Feedback"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
