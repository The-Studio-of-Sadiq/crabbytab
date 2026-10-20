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
  MapPin,
  Users,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  Clock,
  Lock,
  Loader2,
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
import { translatedSideName } from "@/lib/sideNames";
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
import { PublicCenteredCard, PublicShell } from "@/components/public/PublicShell";
import { ChoiceChips } from "@/components/public/ChoiceChips";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { SideBadge } from "@/components/ui/SideBadge";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

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

  const shellTitle = tournament?.shortName || tournament?.name || t("common.tournament");
  const publicHref = `/${tournamentSlug}/public`;

  if (loading) {
    return (
      <PublicShell title={shellTitle} width="narrow">
        <PublicCenteredCard className="flex flex-col items-center text-center">
          <Loader2 className="h-6 w-6 animate-spin text-fg-subtle" aria-hidden="true" />
          <p role="status" className="text-[13px] text-fg-muted">{t("adjPortal.loading")}</p>
        </PublicCenteredCard>
      </PublicShell>
    );
  }

  if (cloudLoadError) {
    return (
      <PublicShell title={shellTitle} width="narrow">
        <PublicCenteredCard className="text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-warning-border bg-warning-subtle text-warning">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-fg">{t("portal.unavailableTitle")}</h1>
          <p role="alert" className="text-[13px] leading-relaxed text-fg-muted">{cloudLoadError}</p>
          <Link href={publicHref} className={buttonClasses({ variant: "primary", size: "lg" })}>
            {t("portal.visitPublic")}
          </Link>
        </PublicCenteredCard>
      </PublicShell>
    );
  }

  if (verifiedPasscodeFor !== privateKey) {
    return (
      <PublicShell title={shellTitle} width="narrow">
        <PublicCenteredCard>
          <form onSubmit={handlePasscodeSubmit} className="space-y-4">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-accent/30 bg-accent-subtle text-accent-text">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-1.5 text-center">
              <h1 className="text-xl font-semibold text-fg">{t("adjPortal.passcodeTitle")}</h1>
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
            <Button type="submit" variant="primary" size="lg" className="w-full">
              {t("portal.open")}
            </Button>
          </form>
        </PublicCenteredCard>
      </PublicShell>
    );
  }

  if (!adjudicator) {
    return (
      <PublicShell title={shellTitle} width="narrow">
        <PublicCenteredCard className="text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-danger-border bg-danger-subtle text-danger">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-fg">{t("adjPortal.invalidTitle")}</h1>
          <p className="text-[13px] leading-relaxed text-fg-muted">{t("adjPortal.invalidBody")}</p>
          <Link href={publicHref} className={buttonClasses({ variant: "primary", size: "lg" })}>
            {t("portal.visitPublic")}
          </Link>
        </PublicCenteredCard>
      </PublicShell>
    );
  }

  const syncing = privateSyncState === "syncing";
  const feedbackTargetName = feedbackTargetType === "adjudicator" ? feedbackTargetAdjName : feedbackTargetTeamName;

  return (
    <PublicShell
      title={shellTitle}
      subtitle={t("adjPortal.portalName")}
      width="narrow"
      actions={
        <Link
          href={publicHref}
          title={t("portal.publicHubTitle")}
          aria-label={t("portal.publicHub")}
          className={buttonClasses({ variant: "ghost", size: "sm" })}
        >
          <ExternalLink aria-hidden="true" />
          <span className="hidden sm:inline">{t("portal.publicHub")}</span>
        </Link>
      }
    >
      <PageHeader
        title={adjudicator.name}
        description={adjudicator.institutionName || undefined}
        meta={
          <>
            <Badge tone="accent">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {t("portal.privateLink")}
            </Badge>
            <Badge>{t("adjPortal.score", { score: adjudicator.baseScore })}</Badge>
            {adjudicator.trainee ? (
              <Badge tone="warning">{t("role.trainee")}</Badge>
            ) : (
              <Badge tone="info">{t("adjPortal.voting")}</Badge>
            )}
            {adjudicator.independent && <Badge>{t("common.independent")}</Badge>}
          </>
        }
        actions={
          <Button
            variant="secondary"
            size="md"
            loading={syncing}
            onClick={() => void syncPrivatePortal(privateKey, activePasscode).catch((error) => {
              console.error("Could not sync adjudicator portal:", error);
            })}
          >
            {!syncing && <RefreshCw aria-hidden="true" />}
            {t("adjPortal.sync")}
          </Button>
        }
      />

      <SelfCheckInPanel privateKey={privateKey} passcode={activePasscode} />

      {privateSyncMessage && (
        <Alert tone={privateSyncState === "error" ? "warning" : "info"} role={privateSyncState === "error" ? "alert" : "status"}>
          {privateSyncMessage}
        </Alert>
      )}

      <div role="status" aria-live="polite" className="space-y-2 empty:sr-only">
        {feedbackSuccessNotice && <Alert tone="success">{feedbackSuccessNotice}</Alert>}
        {ballotSuccessNotice && <Alert tone="success">{ballotSuccessNotice}</Alert>}
      </div>

      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{t("adjPortal.accreditation")}</h2>
          <p className="text-[13px] leading-relaxed text-fg-muted">
            {rich("adjPortal.intro", { b: (text) => <strong className="font-semibold text-fg">{text}</strong> })}
          </p>
        </div>
        <dl className="grid shrink-0 grid-cols-2 gap-2">
          <div className="flex min-w-[96px] flex-col-reverse rounded-md border border-border bg-background px-3 py-2 text-center">
            <dt className="text-[11px] text-fg-muted">{t("adjPortal.debatesAssigned")}</dt>
            <dd className="text-xl font-semibold tabular-nums text-fg">{assignedDebates.length}</dd>
          </div>
          <div className="flex min-w-[96px] flex-col-reverse rounded-md border border-border bg-background px-3 py-2 text-center">
            <dt className="text-[11px] text-fg-muted">{t("adjPortal.feedbackGiven")}</dt>
            <dd className="text-xl font-semibold tabular-nums text-fg">
              {feedback.filter((f) => f.sourceId === adjudicator.id).length}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <ChoiceChips
          label={t("portal.roundFilterLabel")}
          options={[
            {
              value: "active",
              label: activeRound ? t("portal.currentRoundNamed", { round: activeRound.name }) : t("portal.currentRound"),
            },
            { value: "all", label: t("portal.allRounds", { count: assignedDebates.length }) },
          ]}
          value={selectedRoundTab}
          onChange={setSelectedRoundTab}
        />
        <span className="text-xs text-fg-muted">{plural("portal.showing", displayedDebates.length)}</span>
      </div>

      {displayedDebates.length === 0 ? (
        <EmptyState
          icon={<Clock aria-hidden="true" />}
          title={t("adjPortal.emptyTitle")}
          description={t("adjPortal.emptyBody")}
        />
      ) : (
        <div className="space-y-4">
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
            const headingId = `debate-${debate.id}-heading`;
            const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];
            const pending = !isBP && sidesPending(debate);

            return (
              <Card key={debate.id} role="region" aria-labelledby={headingId} className="overflow-hidden">
                <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 id={headingId} className="text-[15px] font-semibold text-fg">
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
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={isChair ? "accent" : isPanellist ? "info" : "warning"}>
                      {t("adjPortal.yourRole", { role: roleLabel })}
                    </Badge>
                    {existingBallot?.confirmed ? (
                      <StatusPill tone="success">{t("adjPortal.ballotConfirmed")}</StatusPill>
                    ) : existingBallot ? (
                      <StatusPill tone="warning">{t("adjPortal.ballotDraft")}</StatusPill>
                    ) : (
                      <StatusPill tone="neutral" icon={<Clock aria-hidden="true" />}>{t("adjPortal.ballotPending")}</StatusPill>
                    )}
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  {debate.motionText && (
                    <div className="rounded-md border border-border bg-background p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{t("portal.motion")}</p>
                      <blockquote className="mt-0.5 text-[13px] italic text-fg">&ldquo;{debate.motionText}&rdquo;</blockquote>
                    </div>
                  )}

                  <div>
                    <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                      {t("adjPortal.teamsPositions")}
                    </h3>
                    <ul className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", isBP && "md:grid-cols-4")}>
                      {sides.map((side) => (
                        <li key={side} className="min-w-0 rounded-md border border-border bg-background p-2.5">
                          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
                            {pending ? (
                              t("common.sidesTbc")
                            ) : (
                              <>
                                <SideBadge side={side} preferences={tournament?.preferences} />
                                {isBP ? t(`side.${side}`) : translatedSideName(t, side, tournament?.preferences)}
                              </>
                            )}
                          </span>
                          <span className="mt-1 block break-words text-[13px] font-medium text-fg">
                            {debate.teams[side]?.teamName || t("common.tbd")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <section className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                        <FileCheck2 className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                        {t("adjPortal.ballotEntry")}
                      </h3>
                      <p className="text-xs text-fg-muted">
                        {isChair ? t("adjPortal.chairDuty") : t("adjPortal.panelDuty")}
                      </p>
                    </div>
                    {canSubmitBallot ? (
                      <Button
                        variant="primary"
                        size="lg"
                        className="w-full sm:w-auto"
                        onClick={() => handleOpenBallotModal(debate)}
                      >
                        <FileCheck2 aria-hidden="true" />
                        {existingBallot?.confirmed ? t("adjPortal.editBallot") : t("adjPortal.enterBallot")}
                      </Button>
                    ) : (
                      <p className="text-xs text-fg-muted">{t("adjPortal.traineeNoBallot")}</p>
                    )}
                  </section>

                  {feedbackOpen && (
                    <section className="space-y-2.5 border-t border-border pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                          <MessageSquareHeart className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                          {t("adjPortal.feedbackOnAdjudicators")}
                        </h3>
                        <span className="text-[11px] text-fg-muted">
                          {t("portal.scale", { min: minFeedbackScore, max: maxFeedbackScore })}
                        </span>
                      </div>

                      {coJudges.length === 0 ? (
                        <p className="text-xs text-fg-muted">{t("adjPortal.solo")}</p>
                      ) : ratedCoJudges.length === 0 ? (
                        <p className="text-xs text-fg-muted">{t("adjPortal.noFeedbackPath")}</p>
                      ) : (
                        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {ratedCoJudges.map((target) => {
                            const submitted = hasSubmittedFeedback(target.id, debate.id);
                            const pastFb = getSubmittedFeedback(target.id, debate.id);

                            return (
                              <li
                                key={target.id}
                                className="flex items-center justify-between gap-2 rounded-md border border-border bg-background p-2.5"
                              >
                                <div className="min-w-0">
                                  <span className="block break-words text-[13px] font-medium text-fg">{target.name}</span>
                                  <span className="text-xs text-fg-muted">{t(`role.${target.role}`)}</span>
                                </div>
                                {submitted ? (
                                  <StatusPill tone="success">{t("portal.done", { score: pastFb?.score ?? "" })}</StatusPill>
                                ) : (
                                  <Button
                                    variant="secondary"
                                    size="md"
                                    aria-label={t("adjPortal.rateTarget", { name: target.name })}
                                    onClick={() => handleOpenFeedbackModal(target, debate)}
                                  >
                                    {t("adjPortal.rate")}
                                  </Button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {feedbackPaths.onTeams && (
                        <div className="space-y-2.5 border-t border-border pt-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                              <Users className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                              {t("adjPortal.feedbackOnTeams")}
                            </h3>
                            <span className="text-[11px] text-fg-muted">
                              {t("portal.scale", { min: minFeedbackScore, max: maxFeedbackScore })}
                            </span>
                          </div>
                          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {Object.values(debate.teams || {}).filter((slot) => slot?.teamId).map((slot) => {
                              const targetId = slot!.teamId;
                              // Saved on the feedback record, so the fallback stays in the source language.
                              const targetName = teamsMap.get(targetId)?.name || slot!.teamName || "Team";
                              const submitted = hasSubmittedTeamFeedback(targetId, debate.id);
                              const pastFeedback = getSubmittedTeamFeedback(targetId, debate.id);
                              return (
                                <li
                                  key={targetId}
                                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-background p-2.5"
                                >
                                  <span className="min-w-0 break-words text-[13px] font-medium text-fg">{targetName}</span>
                                  {submitted ? (
                                    <StatusPill tone="success">{t("portal.done", { score: pastFeedback?.score ?? "" })}</StatusPill>
                                  ) : (
                                    <Button
                                      variant="secondary"
                                      size="md"
                                      aria-label={t("adjPortal.rateTarget", { name: targetName })}
                                      onClick={() => handleOpenTeamFeedbackModal({ id: targetId, name: targetName }, debate)}
                                    >
                                      {t("adjPortal.rate")}
                                    </Button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={showFeedbackModal}
        onClose={() => setShowFeedbackModal(false)}
        dismissible={!feedbackSubmitting}
        icon={<MessageSquareHeart className="text-fg-subtle" aria-hidden="true" />}
        title={feedbackTargetType === "adjudicator" ? t("adjPortal.modalAdjudicatorTitle") : t("adjPortal.modalTeamTitle")}
        footer={
          <>
            <Button variant="secondary" size="lg" disabled={feedbackSubmitting} onClick={() => setShowFeedbackModal(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form="portal-feedback-form"
              variant="primary"
              size="lg"
              loading={feedbackSubmitting}
              loadingText={t("portal.feedback.submitting")}
            >
              {t("portal.feedback.submit")}
            </Button>
          </>
        }
      >
        <form id="portal-feedback-form" onSubmit={handleSubmitFeedback} className="space-y-4">
          {feedbackError && <Alert tone="danger" role="alert">{feedbackError}</Alert>}
          {tournament?.preferences?.feedbackIntroduction?.trim() && (
            <p className="whitespace-pre-line rounded-md border border-border bg-background p-2.5 text-fg-muted">
              {tournament.preferences.feedbackIntroduction}
            </p>
          )}
          <div className="rounded-md border border-border bg-background p-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
              {feedbackTargetType === "adjudicator" ? t("adjPortal.targetAdjudicator") : t("adjPortal.targetTeam")}
            </p>
            <p className="break-words text-[15px] font-semibold text-fg">{feedbackTargetName}</p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="portal-feedback-score">
                {t("portal.feedback.score", { min: minFeedbackScore, max: maxFeedbackScore })}
              </Label>
              <output htmlFor="portal-feedback-score" className="text-[13px] font-semibold tabular-nums text-fg">
                {t("portal.feedback.scoreValue", { score: feedbackScore, max: maxFeedbackScore })}
              </output>
            </div>
            <input
              id="portal-feedback-score"
              type="range"
              min={minFeedbackScore}
              max={maxFeedbackScore}
              step={feedbackScoreStep(tournament?.preferences)}
              value={feedbackScore}
              aria-valuetext={t("portal.feedback.scoreValue", { score: feedbackScore, max: maxFeedbackScore })}
              onChange={(e) => setFeedbackScore(parseFloat(e.target.value))}
              className={cn("h-8 w-full cursor-pointer rounded-md accent-[rgb(var(--color-accent))]", focusRing)}
            />
          </div>

          {feedbackTargetType === "adjudicator" && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-xs font-medium text-fg">{t("adjPortal.agreeQuestion")}</legend>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={feedbackAgree}
                  onClick={() => setFeedbackAgree(true)}
                  className={cn(
                    "inline-flex h-10 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors",
                    feedbackAgree
                      ? "border-success-border bg-success-subtle text-fg"
                      : "border-border-strong bg-surface text-fg-muted hover:bg-muted hover:text-fg",
                    focusRing
                  )}
                >
                  <ThumbsUp className="h-4 w-4 text-success" aria-hidden="true" />
                  {t("portal.feedback.agreeYes")}
                </button>
                <button
                  type="button"
                  aria-pressed={!feedbackAgree}
                  onClick={() => setFeedbackAgree(false)}
                  className={cn(
                    "inline-flex h-10 items-center justify-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors",
                    !feedbackAgree
                      ? "border-warning-border bg-warning-subtle text-fg"
                      : "border-border-strong bg-surface text-fg-muted hover:bg-muted hover:text-fg",
                    focusRing
                  )}
                >
                  <ThumbsDown className="h-4 w-4 text-warning" aria-hidden="true" />
                  {t("portal.feedback.agreeNo")}
                </button>
              </div>
            </fieldset>
          )}

          <Textarea
            id="portal-feedback-comments"
            label={
              <>
                {feedbackTargetType === "adjudicator" ? t("adjPortal.adjudicatorComments") : t("portal.feedback.teamComments")}{" "}
                <span className="font-normal text-fg-muted">{t("portal.feedback.confidential")}</span>
              </>
            }
            rows={3}
            value={feedbackComments}
            onChange={(e) => setFeedbackComments(e.target.value)}
            placeholder={feedbackTargetType === "adjudicator"
              ? t("adjPortal.adjudicatorPlaceholder")
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

      <Dialog
        open={showBallotModal && ballotDebate !== null}
        onClose={() => setShowBallotModal(false)}
        dismissible={!ballotSubmitting}
        size="lg"
        icon={<FileCheck2 className="text-fg-subtle" aria-hidden="true" />}
        title={t("adjPortal.ballot.title", { venue: ballotDebate?.venueName ?? "" })}
        description={t("adjPortal.ballot.description")}
        footer={
          <>
            <p className="w-full text-xs text-fg-muted sm:me-auto sm:w-auto sm:self-center">
              {t("adjPortal.ballot.confirmNote", { name: adjudicator.name })}
            </p>
            <Button variant="secondary" size="lg" disabled={ballotSubmitting} onClick={() => setShowBallotModal(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form="portal-ballot-form"
              variant="primary"
              size="lg"
              loading={ballotSubmitting}
              loadingText={t("adjPortal.ballot.submitting")}
            >
              {t("adjPortal.ballot.submit")}
            </Button>
          </>
        }
      >
        {ballotDebate && (
          <form id="portal-ballot-form" onSubmit={handleSubmitBallotFromPortal} className="space-y-4">
            {ballotError && <Alert tone="danger" role="alert">{ballotError}</Alert>}
            {ballotDrawnDebate && sidesChosenOnBallot(ballotDrawnDebate) && (
              <fieldset className="space-y-2 rounded-md border border-info-border bg-info-subtle p-3">
                <legend className="px-1 text-xs font-semibold text-fg">{t("adjPortal.ballot.sidesLegend")}</legend>
                {!ballotSidesChosen && <p className="text-xs text-fg-muted">{t("adjPortal.ballot.chooseSides")}</p>}
                {[ballotDrawnDebate.teams.AFF, ballotDrawnDebate.teams.NEG].map((slot) => slot?.teamId && (
                  <label key={slot.teamId} className="flex min-h-8 cursor-pointer items-center gap-2 text-[13px] font-medium text-fg">
                    <input
                      type="radio"
                      name="portal-affirmative-team"
                      checked={ballotSidesChosen && ballotDebate.teams.AFF?.teamId === slot.teamId}
                      onChange={() => handleOpenBallotModal(ballotDrawnDebate, slot.teamId)}
                      className={cn("h-4 w-4 shrink-0 accent-[rgb(var(--color-accent))]", focusRing)}
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
                const teamHeadingId = `ballot-team-${side}`;
                return (
                  <section key={side} aria-labelledby={teamHeadingId} className="space-y-3 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <SideBadge side={side} preferences={rules.preferences} />
                        <h3 id={teamHeadingId} className="break-words text-[13px] font-semibold text-fg">
                          {teamSlot?.teamName || t("adjPortal.ballot.unassigned")}
                        </h3>
                      </div>
                      {fromScores ? (
                        <span className="text-xs font-medium text-fg-muted">
                          {isBP ? `${t("adjPortal.ballot.rank")} ${derived[side] ?? "—"}` : derived[side] === 1 ? t("adjPortal.ballot.win") : t("adjPortal.ballot.loss")}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Label htmlFor={`ballot-rank-${side}`} className="text-xs text-fg-muted">{t("adjPortal.ballot.rank")}</Label>
                          <Select
                            id={`ballot-rank-${side}`}
                            value={rank}
                            aria-describedby={teamHeadingId}
                            onChange={(e) => setRank(side, parseInt(e.target.value, 10))}
                            className="h-10 w-auto font-medium"
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
                          </Select>
                        </div>
                      )}
                    </div>
                    {scored && (
                      <div className="overflow-x-auto">
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
                      </div>
                    )}
                  </section>
                );
              });
            })()}
          </form>
        )}
      </Dialog>
    </PublicShell>
  );
}
