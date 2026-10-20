"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { sidesPending } from "@/lib/draw/manualSides";
import { VenueLabel } from "@/features/tournament/components/VenueLabel";
import { useTournament } from "@/contexts/TournamentContext";
import { SelfCheckInPanel } from "@/features/tournament/components/SelfCheckInPanel";
import {
  Users,
  MessageSquareHeart,
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
import { Debate, DebateSide, FeedbackAnswer } from "@/types";
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
import { ScoresheetsPanel } from "@/features/tournament/components/public/PublicSitePanels";
import { getPublicSiteSettings } from "@/lib/publicFeatures";

type PanelRole = "chair" | "panellist" | "trainee";

export default function TeamPrivatePortalPage() {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;
  const privateKey = params.key as string;
  const [teamPortalLoading, setTeamPortalLoading] = useState(false);

  const {
    tournament,
    loading,
    cloudLoadError,
    teams,
    rounds,
    activeRound,
    debates,
    venues,
    ballots,
    feedback,
    addFeedback,
    syncPrivatePortal,
    loadPrivateTeamPortal,
  } = useTournament();
  const { t, plural, rich } = useI18n();
  const loadPrivateTeamPortalRef = useRef(loadPrivateTeamPortal);
  loadPrivateTeamPortalRef.current = loadPrivateTeamPortal;
  const syncPrivatePortalRef = useRef(syncPrivatePortal);
  syncPrivatePortalRef.current = syncPrivatePortal;
  const rememberedPasscodeAttemptedFor = useRef("");
  const rememberedPasscodeKey = `crabbytab_team_passcode_${tournamentSlug}_${privateKey}`;
  const [enteredPasscode, setEnteredPasscode] = useState("");
  const [activePasscode, setActivePasscode] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [passcodeError, setPasscodeError] = useState("");
  const [verifiedPasscodeFor, setVerifiedPasscodeFor] = useState("");

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
    setTeamPortalLoading(true);
    void loadPrivateTeamPortalRef.current(privateKey, remembered)
      .then(() => {
        setEnteredPasscode(remembered);
        setActivePasscode(remembered);
        setVerifiedPasscodeFor(privateKey);
        setRememberMe(true);
      })
      .catch((error) => {
        if (error instanceof Error && error.message === "Invalid team link or passcode.") {
          localStorage.removeItem(rememberedPasscodeKey);
        }
      })
      .finally(() => setTeamPortalLoading(false));
  }, [loading, tournament, privateKey, rememberedPasscodeKey]);

  useEffect(() => {
    if (verifiedPasscodeFor !== privateKey || !activePasscode) return;
    const sync = () => {
      if (navigator.onLine) {
        void syncPrivatePortalRef.current(privateKey, activePasscode).catch((error) => {
          console.error("Could not sync team portal:", error);
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
    setTeamPortalLoading(true);
    try {
      await loadPrivateTeamPortal(privateKey, passcode);
      setActivePasscode(passcode);
      setVerifiedPasscodeFor(privateKey);
      if (rememberMe) {
        localStorage.setItem(rememberedPasscodeKey, passcode);
      } else {
        localStorage.removeItem(rememberedPasscodeKey);
      }
    } catch (error) {
      setPasscodeError(error instanceof Error ? error.message : t("portal.passcodeError"));
    } finally {
      setTeamPortalLoading(false);
    }
  };

  // The private URL key identifies the team; the passcode is verified separately.
  const team = useMemo(() => {
    return teams.find((t) => t.privateUrlKey === privateKey);
  }, [teams, privateKey]);

  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;
  const minFeedbackScore = tournament?.preferences?.feedbackMinScore ?? 1;
  const maxFeedbackScore = tournament?.preferences?.feedbackMaxScore ?? 10;
  const feedbackQuestions = questionsForFeedbackSource("team", tournament?.preferences);
  const isBP = tournament?.format === "bp";

  // Filter state
  const [selectedRoundTab, setSelectedRoundTab] = useState<string>("active");

  // Feedback Modal State
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackTargetType, setFeedbackTargetType] = useState<"adjudicator" | "team">("adjudicator");
  const [feedbackTargetAdjId, setFeedbackTargetAdjId] = useState("");
  const [feedbackTargetAdjName, setFeedbackTargetAdjName] = useState("");
  const [feedbackTargetAdjRole, setFeedbackTargetAdjRole] = useState<PanelRole>("chair");
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

  const hasSubmittedTeamFeedback = (targetId: string, debateId: string) => {
    if (!team) return false;
    return feedback.some(
      (item) =>
        item.sourceId === team.id &&
        item.targetType === "team" &&
        item.targetTeamId === targetId &&
        item.debateId === debateId
    );
  };

  const getSubmittedTeamFeedback = (targetId: string, debateId: string) => {
    if (!team) return null;
    return feedback.find(
      (item) =>
        item.sourceId === team.id &&
        item.targetType === "team" &&
        item.targetTeamId === targetId &&
        item.debateId === debateId
    );
  };

  // Open feedback modal pre-filled
  const handleOpenFeedbackModal = (
    targetAdj: { id: string; name: string; role: PanelRole },
    debate: Debate
  ) => {
    setFeedbackTargetType("adjudicator");
    setFeedbackTargetAdjId(targetAdj.id);
    setFeedbackTargetAdjName(targetAdj.name);
    setFeedbackTargetAdjRole(targetAdj.role);
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
    if (!team) return;
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
        sourceType: "team",
        sourceId: team.id,
        sourceName: team.name,
        score: feedbackScore,
        ...(feedbackTargetType === "adjudicator" ? { agreeWithDecision: feedbackAgree } : {}),
        comments: feedbackComments.trim(),
        answers: feedbackAnswers,
        confirmed: true,
      }, activePasscode, privateKey);
      setShowFeedbackModal(false);
      setFeedbackSuccessNotice(
        feedbackTargetType === "adjudicator"
          ? t("portal.feedback.recordedWithRole", { target: feedbackTargetAdjName, role: t(`role.${feedbackTargetAdjRole}`) })
          : t("portal.feedback.recorded", { target: feedbackTargetTeamName })
      );
      setTimeout(() => setFeedbackSuccessNotice(""), 5000);
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : t("portal.feedback.failed"));
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p role="status" className="text-xs text-gray-500">{t("teamPortal.loading")}</p>
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
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div className="text-center space-y-2">
            <h1 className="text-lg font-bold text-gray-900">{t("teamPortal.passcodeTitle")}</h1>
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
              className="mt-1.5 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-normal focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              required
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
            />
            {t("portal.rememberMe")}
          </label>
          {passcodeError && <p role="alert" className="text-xs text-red-700">{passcodeError}</p>}
          <button
            type="submit"
            disabled={teamPortalLoading}
            className="w-full px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-md hover:bg-emerald-700 transition disabled:opacity-50"
          >
            {teamPortalLoading ? t("portal.verifying") : t("portal.open")}
          </button>
          <p className="text-center text-[11px] text-gray-500">
            {tournament?.shortName || tournament?.name || t("common.tournament")}
          </p>
        </form>
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
          <h1 className="text-lg font-bold text-gray-900">{t("teamPortal.invalidTitle")}</h1>
          <p className="text-xs text-gray-600 leading-relaxed">{t("teamPortal.invalidBody")}</p>
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

  // Count feedback submissions by this team
  const teamFeedbackCount = feedback.filter((f) => f.sourceId === team.id).length;

  return (
    <div className="min-h-screen bg-[#f6f8fa] text-gray-900 pb-16">
      {/* Top Header / Identity Bar */}
      <header className="bg-white border-b border-[#d0d7de] sticky top-0 z-30 shadow-2xs">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-base shadow-xs">
              👥
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wide">
                  {t("teamPortal.label", { tournament: tournament?.shortName || tournament?.name || t("common.tournament") })}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {t("portal.privateLink")}
                </span>
              </div>
              <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span>{team.name}</span>
                {team.institutionName && (
                  <span className="text-xs font-normal text-gray-500">
                    ({team.institutionName})
                  </span>
                )}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
        {/* Success Notices */}
        {feedbackSuccessNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg text-xs font-semibold text-emerald-800 flex items-center gap-2 shadow-2xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackSuccessNotice}</span>
          </div>
        )}

        {/* Team Information Card */}
        <div className="bg-white border border-[#d0d7de] rounded-xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">{t("teamPortal.speakers")}</span>
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
                <span className="text-xs text-gray-500 italic">{t("teamPortal.noSpeakers")}</span>
              )}
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">
              {rich("teamPortal.welcome", { b: (text) => <strong>{text}</strong> })}
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 text-xs">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-center min-w-[90px]">
              <span className="block text-lg font-extrabold text-emerald-700">{teamDebates.length}</span>
              <span className="text-[10px] text-emerald-800 font-medium">{t("teamPortal.debatesFound")}</span>
            </div>
            <div className="bg-pink-50 border border-pink-200 rounded-lg p-2.5 text-center min-w-[90px]">
              <span className="block text-lg font-extrabold text-pink-700">{teamFeedbackCount}</span>
              <span className="text-[10px] text-pink-800 font-medium">{t("teamPortal.feedbackSent")}</span>
            </div>
          </div>
        </div>

        {/* Feedback Requirement Notice */}
        {feedbackEnabled && (
          <div className="p-4 bg-pink-50/70 border border-pink-200 rounded-xl text-xs text-pink-950 flex items-start gap-3">
            <MessageSquareHeart className="w-5 h-5 text-pink-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold block">{t("teamPortal.feedbackNoticeTitle")}</span>
              <p className="text-pink-900 leading-relaxed text-[11px]">{t("teamPortal.feedbackNoticeBody")}</p>
            </div>
          </div>
        )}

        {/* Tab Controls for Assigned Debates */}
        <div className="flex items-center justify-between border-b border-[#d0d7de] pb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedRoundTab("active")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                selectedRoundTab === "active"
                  ? "bg-emerald-600 text-white shadow-2xs"
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
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              }`}
            >
              {t("portal.allRounds", { count: teamDebates.length })}
            </button>
          </div>

          <span className="text-xs text-gray-500 font-medium hidden sm:inline">
            {plural("portal.showing", displayedDebates.length)}
          </span>
        </div>

        {/* Debates List */}
        {displayedDebates.length === 0 ? (
          <div className="bg-white border border-[#d0d7de] rounded-xl p-10 text-center text-gray-500 text-xs shadow-xs space-y-2">
            <Clock className="w-8 h-8 text-gray-400 mx-auto" />
            <p className="font-semibold text-gray-700">{t("teamPortal.emptyTitle")}</p>
            <p className="text-[11px] text-gray-500">{t("teamPortal.emptyBody")}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {displayedDebates.map((debate) => {
              const round = roundsMap.get(debate.roundId);

              // Determine team's side (none yet when sides are chosen at the debate)
              const sidesTbc = sidesPending(debate);
              let mySide: DebateSide | null = null;
              for (const [sKey, slot] of Object.entries(debate.teams || {})) {
                if (slot?.teamId === team.id) {
                  mySide = sKey as DebateSide;
                  break;
                }
              }

              // Collect panel of adjudicators who judged this debate
              // Fallback names are saved on feedback records, so they stay in the source language.
              const panel: { id: string; name: string; role: PanelRole }[] = [];
              if (round?.adjudicatorsRevealed && debate.adjudicators?.chairId) {
                panel.push({
                  id: debate.adjudicators.chairId,
                  name: debate.adjudicators.chairName || "Chair",
                  role: "chair",
                });
              }
              if (round?.adjudicatorsRevealed) debate.adjudicators?.panellistIds?.forEach((pid, idx) => {
                panel.push({
                  id: pid,
                  name: debate.adjudicators?.panellistNames?.[idx] || "Panellist",
                  role: "panellist",
                });
              });
              if (round?.adjudicatorsRevealed) debate.adjudicators?.traineeIds?.forEach((tid, idx) => {
                panel.push({
                  id: tid,
                  name: debate.adjudicators?.traineeNames?.[idx] || "Trainee",
                  role: "trainee",
                });
              });

              const opposingTeams = Array.from(
                new Map(
                  Object.values(debate.teams || {})
                    .filter((slot) => slot?.teamId && slot.teamId !== team.id)
                    .map((slot) => [slot!.teamId, slot!] as const)
                ).values()
              );
              const feedbackPaths = feedbackPathsForRound(tournament?.preferences, round);
              const feedbackOpen = feedbackEnabled && isFeedbackEnabledForRound(
                debate,
                round,
                tournament?.preferences?.feedbackInEliminationRounds !== false
              );
              const ratedPanel = panel.filter((adj) => isFeedbackPathAllowed(feedbackPaths, "team", adj.role));

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
                      {mySide && !sidesTbc && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 uppercase">
                          {t("teamPortal.yourSide", { side: mySide })}
                        </span>
                      )}
                      {mySide && sidesTbc && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-800 border border-gray-300">
                          {t("common.sidesTbc")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-5 space-y-4">
                    {/* Motion if released */}
                    {debate.motionText ? (
                      <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs">
                        <span className="font-bold text-amber-900 block mb-0.5">{t("portal.motion")}</span>
                        <p className="text-gray-800 italic">&ldquo;{debate.motionText}&rdquo;</p>
                      </div>
                    ) : (
                      <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-[11px] text-gray-500 italic">
                        {t("teamPortal.motionPending")}
                      </div>
                    )}

                    {/* Room Matchup */}
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                        {t("teamPortal.matchup")}
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
                              <span className="text-[10px] font-bold text-gray-500 block">OG &bull; {t("side.OG")}</span>
                              <span className="text-gray-900">{debate.teams.OG?.teamName || t("common.tbd")}</span>
                              {mySide === "OG" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">{t("teamPortal.you")}</span>}
                            </div>
                            <div
                              className={`p-2.5 rounded border text-xs ${
                                mySide === "OO"
                                  ? "bg-emerald-50 border-emerald-300 font-bold"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span className="text-[10px] font-bold text-gray-500 block">OO &bull; {t("side.OO")}</span>
                              <span className="text-gray-900">{debate.teams.OO?.teamName || t("common.tbd")}</span>
                              {mySide === "OO" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">{t("teamPortal.you")}</span>}
                            </div>
                            <div
                              className={`p-2.5 rounded border text-xs ${
                                mySide === "CG"
                                  ? "bg-emerald-50 border-emerald-300 font-bold"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span className="text-[10px] font-bold text-gray-500 block">CG &bull; {t("side.CG")}</span>
                              <span className="text-gray-900">{debate.teams.CG?.teamName || t("common.tbd")}</span>
                              {mySide === "CG" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">{t("teamPortal.you")}</span>}
                            </div>
                            <div
                              className={`p-2.5 rounded border text-xs ${
                                mySide === "CO"
                                  ? "bg-emerald-50 border-emerald-300 font-bold"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span className="text-[10px] font-bold text-gray-500 block">CO &bull; {t("side.CO")}</span>
                              <span className="text-gray-900">{debate.teams.CO?.teamName || t("common.tbd")}</span>
                              {mySide === "CO" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">{t("teamPortal.you")}</span>}
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
                              <span className="text-[10px] font-bold text-gray-500 block">{sidesTbc ? t("common.sidesTbc") : <>AFF &bull; {t("side.AFF")}</>}</span>
                              <span className="text-gray-900">{debate.teams.AFF?.teamName || t("common.tbd")}</span>
                              {mySide === "AFF" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">{t("teamPortal.you")}</span>}
                            </div>
                            <div
                              className={`p-2.5 rounded border text-xs ${
                                mySide === "NEG"
                                  ? "bg-emerald-50 border-emerald-300 font-bold"
                                  : "bg-gray-50 border-gray-200"
                              }`}
                            >
                              <span className="text-[10px] font-bold text-gray-500 block">{sidesTbc ? t("common.sidesTbc") : <>NEG &bull; {t("side.NEG")}</>}</span>
                              <span className="text-gray-900">{debate.teams.NEG?.teamName || t("common.tbd")}</span>
                              {mySide === "NEG" && <span className="text-[10px] text-emerald-700 block font-bold mt-0.5">{t("teamPortal.you")}</span>}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Section: Feedback on Adjudicators */}
                    {feedbackOpen && feedbackPaths.teams !== "none" && (
                      <div className="pt-3 border-t border-gray-100 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                            <MessageSquareHeart className="w-4 h-4 text-pink-600" />
                            <span>{t("teamPortal.adjudicatorsHeading")}</span>
                          </span>
                          <span className="text-[10px] text-gray-500 font-mono">
                            {t("portal.ratingScale", { min: minFeedbackScore, max: maxFeedbackScore })}
                          </span>
                        </div>

                        {!round?.adjudicatorsRevealed ? (
                          <p className="text-[11px] text-gray-500 italic">
                            {t("teamPortal.adjudicatorsHidden")}
                          </p>
                        ) : ratedPanel.length === 0 ? (
                          <p className="text-[11px] text-gray-500 italic">
                            {t("teamPortal.noAdjudicators")}
                          </p>
                        ) : (
                          <>
                          {feedbackPaths.teams === "orallist" && (
                            <p className="mb-2 text-[11px] text-gray-600">{t("teamPortal.orallistPrompt")}</p>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                            {ratedPanel.map((adj) => {
                              const submitted = hasSubmittedFeedback(adj.id, debate.id);
                              const pastFb = getSubmittedFeedback(adj.id, debate.id);

                              return (
                                <div
                                  key={adj.id}
                                  className="p-3 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-between gap-2"
                                >
                                  <div>
                                    <span className="font-bold text-gray-900 text-xs block">{adj.name}</span>
                                    <span className="text-[10px] text-gray-500 font-medium">{t(`role.${adj.role}`)}</span>
                                  </div>

                                  {submitted ? (
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                      <span>{t("portal.done", { score: pastFb?.score ?? "" })}</span>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenFeedbackModal(adj, debate)}
                                      className="px-3 py-1 bg-pink-600 text-white hover:bg-pink-700 rounded text-xs font-semibold transition shadow-2xs"
                                    >
                                      {t("portal.feedback.submit")}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          </>
                        )}
                      </div>
                    )}

                    {feedbackOpen && feedbackPaths.onTeams && (
                      <div className="pt-3 border-t border-gray-100 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                            <Users className="w-4 h-4 text-emerald-600" />
                            <span>{t("teamPortal.opponentsHeading")}</span>
                          </span>
                          <span className="text-[10px] text-gray-500 font-mono">
                            {t("portal.ratingScale", { min: minFeedbackScore, max: maxFeedbackScore })}
                          </span>
                        </div>
                        {opposingTeams.length === 0 ? (
                          <p className="text-[11px] text-gray-500 italic">{t("teamPortal.noOpponents")}</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                            {opposingTeams.map((opponent) => {
                              const submitted = hasSubmittedTeamFeedback(opponent.teamId, debate.id);
                              const pastFeedback = getSubmittedTeamFeedback(opponent.teamId, debate.id);
                              return (
                                <div
                                  key={opponent.teamId}
                                  className="p-3 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-between gap-2"
                                >
                                  <span className="font-bold text-gray-900 text-xs">{opponent.teamName || t("teamPortal.opponentFallback")}</span>
                                  {submitted ? (
                                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded">
                                      {t("portal.done", { score: pastFeedback?.score ?? "" })}
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenTeamFeedbackModal({
                                        id: opponent.teamId,
                                        name: opponent.teamName || "Opponent team",
                                      }, debate)}
                                      className="px-3 py-1 bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded text-xs font-semibold transition"
                                    >
                                      {t("portal.feedback.submit")}
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

        {/* Tabbycat private_ballots_released: this team's own scoresheets. */}
        {getPublicSiteSettings(tournament?.preferences).privateBallots && (() => {
          const withSheets = [...teamDebates]
            .sort((left, right) => left.roundSeq - right.roundSeq)
            .map((debate) => ({ debate, ballot: ballots.find((ballot) => ballot.debateId === debate.id && ballot.confirmed && !ballot.discarded) }))
            .filter(({ ballot }) => ballot && (ballot.sheets?.length || Object.keys(ballot.speakerScores || {}).length > 0));
          if (withSheets.length === 0) return null;
          const sides = (tournament?.format === "bp" ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"]) as DebateSide[];
          return (
            <section className="mt-6 bg-white border border-[#d0d7de] rounded-lg overflow-hidden" aria-labelledby="team-scoresheets">
              <h2 id="team-scoresheets" className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">
                {t("public.showScoresheets")}
              </h2>
              {withSheets.map(({ debate, ballot }) => (
                <div key={debate.id}>
                  <p className="px-3 pt-3 text-xs font-semibold text-gray-800">{roundsMap.get(debate.roundId)?.name ?? ""}</p>
                  <ScoresheetsPanel
                    debate={debate}
                    ballot={ballot}
                    sides={sides}
                    teamName={(side) => debate.teams?.[side]?.teamName || "—"}
                    replyPosition={tournament?.preferences?.replyScoresEnabled && tournament.format !== "bp" ? 4 : undefined}
                  />
                </div>
              ))}
            </section>
          );
        })()}
      </main>

      {/* FEEDBACK MODAL */}
      {showFeedbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs">
          <div className="bg-white max-h-[90vh] rounded-xl max-w-md w-full overflow-y-auto p-6 shadow-xl border border-gray-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquareHeart className="w-5 h-5 text-pink-600" />
                <h3 className="font-bold text-gray-900 text-sm">
                  {feedbackTargetType === "adjudicator" ? t("teamPortal.modalAdjudicatorTitle") : t("teamPortal.modalTeamTitle")}
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
              <div className="p-2.5 rounded bg-gray-50 border border-gray-200 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-500 font-bold uppercase block">
                    {feedbackTargetType === "adjudicator" ? t("teamPortal.targetAdjudicator") : t("teamPortal.targetTeam")}
                  </span>
                  <span className="text-sm font-bold text-gray-900">
                    {feedbackTargetType === "adjudicator" ? feedbackTargetAdjName : feedbackTargetTeamName}
                  </span>
                </div>
                {feedbackTargetType === "adjudicator" && (
                  <span className="text-[11px] font-semibold text-gray-600 px-2 py-0.5 rounded bg-white border border-gray-200">
                    {t(`role.${feedbackTargetAdjRole}`)}
                  </span>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-gray-700">
                    {t("portal.feedback.score", { min: minFeedbackScore, max: maxFeedbackScore })}
                  </label>
                  <span className="text-sm font-bold text-emerald-600">{t("portal.feedback.scoreValue", { score: feedbackScore, max: maxFeedbackScore })}</span>
                </div>
                <input
                  type="range"
                  min={minFeedbackScore}
                  max={maxFeedbackScore}
                  step={feedbackScoreStep(tournament?.preferences)}
                  value={feedbackScore}
                  onChange={(e) => setFeedbackScore(parseFloat(e.target.value))}
                  className="w-full accent-emerald-600 cursor-pointer"
                />
              </div>

              {feedbackTargetType === "adjudicator" && <div>
                <label className="font-semibold text-gray-700 block mb-1.5">
                  {t("teamPortal.agreeQuestion")}
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
                  {feedbackTargetType === "adjudicator" ? t("teamPortal.adjudicatorComments") : t("portal.feedback.teamComments")}{" "}
                  {t("portal.feedback.confidential")}
                </label>
                <textarea
                  rows={3}
                  value={feedbackComments}
                  onChange={(e) => setFeedbackComments(e.target.value)}
                  placeholder={feedbackTargetType === "adjudicator"
                    ? t("teamPortal.adjudicatorPlaceholder")
                    : t("portal.feedback.teamPlaceholder")}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-md font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {feedbackSubmitting ? t("portal.feedback.submitting") : t("portal.feedback.submit")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
