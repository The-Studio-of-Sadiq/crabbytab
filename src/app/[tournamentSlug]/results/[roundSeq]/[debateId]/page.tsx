"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { useAuth } from "@/contexts/AuthContext";
import { SideBadge } from "@/components/ui/SideBadge";
import {
  FileCheck2,
  CheckCircle2,
  ArrowLeft,
  Save,
  AlertTriangle,
  Lightbulb,
  MapPin,
  Users,
  GitCompare,
  Check,
} from "lucide-react";
import { BallotSubmission, DebateSide, Team } from "@/types";
import {
  validateSpeakerScore,
  validateReplyScore,
  assignTwoTeamRank,
  hasUniqueTeamRanks,
} from "@/lib/scoring/validator";

export default function BallotEntryPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentSlug = params.tournamentSlug as string;
  const roundSeq = parseInt(params.roundSeq as string, 10);
  const debateId = params.debateId as string;

  const { user } = useAuth();
  const {
    tournament,
    debates,
    rounds,
    teams,
    motions,
    ballots,
    submitBallot,
  } = useTournament();

  const debate = debates.find((d) => d.id === debateId);
  const round = rounds.find((r) => r.seq === roundSeq);
  const isBP = tournament?.format === "bp";
  const replyEnabled = Boolean(tournament?.preferences?.replyScoresEnabled && !isBP);
  const isDoubleEntryEnabled = Boolean(tournament?.preferences?.ballotDoubleEntry);

  // All ballots for this debate
  const debateBallots = ballots.filter((b) => b.debateId === debateId && !b.discarded);
  const draftBallot = debateBallots.find((b) => !b.confirmed);
  const confirmedBallot = debateBallots.find((b) => b.confirmed);

  // Active ballot to display or edit
  const existingBallot = draftBallot || confirmedBallot;

  // Form State
  const [selectedMotionId, setSelectedMotionId] = useState<string>(
    existingBallot?.motionId || debate?.motionId || ""
  );

  // Substantive speaker scores: { side: [{ speakerId, speakerName, score }] }
  const [scores, setScores] = useState<
    Record<string, { speakerId: string; speakerName: string; score: number }[]>
  >({});

  // Reply speaker scores: { side: { speakerId, speakerName, score } }
  const [replyScores, setReplyScores] = useState<
    Record<string, { speakerId: string; speakerName: string; score: number }>
  >({});

  const [ranks, setRanks] = useState<Record<string, number>>({});
  const [isConfirmed, setIsConfirmed] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [scoreErrors, setScoreErrors] = useState<Record<string, string>>({});

  // Diff Resolution State for Double Entry
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [diffFields, setDiffFields] = useState<
    { field: string; val1: any; val2: any; choice: 1 | 2 }[]
  >([]);
  const [pendingCandidateBallot, setPendingCandidateBallot] =
    useState<BallotSubmission | null>(null);

  const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];
  const teamsMap = new Map<string, Team>();
  teams.forEach((t) => teamsMap.set(t.id, t));

  // Initialize scores and ranks from existing ballot or defaults
  useEffect(() => {
    if (!debate) return;

    const initialScores: Record<string, any[]> = {};
    const initialReplyScores: Record<string, any> = {};
    const initialRanks: Record<string, number> = {};

    sides.forEach((side, idx) => {
      const teamSlot = debate.teams[side];
      const team = teamSlot ? teamsMap.get(teamSlot.teamId) : null;
      const existingTeamScore = existingBallot?.teamScores?.[side];
      const existingSpeakerScores = existingBallot?.speakerScores?.[side];

      if (existingTeamScore) {
        initialRanks[side] =
          existingTeamScore.rank ||
          (isBP ? 4 - existingTeamScore.points : existingTeamScore.win ? 1 : 2);
      } else {
        initialRanks[side] = idx + 1;
      }

      const numSubstantive =
        tournament?.preferences?.substantiveSpeakers || (isBP ? 2 : 3);

      if (existingSpeakerScores && existingSpeakerScores.length > 0) {
        const substantive = existingSpeakerScores.filter((s) => s.position <= numSubstantive);
        initialScores[side] = substantive;

        const reply = existingSpeakerScores.find((s) => s.position === 4);
        if (reply) {
          initialReplyScores[side] = {
            speakerId: reply.speakerId,
            speakerName: reply.speakerName,
            score: reply.score,
          };
        } else if (replyEnabled) {
          const spk = team?.speakers?.[0]; // Default reply speaker to 1st or 2nd speaker
          initialReplyScores[side] = {
            speakerId: spk?.id || `reply-${side}`,
            speakerName: spk?.name || `${teamSlot?.teamName || side} Reply`,
            score: 38,
          };
        }
      } else {
        const defaultScores = [];
        for (let pos = 1; pos <= numSubstantive; pos++) {
          const spk = team?.speakers?.[pos - 1];
          defaultScores.push({
            speakerId: spk?.id || `spk-${side}-${pos}`,
            speakerName: spk?.name || `${teamSlot?.teamName || side} Speaker ${pos}`,
            score: 75,
          });
        }
        initialScores[side] = defaultScores;

        if (replyEnabled) {
          const replySpk = team?.speakers?.[0];
          initialReplyScores[side] = {
            speakerId: replySpk?.id || `reply-${side}`,
            speakerName: replySpk?.name || `${teamSlot?.teamName || side} Reply`,
            score: 38,
          };
        }
      }
    });

    if (!isBP && !hasUniqueTeamRanks(initialRanks, sides)) {
      initialRanks[sides[1]] = initialRanks[sides[0]] === 1 ? 2 : 1;
    }

    setScores(initialScores);
    setReplyScores(initialReplyScores);
    setRanks(initialRanks);
  }, [debate, existingBallot, isBP, replyEnabled, tournament?.preferences?.substantiveSpeakers]);

  if (!debate) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500">Debate not found.</p>
        <button
          onClick={() => router.back()}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-xs font-semibold"
        >
          Go Back
        </button>
      </div>
    );
  }

  if (debate.byeTeamId) {
    const byeTeam = Object.values(debate.teams).find((slot) => slot?.teamId === debate.byeTeamId);
    return (
      <div className="max-w-4xl mx-auto space-y-6 pb-12">
        <button
          onClick={() => router.push(`/${tournamentSlug}/results`)}
          className="inline-flex items-center space-x-1 text-xs font-semibold text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Results Overview</span>
        </button>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-6">
          <h2 className="text-lg font-bold text-gray-900">Bye — no ballot required</h2>
          <p className="mt-2 text-sm text-gray-700">
            {byeTeam?.teamName || "Team"}: {debate.byeResult === "win"
              ? "full win awarded with prior average speaker scores."
              : "absent; no standings result is added."}
          </p>
        </div>
      </div>
    );
  }

  const handleScoreChange = (side: string, index: number, value: number) => {
    const updated = { ...scores };
    if (!updated[side]) updated[side] = [];
    updated[side][index] = {
      ...updated[side][index],
      score: value,
    };
    setScores(updated);

    // Validate score immediately
    const check = validateSpeakerScore(value, tournament?.preferences);
    setScoreErrors((prev) => {
      const copy = { ...prev };
      const key = `${side}-${index}`;
      if (!check.valid && check.error) {
        copy[key] = check.error;
      } else {
        delete copy[key];
      }
      return copy;
    });
  };

  const handleReplyScoreChange = (side: string, value: number) => {
    const current = replyScores[side] || {
      speakerId: `reply-${side}`,
      speakerName: "Reply Speaker",
      score: 38,
    };
    setReplyScores({
      ...replyScores,
      [side]: { ...current, score: value },
    });

    const check = validateReplyScore(value, tournament?.preferences);
    setScoreErrors((prev) => {
      const copy = { ...prev };
      const key = `${side}-reply`;
      if (!check.valid && check.error) {
        copy[key] = check.error;
      } else {
        delete copy[key];
      }
      return copy;
    });
  };

  const handleReplySpeakerChange = (side: string, speakerId: string) => {
    const teamSlot = debate.teams[side as DebateSide];
    const team = teamSlot ? teamsMap.get(teamSlot.teamId) : null;
    const spk = team?.speakers?.find((s) => s.id === speakerId);
    const current = replyScores[side] || {
      speakerId,
      speakerName: spk?.name || "Reply Speaker",
      score: 38,
    };
    setReplyScores({
      ...replyScores,
      [side]: {
        ...current,
        speakerId,
        speakerName: spk?.name || current.speakerName,
      },
    });
  };

  const handleRankChange = (side: string, rank: number) => {
    setRanks((prev) => isBP
      ? { ...prev, [side]: rank }
      : assignTwoTeamRank(prev, side, rank, sides));
  };

  const calculateTeamTotal = (side: string) => {
    const substantive = (scores[side] || []).reduce((sum, spk) => sum + (spk?.score || 0), 0);
    const reply = replyEnabled ? replyScores[side]?.score || 0 : 0;
    return substantive + reply;
  };

  const validateAllScores = (): boolean => {
    const errors: Record<string, string> = {};

    sides.forEach((side) => {
      const spkScores = scores[side] || [];
      spkScores.forEach((s, idx) => {
        const check = validateSpeakerScore(s.score, tournament?.preferences);
        if (!check.valid && check.error) {
          errors[`${side}-${idx}`] = check.error;
        }
      });

      if (replyEnabled && replyScores[side]) {
        const check = validateReplyScore(replyScores[side].score, tournament?.preferences);
        if (!check.valid && check.error) {
          errors[`${side}-reply`] = check.error;
        }
      }
    });

    setScoreErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    // 1. Validate unique outcomes for each format
    if (!hasUniqueTeamRanks(ranks, sides)) {
      setErrorMessage(isBP
        ? "Each team in a BP debate must be assigned a unique rank from 1st to 4th."
        : "One team must win and the other must lose.");
      return;
    }

    // 2. Validate all score inputs
    if (!validateAllScores()) {
      setErrorMessage("Please fix invalid speaker scores before saving the ballot.");
      return;
    }

    setIsSubmitting(true);
    try {
      const speakerScoresRecord: Record<DebateSide, any[]> = {} as any;
      const teamScoresRecord: Record<DebateSide, any> = {} as any;

      sides.forEach((side) => {
        const teamSlot = debate.teams[side];
        const spkScores = scores[side] || [];
        const replyEntry = replyEnabled && replyScores[side] ? replyScores[side] : null;

        const allSpkList = spkScores.map((s, pos) => ({
          speakerId: s.speakerId,
          speakerName: s.speakerName,
          position: pos + 1,
          score: s.score,
        }));

        if (replyEntry) {
          allSpkList.push({
            speakerId: replyEntry.speakerId,
            speakerName: replyEntry.speakerName,
            position: 4,
            score: replyEntry.score,
          });
        }

        speakerScoresRecord[side] = allSpkList;

        const includeGhosts = tournament?.preferences?.teamScoreIncludesGhosts ?? false;
        let substantiveList = scores[side] || [];
        if (!includeGhosts) {
          const seenSpeakerIds = new Set<string>();
          substantiveList = substantiveList.filter((spk) => {
            if (!spk.speakerId) return true;
            if (seenSpeakerIds.has(spk.speakerId)) return false;
            seenSpeakerIds.add(spk.speakerId);
            return true;
          });
        }
        const substantiveTotal = substantiveList.reduce((sum, s) => sum + (s.score || 0), 0);
        const replyTotal = replyEnabled && replyScores[side] ? replyScores[side].score || 0 : 0;
        const total = substantiveTotal + replyTotal;
        const rank = ranks[side] || 1;
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

      const motionObj = motions.find((m) => m.id === selectedMotionId);
      const candidateVersion = (existingBallot?.version || 0) + 1;

      // S3: Double-entry check
      if (isDoubleEntryEnabled) {
        if (!existingBallot) {
          // First entry: Save as draft (version 1)
          const firstBallot: BallotSubmission = {
            id: `ballot-${debate.id}-v1`,
            tournamentId: tournament?.id || tournamentSlug,
            roundId: debate.roundId,
            debateId: debate.id,
            version: 1,
            confirmed: false,
            discarded: false,
            submitterType: "tabroom",
            submitterId: user?.uid || "staff-user",
            submitterName: user?.email || "Tab Staff",
            motionId: selectedMotionId,
            motionText: motionObj?.text || debate.motionText,
            speakerScores: speakerScoresRecord,
            teamScores: teamScoresRecord,
            chairId: debate.adjudicators?.chairId,
            timestamp: new Date().toISOString(),
          };

          await submitBallot(firstBallot);
          router.push(`/${tournamentSlug}/results`);
          return;
        }

        // Second entry: compare against existing draft ballot
        const diffs: { field: string; val1: any; val2: any; choice: 1 | 2 }[] = [];

        // Check motion difference
        if (existingBallot.motionId !== selectedMotionId) {
          diffs.push({
            field: "Motion",
            val1: existingBallot.motionText || existingBallot.motionId || "None",
            val2: motionObj?.text || selectedMotionId || "None",
            choice: 2,
          });
        }

        // Check team ranks / scores differences
        sides.forEach((side) => {
          const t1 = existingBallot.teamScores?.[side];
          const t2 = teamScoresRecord[side];
          if (t1 && t2 && t1.rank !== t2.rank) {
            diffs.push({
              field: `${side} Rank / Result`,
              val1: `${t1.rank} (${t1.points} pts)`,
              val2: `${t2.rank} (${t2.points} pts)`,
              choice: 2,
            });
          }

          const spks1 = existingBallot.speakerScores?.[side] || [];
          const spks2 = speakerScoresRecord[side] || [];
          spks2.forEach((s2, pos) => {
            const s1 = spks1[pos];
            if (s1 && s1.score !== s2.score) {
              diffs.push({
                field: `${side} ${s2.speakerName} (Pos ${s2.position}) Score`,
                val1: s1.score,
                val2: s2.score,
                choice: 2,
              });
            }
          });
        });

        const secondBallot: BallotSubmission = {
          id: `ballot-${debate.id}-v${candidateVersion}`,
          tournamentId: tournament?.id || tournamentSlug,
          roundId: debate.roundId,
          debateId: debate.id,
          version: candidateVersion,
          confirmed: true,
          discarded: false,
          submitterType: "tabroom",
          submitterId: user?.uid || "staff-user-2",
          submitterName: user?.email || "Second Verifier",
          motionId: selectedMotionId,
          motionText: motionObj?.text || debate.motionText,
          speakerScores: speakerScoresRecord,
          teamScores: teamScoresRecord,
          chairId: debate.adjudicators?.chairId,
          timestamp: new Date().toISOString(),
          confirmedBy: user?.email || "Tab Director",
          confirmedTimestamp: new Date().toISOString(),
        };

        if (diffs.length > 0) {
          // Fields differ: present diff resolution modal
          setDiffFields(diffs);
          setPendingCandidateBallot(secondBallot);
          setShowDiffModal(true);
          return;
        }

        // No differences: confirm candidate ballot
        await submitBallot(secondBallot);
        router.push(`/${tournamentSlug}/results`);
        return;
      }

      // Standard Single-Entry submission
      const ballotPayload: BallotSubmission = {
        id: existingBallot?.id || `ballot-${debate.id}-v1`,
        tournamentId: tournament?.id || tournamentSlug,
        roundId: debate.roundId,
        debateId: debate.id,
        version: candidateVersion,
        confirmed: isConfirmed,
        discarded: false,
        submitterType: "tabroom",
        submitterId: user?.uid || "staff-user",
        submitterName: user?.email || "Tab Official",
        motionId: selectedMotionId,
        motionText: motionObj?.text || debate.motionText,
        speakerScores: speakerScoresRecord,
        teamScores: teamScoresRecord,
        chairId: debate.adjudicators?.chairId,
        timestamp: new Date().toISOString(),
        confirmedBy: isConfirmed ? user?.email || "Tab Director" : undefined,
        confirmedTimestamp: isConfirmed ? new Date().toISOString() : undefined,
      };

      await submitBallot(ballotPayload);
      router.push(`/${tournamentSlug}/results`);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to submit ballot.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResolveDiffAndConfirm = async () => {
    if (!pendingCandidateBallot || !existingBallot) return;
    setIsSubmitting(true);
    try {
      // Picked candidate ballot as base
      const finalConfirmedBallot: BallotSubmission = {
        ...pendingCandidateBallot,
        confirmed: true,
        confirmedBy: user?.email || "Tab Director",
        confirmedTimestamp: new Date().toISOString(),
      };

      await submitBallot(finalConfirmedBallot);
      setShowDiffModal(false);
      router.push(`/${tournamentSlug}/results`);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to confirm resolved ballot.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSameUserWarning =
    isDoubleEntryEnabled &&
    existingBallot &&
    user?.uid &&
    existingBallot.submitterId === user.uid;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top Breadcrumb */}
      <div className="flex items-center justify-between border-b border-[#d0d7de] pb-3">
        <button
          onClick={() => router.push(`/${tournamentSlug}/results`)}
          className="inline-flex items-center space-x-1 text-xs font-semibold text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Results Overview</span>
        </button>

        <span className="text-xs text-gray-500 font-semibold">
          {round?.name} &bull; {debate.venueName}
        </span>
      </div>

      {/* Main Ballot Card */}
      <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
        {/* Header */}
        <div className="bg-[#f6f8fa] p-4 border-b border-[#d0d7de]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center space-x-2">
                <FileCheck2 className="w-5 h-5 text-blue-600" />
                <span>Debate Ballot Entry</span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Venue: <span className="font-bold text-gray-800">{debate.venueName}</span> &bull; Chair:{" "}
                <span className="font-bold text-gray-800">
                  {debate.adjudicators?.chairName || "Unassigned"}
                </span>
              </p>
            </div>

            <div className="flex items-center space-x-2">
              {isDoubleEntryEnabled && existingBallot && !existingBallot.confirmed && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-300 uppercase">
                  Double-Entry Mode (Pass 2 of 2)
                </span>
              )}
              {isDoubleEntryEnabled && !existingBallot && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 uppercase">
                  Double-Entry Mode (Pass 1 of 2)
                </span>
              )}
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                  existingBallot?.confirmed
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : "bg-amber-100 text-amber-800 border border-amber-300"
                }`}
              >
                {existingBallot?.confirmed ? "Confirmed Ballot" : "Draft Ballot"}
              </span>
            </div>
          </div>
        </div>

        {/* Warning if second entry is by the same user */}
        {isSameUserWarning && (
          <div className="m-4 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              <strong>Notice:</strong> You entered the first draft of this ballot. Double entry
              recommends a different user enter the second verification pass, but you may proceed.
            </span>
          </div>
        )}

        {errorMessage && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-5 space-y-6">
          {/* Ballot Introduction / Explanation */}
          {tournament?.preferences?.ballotIntroExplanation?.trim() && (
            <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-md text-xs text-blue-900 leading-relaxed space-y-1">
              <div className="font-bold text-blue-950 flex items-center space-x-1.5">
                <FileCheck2 className="w-3.5 h-3.5 text-blue-600" />
                <span>Ballot Introduction & Instructions</span>
              </div>
              <div className="whitespace-pre-line text-[11px] text-blue-900">
                {tournament.preferences.ballotIntroExplanation}
              </div>
            </div>
          )}

          {/* Motion Selector */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center space-x-1.5">
              <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
              <span>Motion Debated</span>
            </label>
            <select
              value={selectedMotionId}
              onChange={(e) => setSelectedMotionId(e.target.value)}
              className="w-full text-xs border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            >
              <option value="">-- Select Motion --</option>
              {motions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.reference ? `${m.reference}: ` : ""}&ldquo;{m.text}&rdquo;
                </option>
              ))}
            </select>
          </div>

          {/* Teams and Speaker Scores */}
          <div className="space-y-5">
            {sides.map((side) => {
              const teamSlot = debate.teams[side];
              const team = teamSlot ? teamsMap.get(teamSlot.teamId) : null;
              const sideScores = scores[side] || [];
              const teamTotal = calculateTeamTotal(side);
              const rank = ranks[side] || 1;
              const reply = replyScores[side];

              return (
                <div
                  key={side}
                  className="border border-gray-200 rounded-lg p-4 bg-gray-50/50 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-200 pb-2">
                    <div className="flex items-center space-x-2">
                      <SideBadge side={side} />
                      <span className="font-bold text-gray-900 text-sm">
                        {teamSlot?.teamName || "Unassigned Team"}
                      </span>
                    </div>

                    {/* Rank / Win Selector */}
                    <div className="flex items-center space-x-2">
                      <label className="text-xs font-semibold text-gray-600">
                        {isBP ? "Rank:" : "Result:"}
                      </label>
                      {isBP ? (
                        <select
                          value={rank}
                          onChange={(e) => handleRankChange(side, parseInt(e.target.value, 10))}
                          className="bg-white border border-gray-300 rounded px-2.5 py-1 text-xs font-bold text-gray-900"
                        >
                          <option value={1}>1st Place (3 pts)</option>
                          <option value={2}>2nd Place (2 pts)</option>
                          <option value={3}>3rd Place (1 pt)</option>
                          <option value={4}>4th Place (0 pts)</option>
                        </select>
                      ) : (
                        <select
                          value={rank}
                          onChange={(e) => handleRankChange(side, parseInt(e.target.value, 10))}
                          className="bg-white border border-gray-300 rounded px-2.5 py-1 text-xs font-bold text-gray-900"
                        >
                          <option value={1}>Win (1 pt)</option>
                          <option value={2}>Loss (0 pts)</option>
                        </select>
                      )}
                    </div>
                  </div>

                  {/* Substantive Speaker Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {sideScores.map((spk, pos) => {
                      const errKey = `${side}-${pos}`;
                      const hasErr = Boolean(scoreErrors[errKey]);

                      return (
                        <div
                          key={pos}
                          className={`bg-white border rounded p-2.5 flex flex-col justify-between transition ${
                            hasErr ? "border-red-400 bg-red-50/20" : "border-gray-200"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                                Speaker {pos + 1}
                              </span>
                              <span className="text-xs font-semibold text-gray-800">
                                {spk.speakerName}
                              </span>
                            </div>
                            <div className="flex items-center space-x-1.5">
                              <label className="text-xs font-medium text-gray-500">Score:</label>
                              <input
                                type="number"
                                step={tournament?.preferences?.stepSpeakerScore ?? 1}
                                min={tournament?.preferences?.minSpeakerScore ?? 68}
                                max={tournament?.preferences?.maxSpeakerScore ?? 84}
                                value={spk.score}
                                onChange={(e) =>
                                  handleScoreChange(side, pos, parseFloat(e.target.value) || 0)
                                }
                                className={`w-16 border rounded px-2 py-1 text-xs font-bold font-mono text-center focus:outline-none focus:ring-2 ${
                                  hasErr
                                    ? "border-red-500 focus:ring-red-400 bg-red-50"
                                    : "border-gray-300 focus:ring-blue-500"
                                }`}
                              />
                            </div>
                          </div>
                          {hasErr && (
                            <span className="text-[10px] text-red-600 mt-1 font-medium">
                              {scoreErrors[errKey]}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* S4: Reply Speech Input (Two-team formats when replyScoresEnabled) */}
                  {replyEnabled && reply && (
                    <div
                      className={`bg-indigo-50/50 border rounded p-2.5 flex flex-col justify-between transition ${
                        scoreErrors[`${side}-reply`] ? "border-red-400" : "border-indigo-200"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded uppercase tracking-wider">
                            Reply Speech
                          </span>
                          <select
                            value={reply.speakerId}
                            onChange={(e) => handleReplySpeakerChange(side, e.target.value)}
                            className="text-xs font-semibold bg-white border border-indigo-200 rounded px-2 py-1"
                          >
                            {(team?.speakers || []).map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} (Reply)
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <label className="text-xs font-medium text-gray-600">Reply Score:</label>
                          <input
                            type="number"
                            step={(tournament?.preferences?.stepSpeakerScore ?? 1) / 2}
                            min={tournament?.preferences?.minReplyScore ?? 34}
                            max={tournament?.preferences?.maxReplyScore ?? 42}
                            value={reply.score}
                            onChange={(e) =>
                              handleReplyScoreChange(side, parseFloat(e.target.value) || 0)
                            }
                            className={`w-16 border rounded px-2 py-1 text-xs font-bold font-mono text-center focus:outline-none focus:ring-2 ${
                              scoreErrors[`${side}-reply`]
                                ? "border-red-500 bg-red-50 focus:ring-red-400"
                                : "border-indigo-300 focus:ring-indigo-500"
                            }`}
                          />
                        </div>
                      </div>
                      {scoreErrors[`${side}-reply`] && (
                        <span className="text-[10px] text-red-600 mt-1 font-medium">
                          {scoreErrors[`${side}-reply`]}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Team Total Calculation */}
                  <div className="flex justify-end text-xs font-semibold text-gray-700 pt-1">
                    <span>Total Team Speaker Score: </span>
                    <span className="font-bold text-gray-900 font-mono ml-1.5">{teamTotal}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Official Confirmation Checkbox (When double entry is off) */}
          {!isDoubleEntryEnabled && (
            <div className="pt-3 border-t border-gray-200 flex items-center justify-between">
              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isConfirmed}
                  onChange={(e) => setIsConfirmed(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                />
                <span className="text-xs font-bold text-gray-800">
                  Confirm this ballot as official tab room record
                </span>
              </label>

              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => router.push(`/${tournamentSlug}/results`)}
                  className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded shadow-xs transition disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? "Saving..." : "Save Ballot"}</span>
                </button>
              </div>
            </div>
          )}

          {/* Double Entry Submission Actions */}
          {isDoubleEntryEnabled && (
            <div className="pt-3 border-t border-gray-200 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {!existingBallot
                  ? "Double entry required: saving will create Pass 1 (Draft)."
                  : "Double entry pass 2: saving will compare and confirm."}
              </span>

              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => router.push(`/${tournamentSlug}/results`)}
                  className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded shadow-xs transition disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>
                    {!existingBallot ? "Save Draft (Pass 1)" : "Verify & Confirm (Pass 2)"}
                  </span>
                </button>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* S3: Diff Resolution Modal */}
      {showDiffModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 space-y-4">
            <div className="flex items-center space-x-2 text-amber-600 border-b border-gray-100 pb-3">
              <GitCompare className="w-5 h-5" />
              <h3 className="text-base font-bold text-gray-900">
                Double Entry Conflict Resolution
              </h3>
            </div>

            <p className="text-xs text-gray-600">
              The second ballot entry differs from the first draft. Review the field differences
              below and confirm which version to officially record in the tab:
            </p>

            <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
              <table className="w-full text-left">
                <thead className="bg-gray-100 text-gray-700">
                  <tr>
                    <th className="p-2.5 font-bold">Field</th>
                    <th className="p-2.5 font-bold">First Entry (Pass 1)</th>
                    <th className="p-2.5 font-bold">Second Entry (Pass 2)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-mono">
                  {diffFields.map((d, idx) => (
                    <tr key={idx} className="hover:bg-amber-50/40">
                      <td className="p-2.5 font-sans font-semibold text-gray-900">{d.field}</td>
                      <td className="p-2.5 text-gray-700 bg-red-50/40">{String(d.val1)}</td>
                      <td className="p-2.5 text-gray-900 font-bold bg-emerald-50/40">
                        {String(d.val2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowDiffModal(false)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded"
              >
                Go Back & Adjust
              </button>
              <button
                type="button"
                onClick={handleResolveDiffAndConfirm}
                className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs"
              >
                <Check className="w-4 h-4" />
                <span>Confirm & Save Pass 2 Version</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
