"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { VenueLabel } from "@/features/tournament/components/VenueLabel";
import { useTournament } from "@/contexts/TournamentContext";
import { SelfCheckInPanel } from "@/features/tournament/components/SelfCheckInPanel";
import {
  FileCheck2,
  MessageSquareHeart,
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
  RefreshCw,
} from "lucide-react";
import { DebateSide, Debate, BallotSubmission, FeedbackAnswer, SpeakerScoreEntry } from "@/types";
import {
  applyScoreCriteria,
  ballotSides,
  buildBallotResult,
  effectiveRanks,
  substantiveSpeakerCount,
  usesSpeakerScores,
  validateBallotEntry,
  type BallotEntry,
} from "@/lib/ballots/result";
import { speakerRanksFor, winnerDeclarationFor } from "@/lib/ballots/ballotRules";
import { privateBallotRules } from "@/lib/privateBallot";
import { blankSpeeches } from "@/features/tournament/application/ballotEntry";
import { SpeechRows } from "@/features/tournament/components/ballot/SpeechRows";
import { sideLabel, translatedSideName } from "@/lib/sideNames";
import { arrangeDebateSides, isSidePermutation, sidesChosenOnBallot, sidesPending } from "@/lib/draw/manualSides";
import { validateFeedbackScore, defaultFeedbackScore, feedbackScoreStep } from "@/lib/scoring/validator";
import { FeedbackQuestionFields } from "@/components/feedback/FeedbackQuestionFields";
import {
  isFeedbackEnabledForRound,
  questionsForFeedbackSource,
  validateFeedbackAnswers,
} from "@/lib/feedback/questions";
import { feedbackPathsForRound, isFeedbackPathAllowed } from "@/lib/feedback/paths";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

type PanelRole = "chair" | "panellist" | "trainee";

export default function AdjudicatorPrivatePortalPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentSlug = params.tournamentSlug as string;
  const privateKey = params.key as string;

  const {
    tournament,
    loading,
    cloudLoadError,
    privateSyncState,
    privateSyncMessage,
    syncPrivatePortal,
    adjudicators,
    teams,
    rounds,
    activeRound,
    debates,
    venues,
    ballots,
    feedback,
    submitBallot,
    addFeedback,
  } = useTournament();
  const { t, plural, rich } = useI18n();

  // The URL key identifies the adjudicator; a separate passcode gates access.
  const adjudicator = useMemo(() => {
    return adjudicators.find((a) => a.privateUrlKey === privateKey);
  }, [adjudicators, privateKey]);

  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;
  const minFeedbackScore = tournament?.preferences?.feedbackMinScore ?? 1;
  const maxFeedbackScore = tournament?.preferences?.feedbackMaxScore ?? 10;
  const feedbackQuestions = questionsForFeedbackSource("adjudicator", tournament?.preferences);
  const isBP = tournament?.format === "bp";

  // Filter state
  const [selectedRoundTab, setSelectedRoundTab] = useState<string>("active");
  const [enteredPasscode, setEnteredPasscode] = useState("");
  const [activePasscode, setActivePasscode] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [passcodeError, setPasscodeError] = useState("");
  const [verifiedPasscodeFor, setVerifiedPasscodeFor] = useState("");
  const rememberedPasscodeAttemptedFor = useRef("");
  const syncPrivatePortalRef = useRef(syncPrivatePortal);
  syncPrivatePortalRef.current = syncPrivatePortal;
  const rememberedPasscodeKey = `crabbytab_adjudicator_passcode_${tournamentSlug}_${privateKey}`;

  useEffect(() => {
    if (
      loading ||
      !tournament ||
      typeof window === "undefined" ||
      rememberedPasscodeAttemptedFor.current === privateKey
    ) return;
    const remembered = localStorage.getItem(rememberedPasscodeKey);
    if (!remembered) return;
    rememberedPasscodeAttemptedFor.current = privateKey;
    void syncPrivatePortalRef.current(privateKey, remembered)
      .then(() => {
        setEnteredPasscode(remembered);
        setActivePasscode(remembered);
        setVerifiedPasscodeFor(privateKey);
        setRememberMe(true);
      })
      .catch((error) => {
        if (error instanceof Error && error.message === "Invalid adjudicator link or passcode.") {
          localStorage.removeItem(rememberedPasscodeKey);
        }
      });

  }, [loading, tournament, privateKey, rememberedPasscodeKey]);

  useEffect(() => {
    if (verifiedPasscodeFor !== privateKey || !activePasscode) return;
    const sync = () => {
      if (navigator.onLine) {
        void syncPrivatePortalRef.current(privateKey, activePasscode).catch((error) => {
          console.error("Could not sync adjudicator portal:", error);
        });
      }
    };
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [activePasscode, privateKey, verifiedPasscodeFor]);

  const handlePasscodeSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const passcode = enteredPasscode.trim();
    if (!passcode) {
      setPasscodeError(t("portal.passcodeMissing"));
      return;
    }
    setPasscodeError("");
    rememberedPasscodeAttemptedFor.current = privateKey;
    try {
      await syncPrivatePortal(privateKey, passcode);
      setActivePasscode(passcode);
      setVerifiedPasscodeFor(privateKey);
      if (rememberMe) {
        localStorage.setItem(rememberedPasscodeKey, passcode);
      } else {
        localStorage.removeItem(rememberedPasscodeKey);
      }
    } catch (error) {
      setPasscodeError(error instanceof Error ? error.message : t("portal.passcodeError"));
    }
  };

  // Feedback Modal State
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackTargetType, setFeedbackTargetType] = useState<"adjudicator" | "team">("adjudicator");
  const [feedbackTargetAdjId, setFeedbackTargetAdjId] = useState("");
  const [feedbackTargetAdjName, setFeedbackTargetAdjName] = useState("");
  const [feedbackTargetTeamId, setFeedbackTargetTeamId] = useState("");
  const [feedbackTargetTeamName, setFeedbackTargetTeamName] = useState("");
  const [feedbackDebateId, setFeedbackDebateId] = useState("");
  const [feedbackRoundId, setFeedbackRoundId] = useState("");
  const [feedbackScore, setFeedbackScore] = useState<number>(
    defaultFeedbackScore(tournament?.preferences)
  );
  const [feedbackAgree, setFeedbackAgree] = useState<boolean>(true);
  const [feedbackComments, setFeedbackComments] = useState("");
  const [feedbackAnswers, setFeedbackAnswers] = useState<Record<string, FeedbackAnswer>>({});
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSuccessNotice, setFeedbackSuccessNotice] = useState("");

  // In-portal Ballot Modal State
  const [showBallotModal, setShowBallotModal] = useState(false);
  const [ballotDebate, setBallotDebate] = useState<Debate | null>(null);
  /** Sides chosen on the ballot: the debate as drawn, and whether the chair has recorded the sides. */
  const [ballotDrawnDebate, setBallotDrawnDebate] = useState<Debate | null>(null);
  const [ballotSidesChosen, setBallotSidesChosen] = useState(true);
  const [ballotEntry, setBallotEntry] = useState<BallotEntry | null>(null);
  const [ballotMotionId, setBallotMotionId] = useState<string>("");
  const [ballotSubmitting, setBallotSubmitting] = useState(false);
  const [ballotError, setBallotError] = useState("");
  const [ballotSuccessNotice, setBallotSuccessNotice] = useState("");


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

  const hasSubmittedTeamFeedback = (targetId: string, debateId: string) => {
    if (!adjudicator) return false;
    return feedback.some(
      (item) =>
        item.sourceId === adjudicator.id &&
        item.targetType === "team" &&
        item.targetTeamId === targetId &&
        item.debateId === debateId
    );
  };

  const getSubmittedTeamFeedback = (targetId: string, debateId: string) => {
    if (!adjudicator) return null;
    return feedback.find(
      (item) =>
        item.sourceId === adjudicator.id &&
        item.targetType === "team" &&
        item.targetTeamId === targetId &&
        item.debateId === debateId
    );
  };

  // Open feedback modal pre-filled
  const handleOpenFeedbackModal = (targetAdj: { id: string; name: string }, debate: Debate) => {
    setFeedbackTargetType("adjudicator");
    setFeedbackTargetAdjId(targetAdj.id);
    setFeedbackTargetAdjName(targetAdj.name);
    setFeedbackDebateId(debate.id);
    setFeedbackRoundId(debate.roundId);
    setFeedbackScore(defaultFeedbackScore(tournament?.preferences));
    setFeedbackAgree(true);
    setFeedbackComments("");
    setFeedbackAnswers({});
    setFeedbackError("");
    setShowFeedbackModal(true);
  };

  const handleOpenTeamFeedbackModal = (targetTeam: { id: string; name: string }, debate: Debate) => {
    setFeedbackTargetType("team");
    setFeedbackTargetTeamId(targetTeam.id);
    setFeedbackTargetTeamName(targetTeam.name);
    setFeedbackDebateId(debate.id);
    setFeedbackRoundId(debate.roundId);
    setFeedbackScore(defaultFeedbackScore(tournament?.preferences));
    setFeedbackAgree(true);
    setFeedbackComments("");
    setFeedbackAnswers({});
    setFeedbackError("");
    setShowFeedbackModal(true);
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjudicator) return;
    setFeedbackError("");
    const answersError = validateFeedbackAnswers(feedbackQuestions, feedbackAnswers);
    if (answersError) {
      setFeedbackError(answersError);
      return;
    }

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
        targetType: feedbackTargetType,
        ...(feedbackTargetType === "adjudicator" ? {
          targetAdjudicatorId: feedbackTargetAdjId,
          targetAdjudicatorName: feedbackTargetAdjName,
        } : {
          targetTeamId: feedbackTargetTeamId,
          targetTeamName: feedbackTargetTeamName,
        }),
        sourceType: "adjudicator",
        sourceId: adjudicator.id,
        sourceName: adjudicator.name,
        score: feedbackScore,
        agreeWithDecision: feedbackAgree,
        comments: feedbackComments.trim(),
        answers: feedbackAnswers,
        confirmed: true,
      }, activePasscode, privateKey);
      setShowFeedbackModal(false);
      const targetName = feedbackTargetType === "adjudicator" ? feedbackTargetAdjName : feedbackTargetTeamName;
      setFeedbackSuccessNotice(t("portal.feedback.recorded", { target: targetName }));
      setTimeout(() => setFeedbackSuccessNotice(""), 5000);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : t("portal.feedback.failed"));
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // Open in-portal ballot modal
  const handleOpenBallotModal = (drawnDebate: Debate, chosenAffTeamId?: string) => {
    // Initialize from confirmed or draft ballot if exists
    const existingBallot = ballots.find((b) => b.debateId === drawnDebate.id && !b.discarded);
    // Sides chosen on the ballot: arrange the debate as the chair recorded it (or as an earlier
    // ballot / a confirmed result did); until then the chair must pick the sides first.
    let debate = drawnDebate;
    let sidesChosen = true;
    if (sidesChosenOnBallot(drawnDebate)) {
      const affTeamId = chosenAffTeamId ?? existingBallot?.teamScores?.AFF?.teamId ??
        (drawnDebate.sidesConfirmed ? drawnDebate.teams.AFF?.teamId : undefined);
      const negTeamId = [drawnDebate.teams.AFF?.teamId, drawnDebate.teams.NEG?.teamId].find((id) => id && id !== affTeamId);
      const assignment = { AFF: affTeamId, NEG: negTeamId };
      sidesChosen = Boolean(affTeamId) && isSidePermutation(drawnDebate, assignment);
      if (sidesChosen) debate = arrangeDebateSides(drawnDebate, assignment);
    }
    // A ballot recorded with other sides than the ones just chosen does not prefill the scores.
    const existing = existingBallot && existingBallot.teamScores?.AFF?.teamId === debate.teams.AFF?.teamId
      ? existingBallot
      : undefined;
    setBallotDrawnDebate(drawnDebate);
    setBallotSidesChosen(sidesChosen);
    setBallotDebate(debate);
    if (!chosenAffTeamId) setBallotMotionId(debate.motionId || "");
    setBallotError("");

    // The portal ballot is one adjudicator's own sheet, entered like a consensus ballot.
    const rules = privateBallotRules(tournament!, roundsMap.get(debate.roundId));
    const sides = ballotSides(rules.format);
    const speakerScores = Object.fromEntries(sides.map((side) => {
      const team = debate.teams[side] ? teamsMap.get(debate.teams[side]!.teamId) : undefined;
      const saved = existing?.speakerScores?.[side];
      return [side, saved && saved.length > 0 ? saved : blankSpeeches(team?.speakers || [], rules)];
    })) as Record<DebateSide, SpeakerScoreEntry[]>;
    setBallotEntry({
      speakerScores,
      ranks: Object.fromEntries(sides.map((side, index) => [side, existing?.teamScores?.[side]?.rank || index + 1])),
      motionId: debate.motionId || "",
    });
    setShowBallotModal(true);
  };

  const handleSubmitBallotFromPortal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ballotDebate || !adjudicator) return;
    setBallotError("");
    if (!ballotSidesChosen) {
      setBallotError(t("adjPortal.ballot.chooseSides"));
      return;
    }

    if (!ballotEntry || !tournament) return;
    const rules = privateBallotRules(tournament, roundsMap.get(ballotDebate.roundId));
    const sides = ballotSides(rules.format);
    const rosters = Object.fromEntries(sides.map((side) => [
      side,
      teamsMap.get(ballotDebate.teams[side]?.teamId || "")?.speakers || [],
    ]));
    const errors = validateBallotEntry({ ...ballotEntry, motionId: undefined }, { ...rules, rosters });
    if (errors.length > 0) {
      setBallotError(errors.join(" "));
      return;
    }

    setBallotSubmitting(true);
    try {
      const result = buildBallotResult(
        ballotEntry,
        Object.fromEntries(sides.map((side) => [side, ballotDebate.teams[side]?.teamId || ""])),
        ballotDebate.adjudicators?.chairId,
        rules
      );
      const candidateBallot: BallotSubmission = {
        id: `ballot-${ballotDebate.id}-adj-${adjudicator.id}-${crypto.randomUUID()}`,
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
        speakerScores: result.speakerScores,
        teamScores: result.teamScores,
        ...(result.noSpeakerScores ? { noSpeakerScores: true } : {}),
        chairId: ballotDebate.adjudicators?.chairId,
        timestamp: new Date().toISOString(),
        confirmedBy: adjudicator.name,
        confirmedTimestamp: new Date().toISOString(),
      };

      await submitBallot(candidateBallot, activePasscode);
      setShowBallotModal(false);
      setBallotSuccessNotice(t("adjPortal.ballot.success", { venue: ballotDebate.venueName ?? "" }));
      setTimeout(() => setBallotSuccessNotice(""), 6000);
    } catch (error) {
      setBallotError(error instanceof Error ? error.message : t("adjPortal.ballot.failed"));
    } finally {
      setBallotSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p role="status" className="text-xs text-gray-500">{t("adjPortal.loading")}</p>
        </div>
      </div>
    );
  }

  if (cloudLoadError) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-amber-200 rounded-xl p-8 text-center shadow-sm space-y-4">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">{t("portal.unavailableTitle")}</h1>
          <p role="alert" className="text-xs text-gray-600 leading-relaxed">{cloudLoadError}</p>
          <Link
            href={`/${tournamentSlug}/public`}
            className="inline-block px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 transition"
          >
            {t("portal.visitPublic")}
          </Link>
        </div>
      </div>
    );
  }

  if (verifiedPasscodeFor !== privateKey) {
    return (
      <div className="relative min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <LanguageSwitcher className="absolute end-4 top-4" />
        <form
          onSubmit={handlePasscodeSubmit}
          className="max-w-md w-full bg-white border border-[#d0d7de] rounded-xl p-8 shadow-sm space-y-5"
        >
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-lg font-bold text-gray-900">{t("adjPortal.passcodeTitle")}</h1>
            <p className="text-xs text-gray-600 leading-relaxed">{t("portal.passcodeIntro")}</p>
          </div>
          <label className="block text-xs font-semibold text-gray-700">
            {t("portal.passcodeLabel")}
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={enteredPasscode}
              onChange={(event) => {
                setEnteredPasscode(event.target.value);
                setPasscodeError("");
              }}
              className="mt-1.5 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              required
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          {t("portal.rememberMe")}
          </label>
          {passcodeError && <p role="alert" className="text-xs text-red-700">{passcodeError}</p>}
          <button
            type="submit"
            className="w-full px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 transition"
          >
            {t("portal.open")}
          </button>
          <p className="text-center text-[11px] text-gray-500">
            {tournament?.shortName || tournament?.name || t("common.tournament")}
          </p>
        </form>
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
          <h1 className="text-lg font-bold text-gray-900">{t("adjPortal.invalidTitle")}</h1>
          <p className="text-xs text-gray-600 leading-relaxed">{t("adjPortal.invalidBody")}</p>
          <Link
            href={`/${tournamentSlug}/public`}
            className="inline-block px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-md hover:bg-blue-700 transition"
          >
            {t("portal.visitPublic")}
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
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-base shadow-xs">
              ⚖️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">
                  {t("adjPortal.label", { tournament: tournament?.shortName || tournament?.name || t("common.tournament") })}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  {t("portal.privateLink")}
                </span>
              </div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span>{adjudicator.name}</span>
                {adjudicator.institutionName && (
                  <span className="text-xs font-normal text-gray-500">
                    ({adjudicator.institutionName})
                  </span>
                )}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void syncPrivatePortal(privateKey, activePasscode).catch((error) => {
                console.error("Could not sync adjudicator portal:", error);
              })}
              disabled={privateSyncState === "syncing"}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${privateSyncState === "syncing" ? "animate-spin" : ""}`} aria-hidden="true" />
              {t("adjPortal.sync")}
            </button>
            <LanguageSwitcher />
            <Link
              href={`/${tournamentSlug}/public`}
              className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md transition text-xs flex items-center gap-1"
              title={t("portal.publicHubTitle")}
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{t("portal.publicHub")}</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <SelfCheckInPanel privateKey={privateKey} passcode={activePasscode} />
        {privateSyncMessage && (
          <p
            role={privateSyncState === "error" ? "alert" : "status"}
            className={`rounded-md border px-3 py-2 text-xs ${
              privateSyncState === "error"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-blue-200 bg-blue-50 text-blue-900"
            }`}
          >
            {privateSyncMessage}
          </p>
        )}
        {/* Success Notices */}
        {feedbackSuccessNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-xs font-semibold text-emerald-800 flex items-center gap-2 shadow-2xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackSuccessNotice}</span>
          </div>
        )}

        {ballotSuccessNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-xs font-semibold text-emerald-800 flex items-center gap-2 shadow-2xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{ballotSuccessNotice}</span>
          </div>
        )}

        {/* Adjudicator Status & Responsibilities Card */}
        <div className="bg-white border border-[#d0d7de] rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{t("adjPortal.accreditation")}</span>
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-gray-100 text-gray-800 border border-gray-200">
                {t("adjPortal.score", { score: adjudicator.baseScore })}
              </span>
              {adjudicator.trainee ? (
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                  {t("role.trainee")}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
                  {t("adjPortal.voting")}
                </span>
              )}
              {adjudicator.independent && (
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-300">
                  {t("common.independent")}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              {rich("adjPortal.intro", { b: (text) => <strong>{text}</strong> })}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 text-xs">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-center min-w-[90px]">
              <span className="block text-lg font-extrabold text-blue-700">{assignedDebates.length}</span>
              <span className="text-[10px] text-blue-800 font-medium">{t("adjPortal.debatesAssigned")}</span>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-center min-w-[90px]">
              <span className="block text-lg font-extrabold text-emerald-700">
                {feedback.filter((f) => f.sourceId === adjudicator.id).length}
              </span>
              <span className="text-[10px] text-emerald-800 font-medium">{t("adjPortal.feedbackGiven")}</span>
            </div>
          </div>
        </div>

        {/* Tab Controls for Assigned Debates */}
        <div className="flex items-center justify-between border-b border-[#d0d7de] pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedRoundTab("active")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                selectedRoundTab === "active"
                  ? "bg-blue-600 text-white shadow-2xs"
                  : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              }`}
            >
              {activeRound ? t("portal.currentRoundNamed", { round: activeRound.name }) : t("portal.currentRound")}
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
              {t("portal.allRounds", { count: assignedDebates.length })}
            </button>
          </div>

          <span className="text-xs text-gray-500 font-medium hidden sm:inline">
            {plural("portal.showing", displayedDebates.length)}
          </span>
        </div>

        {/* Assigned Debates List */}
        {displayedDebates.length === 0 ? (
          <div className="bg-white border border-[#d0d7de] rounded-xl p-10 text-center text-gray-500 text-xs shadow-xs space-y-2">
            <Clock className="w-8 h-8 text-gray-400 mx-auto" />
            <p className="font-semibold text-gray-700">{t("adjPortal.emptyTitle")}</p>
            <p className="text-[11px] text-gray-500">{t("adjPortal.emptyBody")}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {displayedDebates.map((debate) => {
              const round = roundsMap.get(debate.roundId);
              const isChair = debate.adjudicators?.chairId === adjudicator.id;
              const isPanellist = debate.adjudicators?.panellistIds?.includes(adjudicator.id);
              const isTrainee = debate.adjudicators?.traineeIds?.includes(adjudicator.id);
              const canSubmitBallot =
                !adjudicator.trainee && !isTrainee && (isChair || isPanellist);

              const roleLabel = t(isChair ? "role.chair" : isPanellist ? "role.panellist" : isTrainee ? "role.trainee" : "role.judge");
              const debateBallots = ballots.filter((b) => b.debateId === debate.id && !b.discarded);
              const confirmedBallot = debateBallots.find((b) => b.confirmed);
              const draftBallot = debateBallots.find((b) => !b.confirmed);
              const existingBallot = confirmedBallot || draftBallot;

              // Build list of co-judges for feedback
              // Fallback names are saved on feedback records, so they stay in the source language.
              const coJudges: { id: string; name: string; role: PanelRole }[] = [];
              if (debate.adjudicators?.chairId && debate.adjudicators.chairId !== adjudicator.id) {
                coJudges.push({
                  id: debate.adjudicators.chairId,
                  name: debate.adjudicators.chairName || "Chair",
                  role: "chair",
                });
              }
              debate.adjudicators?.panellistIds?.forEach((pid, idx) => {
                if (pid !== adjudicator.id) {
                  coJudges.push({
                    id: pid,
                    name: debate.adjudicators?.panellistNames?.[idx] || "Panellist",
                    role: "panellist",
                  });
                }
              });
              debate.adjudicators?.traineeIds?.forEach((tid, idx) => {
                if (tid !== adjudicator.id) {
                  coJudges.push({
                    id: tid,
                    name: debate.adjudicators?.traineeNames?.[idx] || "Trainee",
                    role: "trainee",
                  });
                }
              });
              const myRole: PanelRole | undefined = isChair ? "chair" : isPanellist ? "panellist" : isTrainee ? "trainee" : undefined;
              const feedbackPaths = feedbackPathsForRound(tournament?.preferences, round);
              const feedbackOpen = feedbackEnabled && isFeedbackEnabledForRound(
                debate,
                round,
                tournament?.preferences?.feedbackInEliminationRounds !== false
              );
              const ratedCoJudges = myRole
                ? coJudges.filter((target) => isFeedbackPathAllowed(feedbackPaths, myRole, target.role))
                : [];

              return (
                <div
                  key={debate.id}
                  className="bg-white border border-[#d0d7de] rounded-xl shadow-xs overflow-hidden transition hover:border-gray-400"
                >
                  {/* Debate Card Header */}
                  <div className="bg-[#f6f8fa] px-5 py-3.5 border-b border-[#d0d7de] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-gray-900 text-sm">
                        {round ? round.name : t("portal.roundFallback", { number: debate.roundSeq })}
                      </span>
                      <span className="text-gray-400">&bull;</span>
                      <div className="flex items-center gap-1 text-xs text-gray-700 font-semibold">
                        <MapPin className="w-3.5 h-3.5 text-gray-500" />
                        <VenueLabel
                          debate={debate}
                          venues={venues}
                          categories={tournament?.preferences?.venueCategories}
                          audience="public"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded uppercase ${
                          isChair
                            ? "bg-blue-100 text-blue-800 border border-blue-300"
                            : isPanellist
                            ? "bg-purple-100 text-purple-800 border border-purple-300"
                            : "bg-amber-100 text-amber-800 border border-amber-300"
                        }`}
                      >
                        {t("adjPortal.yourRole", { role: roleLabel })}
                      </span>

                      {existingBallot?.confirmed ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 uppercase">
                          {t("adjPortal.ballotConfirmed")}
                        </span>
                      ) : existingBallot ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 uppercase">
                          {t("adjPortal.ballotDraft")}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-300 uppercase">
                          {t("adjPortal.ballotPending")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-5 space-y-4">
                    {debate.motionText && (
                      <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs">
                        <span className="font-bold text-amber-900 block mb-0.5">{t("portal.motion")}</span>
                        <p className="text-gray-800 italic">&ldquo;{debate.motionText}&rdquo;</p>
                      </div>
                    )}

                    {/* Matchup & Teams in Debate */}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                        {t("adjPortal.teamsPositions")}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                        {isBP ? (
                          <>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">OG &bull; {t("side.OG")}</span>
                              <span className="font-bold text-gray-900">{debate.teams.OG?.teamName || t("common.tbd")}</span>
                            </div>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">OO &bull; {t("side.OO")}</span>
                              <span className="font-bold text-gray-900">{debate.teams.OO?.teamName || t("common.tbd")}</span>
                            </div>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">CG &bull; {t("side.CG")}</span>
                              <span className="font-bold text-gray-900">{debate.teams.CG?.teamName || t("common.tbd")}</span>
                            </div>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">CO &bull; {t("side.CO")}</span>
                              <span className="font-bold text-gray-900">{debate.teams.CO?.teamName || t("common.tbd")}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">{sidesPending(debate) ? t("common.sidesTbc") : <>{sideLabel("AFF", tournament?.preferences).toUpperCase()} &bull; {translatedSideName(t, "AFF", tournament?.preferences)}</>}</span>
                              <span className="font-bold text-gray-900">{debate.teams.AFF?.teamName || t("common.tbd")}</span>
                            </div>
                            <div className="p-2.5 rounded bg-gray-50 border border-gray-200 text-xs">
                              <span className="text-[10px] font-bold text-gray-500 block">{sidesPending(debate) ? t("common.sidesTbc") : <>{sideLabel("NEG", tournament?.preferences).toUpperCase()} &bull; {translatedSideName(t, "NEG", tournament?.preferences)}</>}</span>
                              <span className="font-bold text-gray-900">{debate.teams.NEG?.teamName || t("common.tbd")}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Section: Action 1 - Ballot Entry */}
                    <div className="pt-2 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                          <FileCheck2 className="w-4 h-4 text-blue-600" />
                          <span>{t("adjPortal.ballotEntry")}</span>
                        </span>
                        <p className="text-[11px] text-gray-500">
                          {isChair ? t("adjPortal.chairDuty") : t("adjPortal.panelDuty")}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {canSubmitBallot ? (
                          <button
                            type="button"
                            onClick={() => handleOpenBallotModal(debate)}
                            className="px-3.5 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700 transition flex items-center gap-1.5 shadow-2xs"
                          >
                            <FileCheck2 className="w-3.5 h-3.5" />
                            <span>{existingBallot?.confirmed ? t("adjPortal.editBallot") : t("adjPortal.enterBallot")}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">{t("adjPortal.traineeNoBallot")}</span>
                        )}
                      </div>
                    </div>

                    {/* Section: Action 2 - Adjudicator Feedback */}
                    {feedbackOpen && (
                      <div className="pt-3 border-t border-gray-100 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                            <MessageSquareHeart className="w-4 h-4 text-pink-600" />
                            <span>{t("adjPortal.feedbackOnAdjudicators")}</span>
                          </span>
                          <span className="text-[10px] text-gray-500 font-mono">
                            {t("portal.scale", { min: minFeedbackScore, max: maxFeedbackScore })}
                          </span>
                        </div>

                        {coJudges.length === 0 ? (
                          <p className="text-[11px] text-gray-500 italic">
                            {t("adjPortal.solo")}
                          </p>
                        ) : ratedCoJudges.length === 0 ? (
                          <p className="text-[11px] text-gray-500 italic">
                            {t("adjPortal.noFeedbackPath")}
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {ratedCoJudges.map((target) => {
                              const submitted = hasSubmittedFeedback(target.id, debate.id);
                              const pastFb = getSubmittedFeedback(target.id, debate.id);

                              return (
                                <div
                                  key={target.id}
                                  className="p-3 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-between gap-2"
                                >
                                  <div>
                                    <span className="font-bold text-gray-900 text-xs block">{target.name}</span>
                                    <span className="text-[10px] text-gray-500 font-medium">{t(`role.${target.role}`)}</span>
                                  </div>

                                  {submitted ? (
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      <span>{t("portal.done", { score: pastFb?.score ?? "" })}</span>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenFeedbackModal(target, debate)}
                                      className="px-2.5 py-1 bg-white border border-pink-300 text-pink-700 hover:bg-pink-50 rounded text-xs font-semibold transition"
                                    >
                                      {t("adjPortal.rate")}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {feedbackPaths.onTeams && (
                        <div className="pt-3 border-t border-gray-100 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                              <Users className="w-4 h-4 text-emerald-600" />
                              <span>{t("adjPortal.feedbackOnTeams")}</span>
                            </span>
                            <span className="text-[10px] text-gray-500 font-mono">
                              {t("portal.scale", { min: minFeedbackScore, max: maxFeedbackScore })}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                            {Object.values(debate.teams || {}).filter((slot) => slot?.teamId).map((slot) => {
                              const targetId = slot!.teamId;
                              const targetName = teamsMap.get(targetId)?.name || slot!.teamName || "Team";
                              const submitted = hasSubmittedTeamFeedback(targetId, debate.id);
                              const pastFeedback = getSubmittedTeamFeedback(targetId, debate.id);
                              return (
                                <div
                                  key={targetId}
                                  className="p-3 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-between gap-2"
                                >
                                  <span className="font-bold text-gray-900 text-xs">{targetName}</span>
                                  {submitted ? (
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded">
                                      {t("portal.done", { score: pastFeedback?.score ?? "" })}
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenTeamFeedbackModal({ id: targetId, name: targetName }, debate)}
                                      className="px-2.5 py-1 bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded text-xs font-semibold transition"
                                    >
                                      {t("adjPortal.rate")}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
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
          <div className="bg-white max-h-[90vh] rounded-xl max-w-md w-full overflow-y-auto p-6 shadow-xl border border-gray-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquareHeart className="w-5 h-5 text-pink-600" />
                <h3 className="font-bold text-gray-900 text-sm">
                  {feedbackTargetType === "adjudicator" ? t("adjPortal.modalAdjudicatorTitle") : t("adjPortal.modalTeamTitle")}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowFeedbackModal(false)}
                aria-label={t("common.close")}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {feedbackError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{feedbackError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitFeedback} className="space-y-4 text-xs">
              {tournament?.preferences?.feedbackIntroduction?.trim() && (
                <p className="whitespace-pre-line rounded border border-gray-200 bg-gray-50 p-2.5 text-gray-700">
                  {tournament.preferences.feedbackIntroduction}
                </p>
              )}
              <div className="p-2.5 rounded bg-gray-50 border border-gray-200">
                <span className="text-[10px] text-gray-500 font-bold uppercase block">
                  {feedbackTargetType === "adjudicator" ? t("adjPortal.targetAdjudicator") : t("adjPortal.targetTeam")}
                </span>
                <span className="text-sm font-bold text-gray-900">
                  {feedbackTargetType === "adjudicator" ? feedbackTargetAdjName : feedbackTargetTeamName}
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-gray-700">
                    {t("portal.feedback.score", { min: minFeedbackScore, max: maxFeedbackScore })}
                  </label>
                  <span className="text-sm font-bold text-blue-600">{t("portal.feedback.scoreValue", { score: feedbackScore, max: maxFeedbackScore })}</span>
                </div>
                <input
                  type="range"
                  min={minFeedbackScore}
                  max={maxFeedbackScore}
                  step={feedbackScoreStep(tournament?.preferences)}
                  value={feedbackScore}
                  onChange={(e) => setFeedbackScore(parseFloat(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>

              {feedbackTargetType === "adjudicator" && <div>
                <label className="font-semibold text-gray-700 block mb-1.5">
                  {t("adjPortal.agreeQuestion")}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFeedbackAgree(true)}
                    className={`py-2 px-3 rounded-md font-semibold text-xs flex items-center justify-center gap-1.5 border transition ${
                      feedbackAgree
                        ? "bg-emerald-50 border-emerald-500 text-emerald-800 font-bold"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{t("portal.feedback.agreeYes")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedbackAgree(false)}
                    className={`py-2 px-3 rounded-md font-semibold text-xs flex items-center justify-center gap-1.5 border transition ${
                      !feedbackAgree
                        ? "bg-amber-50 border-amber-500 text-amber-800 font-bold"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <ThumbsDown className="w-3.5 h-3.5 text-amber-600" />
                    <span>{t("portal.feedback.agreeNo")}</span>
                  </button>
                </div>
              </div>}

              <div>
                <label className="font-semibold text-gray-700 block mb-1">
                  {feedbackTargetType === "adjudicator" ? t("adjPortal.adjudicatorComments") : t("portal.feedback.teamComments")}{" "}
                  {t("portal.feedback.confidential")}
                </label>
                <textarea
                  rows={3}
                  value={feedbackComments}
                  onChange={(e) => setFeedbackComments(e.target.value)}
                  placeholder={feedbackTargetType === "adjudicator"
                    ? t("adjPortal.adjudicatorPlaceholder")
                    : t("portal.feedback.teamPlaceholder")}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <FeedbackQuestionFields
                questions={feedbackQuestions}
                answers={feedbackAnswers}
                onChange={(questionId, value) =>
                  setFeedbackAnswers((current) => ({ ...current, [questionId]: value }))
                }
              />

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowFeedbackModal(false)}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={feedbackSubmitting}
                  className="px-4 py-1.5 bg-pink-600 text-white rounded-md font-semibold hover:bg-pink-700 transition disabled:opacity-50"
                >
                  {feedbackSubmitting ? t("portal.feedback.submitting") : t("portal.feedback.submit")}
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
                <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
                  <FileCheck2 className="w-5 h-5 text-blue-600" />
                  <span>{t("adjPortal.ballot.title", { venue: ballotDebate.venueName ?? "" })}</span>
                </h3>
                <p className="text-[11px] text-gray-500">
                  {t("adjPortal.ballot.description")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBallotModal(false)}
                aria-label={t("common.close")}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {ballotError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{ballotError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitBallotFromPortal} className="space-y-5 text-xs">
              {ballotDrawnDebate && sidesChosenOnBallot(ballotDrawnDebate) && (
                <fieldset className="space-y-2 rounded border border-blue-200 bg-blue-50/60 p-3">
                  <legend className="px-1 font-bold text-gray-800">{t("adjPortal.ballot.sidesLegend")}</legend>
                  {!ballotSidesChosen && <p className="text-[11px] text-gray-700">{t("adjPortal.ballot.chooseSides")}</p>}
                  {[ballotDrawnDebate.teams.AFF, ballotDrawnDebate.teams.NEG].map((slot) => slot?.teamId && (
                    <label key={slot.teamId} className="flex items-center gap-2 font-semibold text-gray-800">
                      <input
                        type="radio"
                        name="portal-affirmative-team"
                        checked={ballotSidesChosen && ballotDebate.teams.AFF?.teamId === slot.teamId}
                        onChange={() => handleOpenBallotModal(ballotDrawnDebate, slot.teamId)}
                      />
                      {t("adjPortal.ballot.affirmativeWas", { team: slot.teamName })}
                    </label>
                  ))}
                </fieldset>
              )}
              {ballotSidesChosen && ballotEntry && tournament && (() => {
                const rules = privateBallotRules(tournament, roundsMap.get(ballotDebate.roundId));
                const sides = ballotSides(rules.format);
                const scored = usesSpeakerScores(rules);
                const fromScores = scored && winnerDeclarationFor(rules.preferences) === "none";
                const rankCount = scored && speakerRanksFor(rules.preferences) !== "none"
                  ? sides.length * substantiveSpeakerCount(rules)
                  : undefined;
                const derived = effectiveRanks(
                  Object.fromEntries(sides.map((side) => [side, applyScoreCriteria(ballotEntry.speakerScores[side] || [], rules)])),
                  ballotEntry.ranks,
                  rules
                );
                const setRank = (side: DebateSide, rank: number) => setBallotEntry((current) => {
                  if (!current) return current;
                  if (isBP) return { ...current, ranks: { ...current.ranks, [side]: rank } };
                  // Two teams: choosing one team's result sets the other's.
                  return { ...current, ranks: Object.fromEntries(sides.map((other) => [other, other === side ? rank : rank === 1 ? 2 : 1])) };
                });
                return sides.map((side) => {
                  const teamSlot = ballotDebate.teams[side];
                  const rank = ballotEntry.ranks?.[side] || 1;
                  return (
                    <div key={side} className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                      <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs bg-white px-2 py-0.5 rounded border border-gray-300" title={sideLabel(side, rules.preferences, "full")}>
                            {sideLabel(side, rules.preferences)}
                          </span>
                          <span className="font-bold text-gray-900 text-sm">
                            {teamSlot?.teamName || t("adjPortal.ballot.unassigned")}
                          </span>
                        </div>
                        {fromScores ? (
                          <span className="text-[11px] font-semibold text-gray-600">
                            {isBP ? `${t("adjPortal.ballot.rank")} ${derived[side] ?? "—"}` : derived[side] === 1 ? t("adjPortal.ballot.win") : t("adjPortal.ballot.loss")}
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <label htmlFor={`ballot-rank-${side}`} className="text-[11px] font-semibold text-gray-600">{t("adjPortal.ballot.rank")}</label>
                            <select
                              id={`ballot-rank-${side}`}
                              value={rank}
                              onChange={(e) => setRank(side, parseInt(e.target.value, 10))}
                              className="bg-white border border-gray-300 rounded px-2 py-1 font-bold text-xs"
                            >
                              {isBP ? (
                                <>
                                  <option value={1}>{t("adjPortal.ballot.bpFirst")}</option>
                                  <option value={2}>{t("adjPortal.ballot.bpSecond")}</option>
                                  <option value={3}>{t("adjPortal.ballot.bpThird")}</option>
                                  <option value={4}>{t("adjPortal.ballot.bpFourth")}</option>
                                </>
                              ) : (
                                <>
                                  <option value={1}>{t("adjPortal.ballot.win")}</option>
                                  <option value={2}>{t("adjPortal.ballot.loss")}</option>
                                </>
                              )}
                            </select>
                          </div>
                        )}
                      </div>
                      {scored && (
                        <SpeechRows
                          idPrefix={`portal-${side}`}
                          roster={teamsMap.get(teamSlot?.teamId || "")?.speakers || []}
                          entries={ballotEntry.speakerScores[side] || []}
                          rules={rules}
                          rankCount={rankCount}
                          onChange={(speeches) => setBallotEntry((current) =>
                            current ? { ...current, speakerScores: { ...current.speakerScores, [side]: speeches } } : current
                          )}
                        />
                      )}
                    </div>
                  );
                });
              })()}

              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-[11px] text-gray-500">
                  {t("adjPortal.ballot.confirmNote", { name: adjudicator.name })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowBallotModal(false)}
                    className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={ballotSubmitting}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {ballotSubmitting ? t("adjPortal.ballot.submitting") : t("adjPortal.ballot.submit")}
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
