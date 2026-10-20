"use client";

import { sideLabel, translatedSideName } from "@/lib/sideNames";
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
  MapPin,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  Clock,
  Lock,
  Loader2,
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
import { PublicCenteredCard, PublicShell } from "@/components/public/PublicShell";
import { ChoiceChips } from "@/components/public/ChoiceChips";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Checkbox, Input, Label, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Dialog";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
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

  const tournamentTitle = tournament?.shortName || tournament?.name || t("common.tournament");
  const publicHubLink = (
    <Link
      href={`/${tournamentSlug}/public`}
      aria-label={t("portal.publicHubTitle")}
      title={t("portal.publicHubTitle")}
      className={buttonClasses({ variant: "ghost", size: "sm" })}
    >
      <ExternalLink className="rtl:-scale-x-100" aria-hidden="true" />
      <span className="hidden sm:inline">{t("portal.publicHub")}</span>
    </Link>
  );

  if (loading) {
    return (
      <PublicShell title={tournamentTitle} width="narrow">
        <PublicCenteredCard className="text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-fg-subtle" aria-hidden="true" />
          <p role="status" className="text-[13px] text-fg-muted">{t("teamPortal.loading")}</p>
        </PublicCenteredCard>
      </PublicShell>
    );
  }

  if (cloudLoadError) {
    return (
      <PublicShell title={tournamentTitle} width="narrow">
        <PublicCenteredCard className="text-center">
          <PortalIcon tone="warning" />
          <h1 className="text-xl font-semibold tracking-tight text-fg">{t("portal.unavailableTitle")}</h1>
          <p role="alert" className="text-[13px] leading-relaxed text-fg-muted">{cloudLoadError}</p>
          <Link href={`/${tournamentSlug}/public`} className={buttonClasses({ variant: "primary" })}>
            {t("portal.visitPublic")}
          </Link>
        </PublicCenteredCard>
      </PublicShell>
    );
  }

  if (verifiedPasscodeFor !== privateKey) {
    return (
      <PublicShell title={tournamentTitle} width="narrow">
        <PublicCenteredCard>
          <form onSubmit={handlePasscodeSubmit} className="space-y-4">
            <PortalIcon tone="neutral" />
            <div className="space-y-1.5 text-center">
              <h1 className="text-xl font-semibold tracking-tight text-fg">{t("teamPortal.passcodeTitle")}</h1>
              <p className="text-[13px] leading-relaxed text-fg-muted">{t("portal.passcodeIntro")}</p>
            </div>
            <Input
              label={t("portal.passcodeLabel")}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={enteredPasscode}
              onChange={(event) => {
                setEnteredPasscode(event.target.value);
                setPasscodeError("");
              }}
              className="h-10"
              required
            />
            <Checkbox
              label={t("portal.rememberMe")}
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            {passcodeError && <Alert tone="danger" role="alert">{passcodeError}</Alert>}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={teamPortalLoading}
              loadingText={t("portal.verifying")}
              className="w-full"
            >
              {t("portal.open")}
            </Button>
          </form>
        </PublicCenteredCard>
      </PublicShell>
    );
  }

  if (!team) {
    return (
      <PublicShell title={tournamentTitle} width="narrow">
        <PublicCenteredCard className="text-center">
          <PortalIcon tone="danger" />
          <h1 className="text-xl font-semibold tracking-tight text-fg">{t("teamPortal.invalidTitle")}</h1>
          <p className="text-[13px] leading-relaxed text-fg-muted">{t("teamPortal.invalidBody")}</p>
          <Link href={`/${tournamentSlug}/public`} className={buttonClasses({ variant: "primary" })}>
            {t("portal.visitPublic")}
          </Link>
        </PublicCenteredCard>
      </PublicShell>
    );
  }

  // Count feedback submissions by this team
  const teamFeedbackCount = feedback.filter((f) => f.sourceId === team.id).length;
  const sideHeading = (side: DebateSide) => (
    <>
      {sideLabel(side, tournament?.preferences).toUpperCase()} &bull; {translatedSideName(t, side, tournament?.preferences)}
    </>
  );
  const scoreValueText = t("portal.feedback.scoreValue", { score: feedbackScore, max: maxFeedbackScore });

  return (
    <PublicShell title={tournamentTitle} subtitle={t("teamPortal.portalName")} actions={publicHubLink}>
      <PageHeader
        title={team.name}
        description={team.institutionName || undefined}
        meta={
          <Badge tone="accent">
            <Lock className="h-3 w-3" aria-hidden="true" />
            {t("portal.privateLink")}
          </Badge>
        }
      />

      <SelfCheckInPanel privateKey={privateKey} passcode={activePasscode} />

      <div role="status" aria-live="polite">
        {feedbackSuccessNotice && (
          <div className="flex items-start gap-2 rounded-lg border border-success-border bg-success-subtle p-3 text-[13px] font-medium text-fg">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <span>{feedbackSuccessNotice}</span>
          </div>
        )}
      </div>

      <Card>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{t("teamPortal.speakers")}</span>
              {team.speakers && team.speakers.length > 0 ? (
                team.speakers.map((spk, idx) => <Badge key={spk.id || idx}>{spk.name}</Badge>)
              ) : (
                <span className="text-xs text-fg-muted">{t("teamPortal.noSpeakers")}</span>
              )}
            </div>
            <p className="text-[13px] leading-relaxed text-fg-muted">
              {rich("teamPortal.welcome", { b: (text) => <strong className="font-semibold text-fg">{text}</strong> })}
            </p>
          </div>

          <dl className="grid shrink-0 grid-cols-2 gap-2 sm:w-56">
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-center">
              <dd className="text-2xl font-semibold tabular-nums text-fg">{teamDebates.length}</dd>
              <dt className="text-[11px] text-fg-muted">{t("teamPortal.debatesFound")}</dt>
            </div>
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-center">
              <dd className="text-2xl font-semibold tabular-nums text-fg">{teamFeedbackCount}</dd>
              <dt className="text-[11px] text-fg-muted">{t("teamPortal.feedbackSent")}</dt>
            </div>
          </dl>
        </CardBody>
      </Card>

      {feedbackEnabled && (
        <Alert tone="info" title={t("teamPortal.feedbackNoticeTitle")}>
          {t("teamPortal.feedbackNoticeBody")}
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <ChoiceChips
          label={t("portal.roundFilterLabel")}
          options={[
            {
              value: "active",
              label: activeRound ? t("portal.currentRoundNamed", { round: activeRound.name }) : t("portal.currentRound"),
            },
            { value: "all", label: t("portal.allRounds", { count: teamDebates.length }) },
          ]}
          value={selectedRoundTab}
          onChange={setSelectedRoundTab}
        />
        <span className="hidden text-xs text-fg-muted sm:inline">
          {plural("portal.showing", displayedDebates.length)}
        </span>
      </div>

      {displayedDebates.length === 0 ? (
        <EmptyState
          icon={<Clock />}
          title={t("teamPortal.emptyTitle")}
          description={t("teamPortal.emptyBody")}
          className="bg-surface"
        />
      ) : (
        <div className="space-y-4">
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
            const matchupSides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];

            return (
              <Card key={debate.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h2 className="text-[15px] font-semibold text-fg">
                      {round ? round.name : t("portal.roundFallback", { number: debate.roundSeq })}
                    </h2>
                    <span className="flex min-w-0 items-center gap-1 text-[13px] text-fg-muted">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                      <VenueLabel
                        debate={debate}
                        venues={venues}
                        categories={tournament?.preferences?.venueCategories}
                        audience="public"
                      />
                    </span>
                  </div>
                  {mySide && !sidesTbc && (
                    <Badge tone="accent">{t("teamPortal.yourSide", { side: sideLabel(mySide, tournament?.preferences) })}</Badge>
                  )}
                  {mySide && sidesTbc && <Badge>{t("common.sidesTbc")}</Badge>}
                </div>

                <CardBody className="space-y-4">
                  {debate.motionText ? (
                    <div className="rounded-md border border-border bg-muted p-3 text-[13px]">
                      <span className="mb-0.5 block text-xs font-semibold text-fg-muted">{t("portal.motion")}</span>
                      <p className="text-fg">&ldquo;{debate.motionText}&rdquo;</p>
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border-strong p-2.5 text-xs text-fg-muted">
                      {t("teamPortal.motionPending")}
                    </p>
                  )}

                  <div>
                    <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                      {t("teamPortal.matchup")}
                    </h3>
                    <ul className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", isBP && "lg:grid-cols-4")}>
                      {matchupSides.map((side) => {
                        const mine = mySide === side;
                        return (
                          <li
                            key={side}
                            className={cn(
                              "min-w-0 rounded-md border p-2.5 text-[13px]",
                              mine ? "border-accent bg-accent-subtle" : "border-border bg-surface"
                            )}
                          >
                            <span className="block text-[11px] font-medium text-fg-muted">
                              {!isBP && sidesTbc ? t("common.sidesTbc") : sideHeading(side)}
                            </span>
                            <span className={cn("block break-words text-fg", mine && "font-semibold")}>
                              {debate.teams[side]?.teamName || t("common.tbd")}
                            </span>
                            {mine && (
                              <span className="mt-0.5 block text-[11px] font-semibold text-accent-text">{t("teamPortal.you")}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {feedbackOpen && feedbackPaths.teams !== "none" && (
                    <div className="space-y-2.5 border-t border-border pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                          <MessageSquareHeart className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                          {t("teamPortal.adjudicatorsHeading")}
                        </h3>
                        <span className="text-[11px] text-fg-muted">
                          {t("portal.ratingScale", { min: minFeedbackScore, max: maxFeedbackScore })}
                        </span>
                      </div>

                      {!round?.adjudicatorsRevealed ? (
                        <p className="text-xs text-fg-muted">{t("teamPortal.adjudicatorsHidden")}</p>
                      ) : ratedPanel.length === 0 ? (
                        <p className="text-xs text-fg-muted">{t("teamPortal.noAdjudicators")}</p>
                      ) : (
                        <>
                          {feedbackPaths.teams === "orallist" && (
                            <p className="text-xs text-fg-muted">{t("teamPortal.orallistPrompt")}</p>
                          )}
                          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {ratedPanel.map((adj) => {
                              const submitted = hasSubmittedFeedback(adj.id, debate.id);
                              const pastFb = getSubmittedFeedback(adj.id, debate.id);

                              return (
                                <li
                                  key={adj.id}
                                  className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
                                >
                                  <div className="min-w-0">
                                    <span className="block break-words text-[13px] font-medium text-fg">{adj.name}</span>
                                    <span className="text-xs text-fg-muted">{t(`role.${adj.role}`)}</span>
                                  </div>
                                  {submitted ? (
                                    <StatusPill tone="success">{t("portal.done", { score: pastFb?.score ?? "" })}</StatusPill>
                                  ) : (
                                    <Button onClick={() => handleOpenFeedbackModal(adj, debate)}>
                                      {t("portal.feedback.submit")}
                                    </Button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                    </div>
                  )}

                  {feedbackOpen && feedbackPaths.onTeams && (
                    <div className="space-y-2.5 border-t border-border pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                          <Users className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                          {t("teamPortal.opponentsHeading")}
                        </h3>
                        <span className="text-[11px] text-fg-muted">
                          {t("portal.ratingScale", { min: minFeedbackScore, max: maxFeedbackScore })}
                        </span>
                      </div>
                      {opposingTeams.length === 0 ? (
                        <p className="text-xs text-fg-muted">{t("teamPortal.noOpponents")}</p>
                      ) : (
                        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {opposingTeams.map((opponent) => {
                            const submitted = hasSubmittedTeamFeedback(opponent.teamId, debate.id);
                            const pastFeedback = getSubmittedTeamFeedback(opponent.teamId, debate.id);
                            return (
                              <li
                                key={opponent.teamId}
                                className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
                              >
                                <span className="min-w-0 break-words text-[13px] font-medium text-fg">
                                  {opponent.teamName || t("teamPortal.opponentFallback")}
                                </span>
                                {submitted ? (
                                  <StatusPill tone="success">{t("portal.done", { score: pastFeedback?.score ?? "" })}</StatusPill>
                                ) : (
                                  <Button
                                    onClick={() => handleOpenTeamFeedbackModal({
                                      id: opponent.teamId,
                                      name: opponent.teamName || "Opponent team",
                                    }, debate)}
                                  >
                                    {t("portal.feedback.submit")}
                                  </Button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>
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
          <section className="overflow-hidden rounded-lg border border-border bg-surface" aria-labelledby="team-scoresheets">
            <h2 id="team-scoresheets" className="border-b border-border px-4 py-3 text-[15px] font-semibold text-fg">
              {t("public.showScoresheets")}
            </h2>
            {withSheets.map(({ debate, ballot }) => (
              <div key={debate.id} className="overflow-x-auto">
                <h3 className="px-4 pt-3 text-[13px] font-semibold text-fg">{roundsMap.get(debate.roundId)?.name ?? ""}</h3>
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

      <Dialog
        open={showFeedbackModal}
        onClose={() => setShowFeedbackModal(false)}
        dismissible={!feedbackSubmitting}
        icon={<MessageSquareHeart className="text-fg-subtle" aria-hidden="true" />}
        title={feedbackTargetType === "adjudicator" ? t("teamPortal.modalAdjudicatorTitle") : t("teamPortal.modalTeamTitle")}
        footer={
          <>
            <Button onClick={() => setShowFeedbackModal(false)} disabled={feedbackSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form="team-feedback-form"
              variant="primary"
              loading={feedbackSubmitting}
              loadingText={t("portal.feedback.submitting")}
            >
              {t("portal.feedback.submit")}
            </Button>
          </>
        }
      >
        <form id="team-feedback-form" onSubmit={handleSubmitFeedback} className="space-y-4">
          {feedbackError && <Alert tone="danger" role="alert">{feedbackError}</Alert>}

          {tournament?.preferences?.feedbackIntroduction?.trim() && (
            <p className="whitespace-pre-line rounded-md border border-border bg-muted p-2.5 text-[13px] text-fg-muted">
              {tournament.preferences.feedbackIntroduction}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted p-2.5">
            <div className="min-w-0">
              <span className="block text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                {feedbackTargetType === "adjudicator" ? t("teamPortal.targetAdjudicator") : t("teamPortal.targetTeam")}
              </span>
              <span className="block break-words text-[13px] font-semibold text-fg">
                {feedbackTargetType === "adjudicator" ? feedbackTargetAdjName : feedbackTargetTeamName}
              </span>
            </div>
            {feedbackTargetType === "adjudicator" && <Badge>{t(`role.${feedbackTargetAdjRole}`)}</Badge>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="team-feedback-score">
                {t("portal.feedback.score", { min: minFeedbackScore, max: maxFeedbackScore })}
              </Label>
              <span className="text-[13px] font-semibold tabular-nums text-fg" aria-hidden="true">{scoreValueText}</span>
            </div>
            <input
              id="team-feedback-score"
              type="range"
              min={minFeedbackScore}
              max={maxFeedbackScore}
              step={feedbackScoreStep(tournament?.preferences)}
              value={feedbackScore}
              aria-valuetext={scoreValueText}
              onChange={(e) => setFeedbackScore(parseFloat(e.target.value))}
              className={cn("h-8 w-full cursor-pointer rounded-md accent-[rgb(var(--color-accent))]", focusRing)}
            />
          </div>

          {feedbackTargetType === "adjudicator" && (
            <div className="space-y-1.5">
              <p id="team-feedback-agree-label" className="text-xs font-medium text-fg">
                {t("teamPortal.agreeQuestion")}
              </p>
              <div role="group" aria-labelledby="team-feedback-agree-label" className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={feedbackAgree}
                  onClick={() => setFeedbackAgree(true)}
                  className={cn(
                    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    feedbackAgree
                      ? "border-success-border bg-success-subtle text-fg"
                      : "border-border-strong bg-surface text-fg-muted hover:bg-muted hover:text-fg",
                    focusRing
                  )}
                >
                  <ThumbsUp className={cn("h-4 w-4 shrink-0", feedbackAgree ? "text-success" : "text-fg-subtle")} aria-hidden="true" />
                  {t("portal.feedback.agreeYes")}
                </button>
                <button
                  type="button"
                  aria-pressed={!feedbackAgree}
                  onClick={() => setFeedbackAgree(false)}
                  className={cn(
                    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    !feedbackAgree
                      ? "border-warning-border bg-warning-subtle text-fg"
                      : "border-border-strong bg-surface text-fg-muted hover:bg-muted hover:text-fg",
                    focusRing
                  )}
                >
                  <ThumbsDown className={cn("h-4 w-4 shrink-0", !feedbackAgree ? "text-warning" : "text-fg-subtle")} aria-hidden="true" />
                  {t("portal.feedback.agreeNo")}
                </button>
              </div>
            </div>
          )}

          <Textarea
            label={
              <>
                {feedbackTargetType === "adjudicator" ? t("teamPortal.adjudicatorComments") : t("portal.feedback.teamComments")}{" "}
                <span className="font-normal text-fg-muted">{t("portal.feedback.confidential")}</span>
              </>
            }
            rows={3}
            value={feedbackComments}
            onChange={(e) => setFeedbackComments(e.target.value)}
            placeholder={feedbackTargetType === "adjudicator"
              ? t("teamPortal.adjudicatorPlaceholder")
              : t("portal.feedback.teamPlaceholder")}
          />

          <FeedbackQuestionFields
            questions={feedbackQuestions}
            answers={feedbackAnswers}
            onChange={(questionId, value) =>
              setFeedbackAnswers((current) => ({ ...current, [questionId]: value }))
            }
          />
        </form>
      </Dialog>
    </PublicShell>
  );
}

function PortalIcon({ tone }: { tone: "neutral" | "warning" | "danger" }) {
  return (
    <div
      className={cn(
        "mx-auto flex h-10 w-10 items-center justify-center rounded-full border",
        tone === "warning" && "border-warning-border bg-warning-subtle text-warning",
        tone === "danger" && "border-danger-border bg-danger-subtle text-danger",
        tone === "neutral" && "border-border bg-muted text-fg-muted"
      )}
    >
      <Lock className="h-5 w-5" aria-hidden="true" />
    </div>
  );
}
