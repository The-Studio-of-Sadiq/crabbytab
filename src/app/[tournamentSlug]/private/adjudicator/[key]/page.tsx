"use client";

import React, { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import {
  FileCheck2,
  MessageSquareHeart,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Users,
  Star,
  ThumbsUp,
  ThumbsDown,
  X,
  ExternalLink,
  ChevronRight,
  Shield,
  Clock,
  Sparkles,
  Lock,
} from "lucide-react";
import { DebateSide, Debate, BallotSubmission } from "@/types";
import { validateFeedbackScore, validateSpeakerScore, validateReplyScore } from "@/lib/scoring/validator";

export default function AdjudicatorPrivatePortalPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentSlug = params.tournamentSlug as string;
  const privateKey = params.key as string;

  const {
    tournament,
    loading,
    adjudicators,
    teams,
    rounds,
    activeRound,
    debates,
    ballots,
    feedback,
    submitBallot,
    addFeedback,
    updateAdjudicator,
  } = useTournament();

  // The unique private URL key is the adjudicator's passcode.
  const adjudicator = useMemo(() => {
    return adjudicators.find((a) => a.privateUrlKey === privateKey);
  }, [adjudicators, privateKey]);

  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;
  const minFeedbackScore = tournament?.preferences?.feedbackMinScore ?? 1;
  const maxFeedbackScore = tournament?.preferences?.feedbackMaxScore ?? 10;
  const isBP = tournament?.format === "bp";
  const replyEnabled = Boolean(tournament?.preferences?.replyScoresEnabled && !isBP);

  // Filter state
  const [selectedRoundTab, setSelectedRoundTab] = useState<string>("active");

  // Feedback Modal State
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackTargetAdjId, setFeedbackTargetAdjId] = useState("");
  const [feedbackTargetAdjName, setFeedbackTargetAdjName] = useState("");
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

  // In-portal Ballot Modal State
  const [showBallotModal, setShowBallotModal] = useState(false);
  const [ballotDebate, setBallotDebate] = useState<Debate | null>(null);
  const [ballotScores, setBallotScores] = useState<Record<string, { speakerId: string; speakerName: string; score: number }[]>>({});
  const [ballotReplyScores, setBallotReplyScores] = useState<Record<string, { speakerId: string; speakerName: string; score: number }>>({});
  const [ballotRanks, setBallotRanks] = useState<Record<string, number>>({});
  const [ballotMotionId, setBallotMotionId] = useState<string>("");
  const [ballotSubmitting, setBallotSubmitting] = useState(false);
  const [ballotError, setBallotError] = useState("");
  const [ballotSuccessNotice, setBallotSuccessNotice] = useState("");

  // Check-in toggle
  const [isUpdatingCheckIn, setIsUpdatingCheckIn] = useState(false);
  const [checkInError, setCheckInError] = useState("");
  const handleToggleCheckIn = async () => {
    if (!adjudicator) return;
    setIsUpdatingCheckIn(true);
    setCheckInError("");
    try {
      await updateAdjudicator({
        ...adjudicator,
        checkedIn: !adjudicator.checkedIn,
      }, privateKey);
    } catch (error) {
      setCheckInError(error instanceof Error ? error.message : "Could not update check-in.");
    } finally {
      setIsUpdatingCheckIn(false);
    }
  };

  // Find all debates this adjudicator is assigned to
  const assignedDebates = useMemo(() => {
    if (!adjudicator) return [];
    return debates.filter((d) => {
      const adjs = d.adjudicators;
      if (!adjs) return false;
      return (
        adjs.chairId === adjudicator.id ||
        (adjs.panellistIds && adjs.panellistIds.includes(adjudicator.id)) ||
        (adjs.traineeIds && adjs.traineeIds.includes(adjudicator.id))
      );
    });
  }, [debates, adjudicator]);

  // Round mapping
  const roundsMap = useMemo(() => {
    const map = new Map<string, (typeof rounds)[0]>();
    rounds.forEach((r) => map.set(r.id, r));
    return map;
  }, [rounds]);

  // Teams mapping
  const teamsMap = useMemo(() => {
    const map = new Map<string, (typeof teams)[0]>();
    teams.forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  // Adjudicators mapping
  const adjsMap = useMemo(() => {
    const map = new Map<string, (typeof adjudicators)[0]>();
    adjudicators.forEach((a) => map.set(a.id, a));
    return map;
  }, [adjudicators]);

  // Active round debates vs past debates
  const displayedDebates = useMemo(() => {
    if (selectedRoundTab === "all") {
      return [...assignedDebates].sort((a, b) => b.roundSeq - a.roundSeq);
    }
    if (activeRound) {
      return assignedDebates.filter((d) => d.roundId === activeRound.id);
    }
    return assignedDebates;
  }, [assignedDebates, selectedRoundTab, activeRound]);

  // Check if feedback already submitted by this adjudicator for target adjudicator in debate
  const hasSubmittedFeedback = (targetId: string, debateId: string) => {
    if (!adjudicator) return false;
    return feedback.some(
      (f) =>
        f.sourceId === adjudicator.id &&
        f.targetAdjudicatorId === targetId &&
        f.debateId === debateId
    );
  };

  const getSubmittedFeedback = (targetId: string, debateId: string) => {
    if (!adjudicator) return null;
    return feedback.find(
      (f) =>
        f.sourceId === adjudicator.id &&
        f.targetAdjudicatorId === targetId &&
        f.debateId === debateId
    );
  };

  // Open feedback modal pre-filled
  const handleOpenFeedbackModal = (targetAdj: { id: string; name: string }, debate: Debate) => {
    setFeedbackTargetAdjId(targetAdj.id);
    setFeedbackTargetAdjName(targetAdj.name);
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
    if (!adjudicator) return;
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
        sourceType: "adjudicator",
        sourceId: adjudicator.id,
        sourceName: adjudicator.name,
        score: feedbackScore,
        agreeWithDecision: feedbackAgree,
        comments: feedbackComments.trim(),
        confirmed: true,
      }, privateKey);
      setShowFeedbackModal(false);
      setFeedbackSuccessNotice(`Feedback for ${feedbackTargetAdjName} was recorded successfully.`);
      setTimeout(() => setFeedbackSuccessNotice(""), 5000);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : "Failed to submit feedback.");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // Open in-portal ballot modal
  const handleOpenBallotModal = (debate: Debate) => {
    setBallotDebate(debate);
    setBallotMotionId(debate.motionId || "");
    setBallotError("");

    // Initialize from confirmed or draft ballot if exists
    const existing = ballots.find((b) => b.debateId === debate.id && !b.discarded);
    const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];

    const initScores: Record<string, { speakerId: string; speakerName: string; score: number }[]> = {};
    const initReplyScores: Record<string, { speakerId: string; speakerName: string; score: number }> = {};
    const initRanks: Record<string, number> = {};

    sides.forEach((side, sideIdx) => {
      const teamSlot = debate.teams[side];
      const team = teamSlot ? teamsMap.get(teamSlot.teamId) : null;
      initRanks[side] = existing?.teamScores?.[side]?.rank || sideIdx + 1;

      if (existing?.speakerScores?.[side]) {
        initScores[side] = existing.speakerScores[side].filter((s) => s.position !== 4);
        const replyItem = existing.speakerScores[side].find((s) => s.position === 4);
        if (replyItem) initReplyScores[side] = replyItem;
      } else {
        const substantiveCount = tournament?.preferences?.substantiveSpeakers || (isBP ? 2 : 3);
        const spks = [];
        for (let i = 0; i < substantiveCount; i++) {
          const spk = team?.speakers?.[i];
          spks.push({
            speakerId: spk?.id || `spk-${side}-${i}`,
            speakerName: spk?.name || `Speaker ${i + 1}`,
            score: Math.round(((tournament?.preferences?.minSpeakerScore || 68) + (tournament?.preferences?.maxSpeakerScore || 84)) / 2),
          });
        }
        initScores[side] = spks;

        if (replyEnabled) {
          initReplyScores[side] = {
            speakerId: `reply-${side}`,
            speakerName: `${team?.name || side} Reply`,
            score: Math.round(((tournament?.preferences?.minReplyScore || 34) + (tournament?.preferences?.maxReplyScore || 42)) / 2),
          };
        }
      }
    });

    setBallotScores(initScores);
    setBallotReplyScores(initReplyScores);
    setBallotRanks(initRanks);
    setShowBallotModal(true);
  };

  const handleSubmitBallotFromPortal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ballotDebate || !adjudicator) return;
    setBallotError("");

    // Validate scores
    const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];
    for (const side of sides) {
      for (const spk of ballotScores[side] || []) {
        const check = validateSpeakerScore(spk.score, tournament?.preferences);
        if (!check.valid && check.error) {
          setBallotError(`${side} ${spk.speakerName}: ${check.error}`);
          return;
        }
      }
      if (replyEnabled && ballotReplyScores[side]) {
        const check = validateReplyScore(ballotReplyScores[side].score, tournament?.preferences);
        if (!check.valid && check.error) {
          setBallotError(`${side} Reply: ${check.error}`);
          return;
        }
      }
    }

    setBallotSubmitting(true);
    try {
      const speakerScoresRecord: Record<string, any[]> = {};
      const teamScoresRecord: Record<string, any> = {};

      sides.forEach((side) => {
        const teamSlot = ballotDebate.teams[side];
        if (!teamSlot) return;

        const allSpkList = [...(ballotScores[side] || [])].map((s, idx) => ({
          speakerId: s.speakerId,
          speakerName: s.speakerName,
          score: s.score,
          position: idx + 1,
        }));

        if (replyEnabled && ballotReplyScores[side]) {
          allSpkList.push({
            speakerId: ballotReplyScores[side].speakerId,
            speakerName: ballotReplyScores[side].speakerName,
            score: ballotReplyScores[side].score,
            position: 4,
          });
        }

        speakerScoresRecord[side] = allSpkList;

        const includeGhosts = tournament?.preferences?.teamScoreIncludesGhosts ?? false;
        let substantiveList = ballotScores[side] || [];
        if (!includeGhosts) {
          const seen = new Set<string>();
          substantiveList = substantiveList.filter((s) => {
            if (!s.speakerId) return true;
            if (seen.has(s.speakerId)) return false;
            seen.add(s.speakerId);
            return true;
          });
        }
        const substantiveTotal = substantiveList.reduce((sum, s) => sum + s.score, 0);
        const replyTotal = replyEnabled && ballotReplyScores[side] ? ballotReplyScores[side].score : 0;
        const total = substantiveTotal + replyTotal;
        const rank = ballotRanks[side] || 1;
        const pts = isBP ? (rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0) : rank === 1 ? 1 : 0;

        teamScoresRecord[side] = {
          side,
          teamId: teamSlot.teamId,
          points: pts,
          totalSpeakerScore: total,
          rank,
          win: pts === 1 || pts === 3,
          margin: isBP ? 0 : rank === 1 ? 2 : -2,
        };
      });

      const candidateBallot: BallotSubmission = {
        id: `ballot-${ballotDebate.id}-adj-${Date.now()}`,
        tournamentId: tournament?.id || tournamentSlug,
        roundId: ballotDebate.roundId,
        debateId: ballotDebate.id,
        version: 1,
        confirmed: true,
        discarded: false,
        submitterType: "judge",
        submitterId: adjudicator.id,
        submitterName: adjudicator.name,
        motionId: ballotMotionId,
        motionText: ballotDebate.motionText,
        speakerScores: speakerScoresRecord,
        teamScores: teamScoresRecord,
        chairId: ballotDebate.adjudicators?.chairId,
        timestamp: new Date().toISOString(),
        confirmedBy: adjudicator.name,
        confirmedTimestamp: new Date().toISOString(),
      };

      await submitBallot(candidateBallot, privateKey);
      setShowBallotModal(false);
      setBallotSuccessNotice(`Ballot for ${ballotDebate.venueName} successfully submitted!`);
      setTimeout(() => setBallotSuccessNotice(""), 6000);
    } catch (error) {
      setBallotError(error instanceof Error ? error.message : "Failed to save ballot.");
    } finally {
      setBallotSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-gray-500">Loading your adjudicator portal...</p>
        </div>
      </div>
    );
  }

  if (!adjudicator) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-[#d0d7de] rounded-xl p-8 text-center shadow-sm space-y-4">
          <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Private Adjudicator Link Invalid</h1>
          <p className="text-xs text-gray-600 leading-relaxed">
            The private URL you visited is not associated with an adjudicator in this tournament. Please
            contact the tournament tabroom / adjudication core to obtain your valid personal link.
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

  return (
    <div className="min-h-screen bg-[#f6f8fa] text-gray-900 pb-16">
      {/* Top Header / Identity Bar */}
      <header className="bg-white border-b border-[#d0d7de] sticky top-0 z-30 shadow-2xs">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-base shadow-xs">
              ⚖️
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">
                  {tournament?.shortName || tournament?.name || "Tournament"} &bull; Adjudicator Portal
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  Private Link
                </span>
              </div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
                <span>{adjudicator.name}</span>
                {adjudicator.institutionName && (
                  <span className="text-xs font-normal text-gray-500">
                    ({adjudicator.institutionName})
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
                adjudicator.checkedIn
                  ? "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                  : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
              }`}
            >
              <UserCheck className={`w-3.5 h-3.5 ${adjudicator.checkedIn ? "text-emerald-600" : "text-gray-500"}`} />
              <span>{adjudicator.checkedIn ? "Checked In ✓" : "Mark Checked In"}</span>
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

        {ballotSuccessNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-xs font-semibold text-emerald-800 flex items-center space-x-2 shadow-2xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{ballotSuccessNotice}</span>
          </div>
        )}

        {/* Adjudicator Status & Responsibilities Card */}
        <div className="bg-white border border-[#d0d7de] rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Accreditation</span>
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-gray-100 text-gray-800 border border-gray-200">
                Score: {adjudicator.baseScore}
              </span>
              {adjudicator.trainee ? (
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  Trainee
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
                  Voting Adjudicator
                </span>
              )}
              {adjudicator.independent && (
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-300">
                  Independent
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              Use this private portal to <strong>submit ballots</strong> for debates where you chair, and{" "}
              <strong>submit confidential feedback</strong> on co-panellists, chairs, and trainees.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 text-xs">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-center min-w-[90px]">
              <span className="block text-lg font-extrabold text-blue-700">{assignedDebates.length}</span>
              <span className="text-[10px] text-blue-800 font-medium">Debates Assigned</span>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-center min-w-[90px]">
              <span className="block text-lg font-extrabold text-emerald-700">
                {feedback.filter((f) => f.sourceId === adjudicator.id).length}
              </span>
              <span className="text-[10px] text-emerald-800 font-medium">Feedback Given</span>
            </div>
          </div>
        </div>

        {/* Tab Controls for Assigned Debates */}
        <div className="flex items-center justify-between border-b border-[#d0d7de] pb-2">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setSelectedRoundTab("active")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                selectedRoundTab === "active"
                  ? "bg-blue-600 text-white shadow-2xs"
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
                  ? "bg-blue-600 text-white shadow-2xs"
                  : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              }`}
            >
              All Rounds & History ({assignedDebates.length})
            </button>
          </div>

          <span className="text-xs text-gray-500 font-medium hidden sm:inline">
            Showing {displayedDebates.length} debate(s)
          </span>
        </div>

        {/* Assigned Debates List */}
        {displayedDebates.length === 0 ? (
          <div className="bg-white border border-[#d0d7de] rounded-xl p-10 text-center text-gray-500 text-xs shadow-xs space-y-2">
            <Clock className="w-8 h-8 text-gray-400 mx-auto" />
            <p className="font-semibold text-gray-700">No debates assigned for this view.</p>
            <p className="text-[11px] text-gray-500">
              When the tabroom generates and confirms the draw, your assigned room, panel, and ballot will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {displayedDebates.map((debate) => {
              const round = roundsMap.get(debate.roundId);
              const isChair = debate.adjudicators?.chairId === adjudicator.id;
              const isPanellist = debate.adjudicators?.panellistIds?.includes(adjudicator.id);
              const isTrainee = debate.adjudicators?.traineeIds?.includes(adjudicator.id);

              const roleLabel = isChair ? "Chair" : isPanellist ? "Panellist" : isTrainee ? "Trainee" : "Judge";
              const debateBallots = ballots.filter((b) => b.debateId === debate.id && !b.discarded);
              const confirmedBallot = debateBallots.find((b) => b.confirmed);
              const draftBallot = debateBallots.find((b) => !b.confirmed);
              const existingBallot = confirmedBallot || draftBallot;

              // Build list of co-judges for feedback
              const coJudges: { id: string; name: string; role: string }[] = [];
              if (debate.adjudicators?.chairId && debate.adjudicators.chairId !== adjudicator.id) {
                coJudges.push({
                  id: debate.adjudicators.chairId,
                  name: debate.adjudicators.chairName || "Chair",
                  role: "Chair",
                });
              }
              debate.adjudicators?.panellistIds?.forEach((pid, idx) => {
                if (pid !== adjudicator.id) {
                  coJudges.push({
                    id: pid,
                    name: debate.adjudicators?.panellistNames?.[idx] || "Panellist",
                    role: "Panellist",
                  });
                }
              });
              debate.adjudicators?.traineeIds?.forEach((tid, idx) => {
                if (tid !== adjudicator.id) {
                  coJudges.push({
                    id: tid,
                    name: debate.adjudicators?.traineeNames?.[idx] || "Trainee",
                    role: "Trainee",
                  });
                }
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
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase ${
                          isChair
                            ? "bg-blue-100 text-blue-800 border border-blue-300"
                            : isPanellist
                            ? "bg-purple-100 text-purple-800 border border-purple-300"
                            : "bg-amber-100 text-amber-800 border border-amber-300"
                        }`}
                      >
                        Your Role: {roleLabel}
                      </span>

                      {existingBallot?.confirmed ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 uppercase">
                          Ballot Confirmed ✓
                        </span>
                      ) : existingBallot ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 uppercase">
                          Ballot Draft
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-300 uppercase">
                          Ballot Pending
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
                        Motion will be announced by the Adjudication Core.
                      </div>
                    )}

                    {/* Matchup & Teams in Debate */}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                        Teams & Positions
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                        {isBP ? (
                          <>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">OG &bull; Opening Gov</span>
                              <span className="font-bold text-gray-900">{debate.teams.OG?.teamName || "TBD"}</span>
                            </div>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">OO &bull; Opening Opp</span>
                              <span className="font-bold text-gray-900">{debate.teams.OO?.teamName || "TBD"}</span>
                            </div>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">CG &bull; Closing Gov</span>
                              <span className="font-bold text-gray-900">{debate.teams.CG?.teamName || "TBD"}</span>
                            </div>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">CO &bull; Closing Opp</span>
                              <span className="font-bold text-gray-900">{debate.teams.CO?.teamName || "TBD"}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">AFF &bull; Affirmative</span>
                              <span className="font-bold text-gray-900">{debate.teams.AFF?.teamName || "TBD"}</span>
                            </div>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">NEG &bull; Negative</span>
                              <span className="font-bold text-gray-900">{debate.teams.NEG?.teamName || "TBD"}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Section: Action 1 - Ballot Entry */}
                    <div className="pt-2 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <span className="text-xs font-bold text-gray-800 flex items-center space-x-1.5">
                          <FileCheck2 className="w-4 h-4 text-blue-600" />
                          <span>Debate Ballot Entry</span>
                        </span>
                        <p className="text-[11px] text-gray-500">
                          {isChair
                            ? "As Chair, you are responsible for entering the official panel decision and scores."
                            : "Voting panellists and chairs can enter or verify ballot scores."}
                        </p>
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => handleOpenBallotModal(debate)}
                          className="px-3.5 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700 transition flex items-center space-x-1.5 shadow-2xs"
                        >
                          <FileCheck2 className="w-3.5 h-3.5" />
                          <span>{existingBallot?.confirmed ? "Edit / Re-enter Ballot" : "Enter Ballot"}</span>
                        </button>
                        <Link
                          href={`/${tournamentSlug}/results/${debate.roundSeq}/${debate.id}`}
                          className="px-2.5 py-1.5 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 rounded-md text-xs font-medium transition"
                          title="Open in full tabroom ballot form"
                        >
                          Full Form
                        </Link>
                      </div>
                    </div>

                    {/* Section: Action 2 - Adjudicator Feedback */}
                    {feedbackEnabled && (
                      <div className="pt-3 border-t border-gray-100 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-800 flex items-center space-x-1.5">
                            <MessageSquareHeart className="w-4 h-4 text-pink-600" />
                            <span>Submit Feedback on Other Adjudicators</span>
                          </span>
                          <span className="text-[10px] text-gray-500 font-mono">
                            Scale: {minFeedbackScore}–{maxFeedbackScore}
                          </span>
                        </div>

                        {coJudges.length === 0 ? (
                          <p className="text-[11px] text-gray-500 italic">
                            No other adjudicators on this panel (solo adjudication).
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {coJudges.map((target) => {
                              const submitted = hasSubmittedFeedback(target.id, debate.id);
                              const pastFb = getSubmittedFeedback(target.id, debate.id);

                              return (
                                <div
                                  key={target.id}
                                  className="p-3 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-between gap-2"
                                >
                                  <div>
                                    <span className="font-bold text-gray-900 text-xs block">{target.name}</span>
                                    <span className="text-[10px] text-gray-500 font-medium">{target.role}</span>
                                  </div>

                                  {submitted ? (
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded flex items-center space-x-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      <span>Done ({pastFb?.score})</span>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenFeedbackModal(target, debate)}
                                      className="px-2.5 py-1 bg-white border border-pink-300 text-pink-700 hover:bg-pink-50 rounded text-xs font-semibold transition"
                                    >
                                      Rate
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
                <h3 className="font-bold text-gray-900 text-sm">Submit Adjudicator Feedback</h3>
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
              <div className="p-2.5 rounded bg-gray-50 border border-gray-200">
                <span className="text-[10px] text-gray-500 font-bold uppercase block">Target Adjudicator</span>
                <span className="text-sm font-bold text-gray-900">{feedbackTargetAdjName}</span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-gray-700">
                    Feedback Score ({minFeedbackScore}–{maxFeedbackScore})
                  </label>
                  <span className="text-sm font-bold text-blue-600">{feedbackScore} / {maxFeedbackScore}</span>
                </div>
                <input
                  type="range"
                  min={minFeedbackScore}
                  max={maxFeedbackScore}
                  step={1}
                  value={feedbackScore}
                  onChange={(e) => setFeedbackScore(parseInt(e.target.value, 10))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>

              <div>
                <label className="font-semibold text-gray-700 block mb-1.5">
                  Did you agree with this adjudicator&apos;s decision/contribution?
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
                  Constructive Feedback & Notes (Confidential to Adjudication Core)
                </label>
                <textarea
                  rows={3}
                  value={feedbackComments}
                  onChange={(e) => setFeedbackComments(e.target.value)}
                  placeholder="Detail tracking of arguments, clarity of oral adjudication, engagement..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                  className="px-4 py-1.5 bg-pink-600 text-white rounded-md font-semibold hover:bg-pink-700 transition disabled:opacity-50"
                >
                  {feedbackSubmitting ? "Submitting..." : "Submit Feedback"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* IN-PORTAL BALLOT ENTRY MODAL */}
      {showBallotModal && ballotDebate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-2xs overflow-y-auto">
          <div className="bg-white rounded-xl max-w-2xl w-full my-8 p-6 shadow-xl border border-gray-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-bold text-gray-900 text-base flex items-center space-x-2">
                  <FileCheck2 className="w-5 h-5 text-blue-600" />
                  <span>Enter Debate Ballot &bull; {ballotDebate.venueName}</span>
                </h3>
                <p className="text-[11px] text-gray-500">
                  Submit panel ranking and speaker scores directly from your private adjudicator portal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBallotModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {ballotError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{ballotError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitBallotFromPortal} className="space-y-5 text-xs">
              {(isBP ? (["OG", "OO", "CG", "CO"] as DebateSide[]) : (["AFF", "NEG"] as DebateSide[])).map((side) => {
                const teamSlot = ballotDebate.teams[side];
                const spks = ballotScores[side] || [];
                const reply = ballotReplyScores[side];
                const rank = ballotRanks[side] || 1;

                return (
                  <div key={side} className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                    <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-xs bg-white px-2 py-0.5 rounded border border-gray-300">
                          {side}
                        </span>
                        <span className="font-bold text-gray-900 text-sm">
                          {teamSlot?.teamName || "Unassigned"}
                        </span>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <label className="text-[11px] font-semibold text-gray-600">Rank / Place:</label>
                        <select
                          value={rank}
                          onChange={(e) =>
                            setBallotRanks((prev) => ({
                              ...prev,
                              [side]: parseInt(e.target.value, 10),
                            }))
                          }
                          className="bg-white border border-gray-300 rounded px-2 py-1 font-bold text-xs"
                        >
                          {isBP ? (
                            <>
                              <option value={1}>1st Place (3 pts)</option>
                              <option value={2}>2nd Place (2 pts)</option>
                              <option value={3}>3rd Place (1 pt)</option>
                              <option value={4}>4th Place (0 pts)</option>
                            </>
                          ) : (
                            <>
                              <option value={1}>1st - Win (1 pt)</option>
                              <option value={2}>2nd - Loss (0 pts)</option>
                            </>
                          )}
                        </select>
                      </div>
                    </div>

                    {/* Speaker scores inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {spks.map((spk, idx) => (
                        <div key={idx} className="bg-white p-2 rounded border border-gray-200 flex items-center justify-between gap-2">
                          <span className="font-semibold text-gray-800 truncate text-[11px]">
                            {spk.speakerName} (Spk {idx + 1})
                          </span>
                          <input
                            type="number"
                            step={tournament?.preferences?.stepSpeakerScore || 1}
                            value={spk.score}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setBallotScores((prev) => ({
                                ...prev,
                                [side]: prev[side].map((s, i) => (i === idx ? { ...s, score: val } : s)),
                              }));
                            }}
                            className="w-16 border border-gray-300 rounded px-2 py-1 text-xs font-mono font-bold text-center"
                          />
                        </div>
                      ))}

                      {replyEnabled && reply && (
                        <div className="bg-amber-50 p-2 rounded border border-amber-200 flex items-center justify-between gap-2">
                          <span className="font-semibold text-amber-900 truncate text-[11px]">
                            Reply Speech
                          </span>
                          <input
                            type="number"
                            step={0.5}
                            value={reply.score}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setBallotReplyScores((prev) => ({
                                ...prev,
                                [side]: { ...prev[side], score: val },
                              }));
                            }}
                            className="w-16 border border-amber-300 rounded px-2 py-1 text-xs font-mono font-bold text-center bg-white"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-[11px] text-gray-500">
                  Submitting will mark this ballot confirmed by {adjudicator.name}.
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setShowBallotModal(false)}
                    className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={ballotSubmitting}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {ballotSubmitting ? "Submitting Ballot..." : "Submit Ballot"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
