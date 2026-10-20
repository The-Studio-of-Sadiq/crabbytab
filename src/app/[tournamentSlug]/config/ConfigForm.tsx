"use client";

import React, { useEffect, useState } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import {
  Save,
  Shield,
  Eye,
  Shuffle,
  FileCheck2,
  Trash2,
  Clock,
  Trophy,
  Users2,
  UserCheck,
  Scale,
  Calendar,
  MessageSquare,
} from "lucide-react";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { StatusPill } from "@/components/ui/Badge";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  TournamentPreferences,
  TournamentFormat,
  OddBracketMethod,
  PairingMethod,
  ConflictAvoidance,
  PullupRestriction,
  BPPullupDistribution,
  BPPositionCost,
  BPAssignmentMethod,
  ByeTeamResults,
  ByeTeamSelectionMethod,
  FeedbackQuestion,
  FeedbackQuestionType,
  RoundStage,
} from "@/types";
import { PrecedenceEditor, ExtraMetricsEditor } from "@/components/setup/PrecedenceEditor";
import {
  TEAM_METRIC_LABELS,
  SPEAKER_METRIC_LABELS,
  BP_ONLY_TEAM_METRICS,
  BP_ONLY_SPEAKER_METRICS,
  EXTRA_ONLY_TEAM_METRICS,
  RANKING_ONLY_TEAM_METRICS,
  REPEATABLE_TEAM_METRICS,
  TWO_TEAM_ONLY_SPEAKER_METRICS,
  TWO_TEAM_ONLY_TEAM_METRICS,
} from "@/lib/standings/metrics";
import { resolveTeamPrecedence, resolveSpeakerPrecedence } from "@/lib/standings/precedence";
import { lockedSettingsFields } from "@/features/tournament/application/stateGuards";
import { FEEDBACK_QUESTION_TYPES, validateFeedbackQuestions } from "@/lib/feedback/questions";
import { preliminaryFeedbackPaths } from "@/lib/feedback/paths";
import { FeedbackPathsEditor } from "@/components/feedback/FeedbackPathsEditor";
import { FeedbackOptionsFields } from "@/components/feedback/FeedbackOptionsFields";
import { LOCALES } from "@/lib/i18n/config";
import { RoundWeightsEditor } from "@/features/tournament/components/RoundWeightsEditor";
import { ResultsRulesSettings } from "@/features/tournament/components/ballot/ResultsRulesSettings";
import { validateScoreCriteria } from "@/lib/ballots/ballotRules";
import { PublicSiteSettingsFields } from "@/features/tournament/components/PublicSiteSettingsFields";
import { ConfigTransferCard } from "@/features/tournament/components/ConfigTransferCard";
import { TeamNamingCard } from "@/features/tournament/components/TeamNamingCard";

type SettingsCategory = "draw" | "rounds" | "format" | "scoring" | "standings" | "visibility";

const SETTINGS_CATEGORIES: Record<SettingsCategory, MessageKey> = {
  draw: "setup.config.categoryDraw",
  rounds: "setup.config.categoryRounds",
  format: "setup.config.categoryFormat",
  scoring: "setup.config.categoryScoring",
  standings: "setup.config.categoryStandings",
  visibility: "setup.config.categoryVisibility",
};

const STAGE_LABELS: Record<RoundStage, MessageKey> = {
  preliminary: "setup.config.stagePreliminary",
  elimination: "setup.config.stageElimination",
};

/** Display names for the stored feedback question types (the lib labels stay as the English source). */
const QUESTION_TYPE_LABELS: Record<FeedbackQuestionType, MessageKey> = {
  text: "setup.config.questionTypeText",
  textarea: "setup.config.questionTypeTextarea",
  integer: "setup.config.questionTypeInteger",
  float: "setup.config.questionTypeFloat",
  integer_scale: "setup.config.questionTypeIntegerScale",
  scale: "setup.config.questionTypeScale",
  yes_no: "setup.config.questionTypeYesNo",
  checkbox: "setup.config.questionTypeCheckbox",
  select_one: "setup.config.questionTypeSelectOne",
  select_many: "setup.config.questionTypeSelectMany",
};

/** Number inputs for draw penalties and score bounds read as figures. */
const NUMBER_CLASS = "font-mono tabular-nums";

function ConfigFormContent({ category }: { category: SettingsCategory }) {
  const { t, plural, rich } = useI18n();
  const {
    tournament,
    saveTournament,
    rounds,
    debates,
    ballots,
    updateRound,
    setPreliminaryRoundCount,
    deleteRound,
    teams,
    institutions,
    saveEntityBatch,
  } = useTournament();

  const defaultPrefs: TournamentPreferences = {
    teamsInDebate: 4,
    substantiveSpeakers: 2,
    replyScoresEnabled: false,
    minSpeakerScore: 68,
    maxSpeakerScore: 84,
    stepSpeakerScore: 1,
    minReplyScore: 34,
    maxReplyScore: 42,
    drawRule: "power_paired",
    sideAllocationRule: "balanced",
    ballotDoubleEntry: false,
    publicDraw: true,
    publicResults: true,
    publicStandings: true,
    publicMotions: true,
    publicCheckInStatus: false,
    checkInExpiresAfterHours: 0,
    feedbackEnabled: true,
    feedbackMinScore: 1,
    feedbackMaxScore: 10,
    feedbackQuestions: [],
    // Tabbycat Draw Rules defaults:
    minAdjScoreToVote: 1.5,
    adjConflictPenalty: 1000000,
    adjHistoryPenalty: 10000,
    importanceMismatchPenalty: 10000000,
    adjudicatorPanelStrategy: "crabbytab_v1",
    usePreformedPanels: false,
    skipAdjCheckins: false,
    noPanellistAdjs: false,
    noTraineeAdjs: false,
    // What the draw uses when the setting was never saved (generator.ts); showing Tabbycat's 1 here
    // would misstate how a tournament with no saved value is drawn.
    teamInstitutionPenalty: 200,
    teamHistoryPenalty: 1000,
    avoidSameInstitution: true,
    avoidTeamHistory: true,
    previouslySawPullupPenalty: 0,
    sideBalancePenalty: 0,
    pairingDeviationPenalty: 0,
    maxTimesPerSide: 5,
    maxAllowedSideImbalance: 0,
    oddBracketMethod: "intermediate_bubble",
    pairingMethod: "fold",
    conflictAvoidance: "one_up_one_down",
    pullupRestriction: "none",
    pullupPenalty: 0,
    bpPullupDistribution: "anywhere",
    bpPositionCost: "renyi_entropy",
    renyiOrder: 1.0,
    bpPositionCostExponent: 4.0,
    bpAssignmentMethod: "hungarian",
    byeTeamResults: "absent",
    byeTeamSelectionMethod: "none",
    marginIncludesDissenters: true,
    ballotIntroExplanation: "",
    teamScoreIncludesGhosts: false,
  };

  const [format, setFormat] = useState<TournamentFormat>(tournament?.format || "bp");
  const [prefs, setPrefs] = useState<TournamentPreferences>(() => ({
    ...defaultPrefs,
    ...(tournament?.preferences || {}),
  }));

  useEffect(() => {
    if (tournament) {
      setFormat(tournament.format || "bp");
      setPrefs((p) => ({
        ...defaultPrefs,
        ...p,
        ...(tournament.preferences || {}),
      }));
    }
  }, [tournament]);

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedbackQuestionError, setFeedbackQuestionError] = useState("");
  const [saveError, setSaveError] = useState("");
  // Once ballots exist, the fields that shape a ballot are fixed (enforced by saveTournament too).
  const lockedFields = lockedSettingsFields(ballots, rounds);
  const ballotShapeLocked = lockedFields.length > 0;
  const eliminationBallotModeLocked = lockedFields.includes("eliminationBallotMode");
  const [questionnaireSource, setQuestionnaireSource] = useState<"team" | "adjudicator">("team");
  const currentFeedbackQuestions = questionnaireSource === "team"
    ? prefs.teamFeedbackQuestions ?? prefs.feedbackQuestions ?? []
    : prefs.adjudicatorFeedbackQuestions ?? prefs.feedbackQuestions ?? [];
  const [prelimRoundCount, setPrelimRoundCount] = useState(0);
  const [isSavingRoundCount, setIsSavingRoundCount] = useState(false);
  const [roundCountError, setRoundCountError] = useState("");
  const [roundToDeleteId, setRoundToDeleteId] = useState("");
  const [showDeleteRoundConfirm, setShowDeleteRoundConfirm] = useState(false);
  const [isDeletingRound, setIsDeletingRound] = useState(false);
  const [deleteRoundError, setDeleteRoundError] = useState("");
  const [roundFeedbackError, setRoundFeedbackError] = useState("");
  const activePrelimCount = rounds.filter((round) => round.stage === "preliminary").length;
  const roundToDelete = rounds.find((round) => round.id === roundToDeleteId);
  const debatesToDelete = roundToDelete ? debates.filter((debate) => debate.roundId === roundToDelete.id) : [];
  const ballotsToDelete = roundToDelete
    ? ballots.filter((ballot) => ballot.roundId === roundToDelete.id || debatesToDelete.some((debate) => debate.id === ballot.debateId))
    : [];
  const roundLabel = (round: { name: string; stage: RoundStage }) =>
    t("setup.config.roundWithStage", { round: round.name, stage: t(STAGE_LABELS[round.stage]) });

  useEffect(() => {
    setPrelimRoundCount(activePrelimCount);
  }, [activePrelimCount]);

  const handleRoundCountSave = async () => {
    if (!Number.isInteger(prelimRoundCount) || prelimRoundCount < 0 || prelimRoundCount > 20) {
      setRoundCountError(t("setup.config.roundCountInvalid"));
      return;
    }

    setIsSavingRoundCount(true);
    setRoundCountError("");
    try {
      await setPreliminaryRoundCount(prelimRoundCount);
    } catch (error) {
      // Messages thrown by the tournament context are shown as they are (English).
      setRoundCountError(error instanceof Error ? error.message : t("setup.config.roundCountFailed"));
    } finally {
      setIsSavingRoundCount(false);
    }
  };

  const handleRoundDelete = async () => {
    if (!roundToDelete) return;
    setIsDeletingRound(true);
    setDeleteRoundError("");
    try {
      await deleteRound(roundToDelete.id);
      setRoundToDeleteId("");
      setShowDeleteRoundConfirm(false);
    } catch (error) {
      setDeleteRoundError(error instanceof Error ? error.message : t("setup.config.deleteRoundFailed"));
    } finally {
      setIsDeletingRound(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournament || isSaving) return;
    if (prefs.feedbackEnabled !== false) {
      // Validation messages come from lib/feedback/questions and are shown as they are (English).
      const questionError = validateFeedbackQuestions(prefs.teamFeedbackQuestions ?? prefs.feedbackQuestions ?? []) ||
        validateFeedbackQuestions(prefs.adjudicatorFeedbackQuestions ?? prefs.feedbackQuestions ?? []);
      if (questionError) {
        setFeedbackQuestionError(questionError);
        return;
      }
    }
    setFeedbackQuestionError("");
    setSaveError("");
    const criteriaErrors = validateScoreCriteria(prefs.scoreCriteria ?? []);
    if (criteriaErrors.length > 0) {
      setSaveError(t("setup.config.scoreCriteriaError", { errors: criteriaErrors.join(" ") }));
      return;
    }

    setIsSaving(true);
    try {
      await saveTournament({
        ...tournament,
        format,
        preferences: prefs,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("setup.config.saveFailed"));
      return;
    } finally {
      setIsSaving(false);
    }

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const updateFeedbackQuestion = (id: string, updates: Partial<FeedbackQuestion>) => {
    setPrefs((current) => ({
      ...current,
      ...(questionnaireSource === "team"
        ? {
            teamFeedbackQuestions: (current.teamFeedbackQuestions ?? current.feedbackQuestions ?? []).map((question) =>
              question.id === id ? { ...question, ...updates } : question
            ),
          }
        : {
            adjudicatorFeedbackQuestions: (current.adjudicatorFeedbackQuestions ?? current.feedbackQuestions ?? []).map((question) =>
              question.id === id ? { ...question, ...updates } : question
            ),
          }),
    }));
  };

  const addFeedbackQuestion = () => {
    const question: FeedbackQuestion = {
      id: `feedback-${globalThis.crypto.randomUUID()}`,
      label: "",
      type: "text",
      required: false,
    };
    setPrefs((current) => ({
      ...current,
      ...(questionnaireSource === "team"
        ? { teamFeedbackQuestions: [...(current.teamFeedbackQuestions ?? current.feedbackQuestions ?? []), question] }
        : { adjudicatorFeedbackQuestions: [...(current.adjudicatorFeedbackQuestions ?? current.feedbackQuestions ?? []), question] }),
    }));
  };

  /** Whole-number penalty fields: clamp at 0, empty becomes 0. */
  const penaltyInput = (
    key:
      | "adjConflictPenalty"
      | "adjHistoryPenalty"
      | "importanceMismatchPenalty"
      | "teamInstitutionPenalty"
      | "teamHistoryPenalty"
      | "previouslySawPullupPenalty"
      | "maxAllowedSideImbalance"
      | "sideBalancePenalty"
      | "pairingDeviationPenalty"
      | "pullupPenalty",
    fallback: number,
    label: MessageKey,
    help: MessageKey,
    extra?: { className?: string; wrapperClassName?: string }
  ) => (
    <Input
      type="number"
      min="0"
      label={t(label)}
      help={t(help)}
      value={prefs[key] ?? fallback}
      onChange={(e) => setPrefs((p) => ({ ...p, [key]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
      className={extra?.className ? `${NUMBER_CLASS} ${extra.className}` : NUMBER_CLASS}
      wrapperClassName={extra?.wrapperClassName}
    />
  );

  return (
    <div className="max-w-4xl space-y-6 pb-12">
      <PageHeader
        title={t(SETTINGS_CATEGORIES[category])}
        description={category === "draw" ? t("setup.config.drawDescription") : undefined}
      />

      <form onSubmit={handleSave} className="space-y-6">
        {/* ============================================================ */}
        {/* 1. DRAW RULES (Tabbycat Draw Rules) */}
        {/* ============================================================ */}
        {category === "draw" && (
          <div className="space-y-6">
            {/* A. Adjudicator Auto-Allocation & Panels */}
            <Card>
              <CardHeader icon={<UserCheck aria-hidden="true" />} title={t("setup.config.adjAllocationTitle")} />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Select
                    label={t("setup.config.adjStrategyLabel")}
                    help={t("setup.config.adjStrategyHelp")}
                    wrapperClassName="sm:col-span-2"
                    value={prefs.adjudicatorPanelStrategy ?? "crabbytab_v1"}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        adjudicatorPanelStrategy: e.target.value as TournamentPreferences["adjudicatorPanelStrategy"],
                      }))
                    }
                  >
                    <option value="crabbytab_v1">{t("setup.config.adjStrategyCrabbytab")}</option>
                    <option value="panel_average">{t("setup.config.adjStrategyPanelAverage")}</option>
                    <option value="tabbycat_voting">{t("setup.config.adjStrategyTabbycatVoting")}</option>
                    <option value="tabbycat_consensus">{t("setup.config.adjStrategyTabbycatConsensus")}</option>
                  </Select>
                  <Checkbox
                    className="sm:col-span-2"
                    label={t("setup.config.preformedPanelsLabel")}
                    description={rich("setup.config.preformedPanelsHelp", {
                      code: (text) => <code className="font-mono">{text}</code>,
                    })}
                    checked={Boolean(prefs.usePreformedPanels)}
                    onChange={(event) => setPrefs((current) => ({
                      ...current,
                      usePreformedPanels: event.target.checked,
                    }))}
                  />
                  {prefs.usePreformedPanels && (
                    <Select
                      wrapperClassName="sm:col-span-2"
                      label={t("setup.config.preformedPlacementLabel")}
                      help={t("setup.config.preformedPlacementHelp")}
                      value={prefs.preformedPanelPlacement ?? "optimise"}
                      onChange={(e) =>
                        setPrefs((p) => ({
                          ...p,
                          preformedPanelPlacement: e.target.value as TournamentPreferences["preformedPanelPlacement"],
                        }))
                      }
                    >
                      <option value="optimise">{t("setup.config.preformedPlacementOptimise")}</option>
                      <option value="direct">{t("setup.config.preformedPlacementDirect")}</option>
                    </Select>
                  )}

                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    label={t("setup.config.minAdjScoreLabel")}
                    help={t("setup.config.minAdjScoreHelp")}
                    value={prefs.minAdjScoreToVote ?? 1.5}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, minAdjScoreToVote: parseFloat(e.target.value) || 0 }))
                    }
                    className={NUMBER_CLASS}
                  />
                  {penaltyInput("adjConflictPenalty", 1000000, "setup.config.adjConflictPenaltyLabel", "setup.config.adjConflictPenaltyHelp")}
                  {penaltyInput("adjHistoryPenalty", 10000, "setup.config.adjHistoryPenaltyLabel", "setup.config.adjHistoryPenaltyHelp")}
                  {penaltyInput(
                    "importanceMismatchPenalty",
                    10000000,
                    "setup.config.importanceMismatchLabel",
                    "setup.config.importanceMismatchHelp"
                  )}
                </div>

                <div className="space-y-3 border-t border-border pt-4">
                  <Checkbox
                    label={t("setup.config.skipAdjCheckinsLabel")}
                    description={t("setup.config.skipAdjCheckinsHelp")}
                    checked={Boolean(prefs.skipAdjCheckins)}
                    onChange={(e) => setPrefs((p) => ({ ...p, skipAdjCheckins: e.target.checked }))}
                  />
                  <Checkbox
                    label={t("setup.config.noPanellistsLabel")}
                    description={t("setup.config.noPanellistsHelp")}
                    checked={Boolean(prefs.noPanellistAdjs)}
                    onChange={(e) => setPrefs((p) => ({ ...p, noPanellistAdjs: e.target.checked }))}
                  />
                  <Checkbox
                    label={t("setup.config.noTraineesLabel")}
                    description={t("setup.config.noTraineesHelp")}
                    checked={Boolean(prefs.noTraineeAdjs)}
                    onChange={(e) => setPrefs((p) => ({ ...p, noTraineeAdjs: e.target.checked }))}
                  />
                </div>
              </CardBody>
            </Card>

            {/* B. Team Clashes & Conflict Avoidance */}
            <Card>
              <CardHeader icon={<Users2 aria-hidden="true" />} title={t("setup.config.teamConflictsTitle")} />
              <CardBody className="space-y-4">
                <div className="space-y-3">
                  <Checkbox
                    label={t("setup.config.avoidInstitutionLabel")}
                    description={t("setup.config.avoidInstitutionHelp")}
                    checked={prefs.avoidSameInstitution !== false}
                    onChange={(e) => setPrefs((p) => ({ ...p, avoidSameInstitution: e.target.checked }))}
                  />
                  <Checkbox
                    label={t("setup.config.avoidHistoryLabel")}
                    description={t("setup.config.avoidHistoryHelp")}
                    checked={prefs.avoidTeamHistory !== false}
                    onChange={(e) => setPrefs((p) => ({ ...p, avoidTeamHistory: e.target.checked }))}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-3">
                  {penaltyInput("teamInstitutionPenalty", 1, "setup.config.teamInstitutionPenaltyLabel", "setup.config.teamInstitutionPenaltyHelp")}
                  {penaltyInput("teamHistoryPenalty", 1000, "setup.config.teamHistoryPenaltyLabel", "setup.config.teamHistoryPenaltyHelp")}
                  {penaltyInput("previouslySawPullupPenalty", 0, "setup.config.sawPullupPenaltyLabel", "setup.config.sawPullupPenaltyHelp")}
                </div>
              </CardBody>
            </Card>

            {/* C. Side Allocations & Balancing */}
            <Card>
              <CardHeader icon={<Scale aria-hidden="true" />} title={t("setup.config.sidesTitle")} />
              <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label={t("setup.config.sideMethodLabel")}
                  help={t("setup.config.sideMethodHelp")}
                  value={prefs.sideAllocationRule || "balanced"}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, sideAllocationRule: e.target.value as TournamentPreferences["sideAllocationRule"] }))
                  }
                >
                  <option value="balanced">{t("setup.config.sideBalanced")}</option>
                  <option value="random">{t("setup.config.sideRandom")}</option>
                  <option value="preallocated">{t("setup.config.sidePreallocated")}</option>
                  <option value="manual_ballot" disabled={format === "bp"}>{t("setup.config.sideManualBallot")}</option>
                </Select>

                <Select
                  label={t("setup.config.eliminationSidesLabel")}
                  help={t("setup.config.eliminationSidesHelp")}
                  value={prefs.eliminationSideRule ?? "by_seed"}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, eliminationSideRule: e.target.value as TournamentPreferences["eliminationSideRule"] }))
                  }
                >
                  <option value="by_seed">{t("setup.config.eliminationSidesBySeed")}</option>
                  <option value="random">{t("setup.config.eliminationSidesRandom")}</option>
                </Select>

                <Input
                  type="number"
                  min="1"
                  label={t("setup.config.maxTimesPerSideLabel")}
                  help={t("setup.config.maxTimesPerSideHelp")}
                  value={prefs.maxTimesPerSide ?? 5}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, maxTimesPerSide: Math.max(1, parseInt(e.target.value, 10) || 1) }))
                  }
                  className={NUMBER_CLASS}
                />
                {penaltyInput("maxAllowedSideImbalance", 0, "setup.config.maxImbalanceLabel", "setup.config.maxImbalanceHelp")}
                {penaltyInput("sideBalancePenalty", 0, "setup.config.sideBalancePenaltyLabel", "setup.config.sideBalancePenaltyHelp")}
                {penaltyInput("pairingDeviationPenalty", 0, "setup.config.pairingDeviationLabel", "setup.config.pairingDeviationHelp")}
              </CardBody>
            </Card>

            {/* D. Two-Team Bracket Matching & Conflict Avoidance */}
            <Card>
              <CardHeader icon={<Shuffle aria-hidden="true" />} title={t("setup.config.bracketsTitle")} />
              <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label={t("setup.config.pairingMethodLabel")}
                  help={t("setup.config.pairingMethodHelp")}
                  value={prefs.pairingMethod ?? "fold"}
                  onChange={(e) => setPrefs((p) => ({ ...p, pairingMethod: e.target.value as PairingMethod }))}
                >
                  <option value="fold">{t("setup.config.pairingFold")}</option>
                  <option value="slide">{t("setup.config.pairingSlide")}</option>
                  <option value="adjacent">{t("setup.config.pairingAdjacent")}</option>
                  <option value="fold_top_adjacent_rest">{t("setup.config.pairingFoldTopAdjacentRest")}</option>
                  <option value="random">{t("setup.config.pairingRandom")}</option>
                </Select>

                <Select
                  label={t("setup.config.conflictAvoidanceLabel")}
                  help={t("setup.config.conflictAvoidanceHelp")}
                  value={prefs.conflictAvoidance ?? "one_up_one_down"}
                  onChange={(e) => setPrefs((p) => ({ ...p, conflictAvoidance: e.target.value as ConflictAvoidance }))}
                >
                  <option value="one_up_one_down">{t("setup.config.conflictOneUpOneDown")}</option>
                  <option value="min_cost">{t("setup.config.conflictMinCost")}</option>
                  <option value="min_cost_with_pullups">{t("setup.config.conflictMinCostPullups")}</option>
                  <option value="off">{t("setup.config.conflictOff")}</option>
                </Select>

                <Select
                  label={t("setup.config.oddBracketLabel")}
                  help={t("setup.config.oddBracketHelp")}
                  value={prefs.oddBracketMethod ?? "intermediate_bubble"}
                  onChange={(e) => setPrefs((p) => ({ ...p, oddBracketMethod: e.target.value as OddBracketMethod }))}
                >
                  <option value="intermediate_bubble">{t("setup.config.oddIntermediateBubble")}</option>
                  <option value="intermediate">{t("setup.config.oddIntermediate")}</option>
                  <option value="intermediate1">{t("setup.config.oddIntermediate1")}</option>
                  <option value="intermediate2">{t("setup.config.oddIntermediate2")}</option>
                  <option value="pullup_top">{t("setup.config.oddPullupTop")}</option>
                  <option value="pullup_bottom">{t("setup.config.oddPullupBottom")}</option>
                  <option value="pullup_middle">{t("setup.config.oddPullupMiddle")}</option>
                  <option value="pullup_random">{t("setup.config.oddPullupRandom")}</option>
                  <option value="pullup_lowest_ds_rank">{t("setup.config.oddPullupLowestDsRank")}</option>
                  <option value="pullup_lowest_ds_rank_npulls">{t("setup.config.oddPullupLowestDsRankNpulls")}</option>
                </Select>

                <Select
                  label={t("setup.config.pullupRestrictionLabel")}
                  help={t("setup.config.pullupRestrictionHelp")}
                  value={prefs.pullupRestriction ?? "none"}
                  onChange={(e) => setPrefs((p) => ({ ...p, pullupRestriction: e.target.value as PullupRestriction }))}
                >
                  <option value="none">{t("setup.config.pullupNone")}</option>
                  <option value="least_pulled">{t("setup.config.pullupLeastPulled")}</option>
                  <option value="lowest_draw_strength_speaks">{t("setup.config.pullupLowestSpeaks")}</option>
                  <option value="lowest_draw_strength_wins">{t("setup.config.pullupLowestWins")}</option>
                </Select>

                {penaltyInput("pullupPenalty", 0, "setup.config.pullupPenaltyLabel", "setup.config.pullupPenaltyHelp", {
                  className: "sm:w-64",
                  wrapperClassName: "sm:col-span-2",
                })}
              </CardBody>
            </Card>

            {/* E. British Parliamentary (BP) Specific Draw Rules */}
            <Card>
              <CardHeader
                icon={<Shield aria-hidden="true" />}
                title={t("setup.config.bpTitle")}
                description={t("setup.config.bpDescription")}
              />
              <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label={t("setup.config.bpPullupLabel")}
                  help={t("setup.config.bpPullupHelp")}
                  value={prefs.bpPullupDistribution ?? "anywhere"}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, bpPullupDistribution: e.target.value as BPPullupDistribution }))
                  }
                >
                  <option value="anywhere">{t("setup.config.bpPullupAnywhere")}</option>
                  <option value="top">{t("setup.config.bpPullupTop")}</option>
                  <option value="bottom">{t("setup.config.bpPullupBottom")}</option>
                </Select>

                <Select
                  label={t("setup.config.bpPositionCostLabel")}
                  help={t("setup.config.bpPositionCostHelp")}
                  value={prefs.bpPositionCost ?? "renyi_entropy"}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, bpPositionCost: e.target.value as BPPositionCost }))
                  }
                >
                  <option value="renyi_entropy">{t("setup.config.bpCostRenyi")}</option>
                  <option value="sum_squared_deviations">{t("setup.config.bpCostSquared")}</option>
                  <option value="simple">{t("setup.config.bpCostSimple")}</option>
                </Select>

                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  label={t("setup.config.renyiOrderLabel")}
                  help={t("setup.config.renyiOrderHelp")}
                  value={prefs.renyiOrder ?? 1.0}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, renyiOrder: parseFloat(e.target.value) || 1.0 }))
                  }
                  className={NUMBER_CLASS}
                />

                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  label={t("setup.config.bpExponentLabel")}
                  help={t("setup.config.bpExponentHelp")}
                  value={prefs.bpPositionCostExponent ?? 4.0}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, bpPositionCostExponent: parseFloat(e.target.value) || 4.0 }))
                  }
                  className={NUMBER_CLASS}
                />

                <Select
                  label={t("setup.config.bpAssignmentLabel")}
                  help={t("setup.config.bpAssignmentHelp")}
                  value={prefs.bpAssignmentMethod ?? "hungarian"}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, bpAssignmentMethod: e.target.value as BPAssignmentMethod }))
                  }
                >
                  <option value="hungarian">{t("setup.config.bpAssignmentHungarian")}</option>
                  <option value="hungarian_unshuffled">{t("setup.config.bpAssignmentUnshuffled")}</option>
                  <option value="random">{t("setup.config.bpAssignmentRandom")}</option>
                </Select>
              </CardBody>
            </Card>

            {/* F. Scheduling & Byes */}
            <Card>
              <CardHeader icon={<Calendar aria-hidden="true" />} title={t("setup.config.byesTitle")} />
              <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  label={t("setup.config.byeResultsLabel")}
                  help={t("setup.config.byeResultsHelp")}
                  value={prefs.byeTeamResults ?? "absent"}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, byeTeamResults: e.target.value as ByeTeamResults }))
                  }
                >
                  <option value="absent">{t("setup.config.byeResultsAbsent")}</option>
                  <option value="win">{t("setup.config.byeResultsWin")}</option>
                </Select>

                <Select
                  label={t("setup.config.byeSelectionLabel")}
                  help={t("setup.config.byeSelectionHelp")}
                  value={prefs.byeTeamSelectionMethod ?? "none"}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, byeTeamSelectionMethod: e.target.value as ByeTeamSelectionMethod }))
                  }
                >
                  <option value="none">{t("setup.config.byeSelectionNone")}</option>
                  <option value="lowest_ranked">{t("setup.config.byeSelectionLowest")}</option>
                  <option value="random">{t("setup.config.byeSelectionRandom")}</option>
                </Select>
              </CardBody>
            </Card>
          </div>
        )}

        {/* ============================================================ */}
        {/* 2. ROUND SETTINGS */}
        {/* ============================================================ */}
        {category === "rounds" && (
          <Card>
            <CardHeader
              icon={<Clock aria-hidden="true" />}
              title={t("setup.config.roundsTitle")}
              description={t("setup.config.roundsDescription")}
            />
            <CardBody className="space-y-6">
              <div className="space-y-1.5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Input
                    id="prelim-round-count"
                    type="number"
                    min={0}
                    max={20}
                    step={1}
                    label={t("setup.config.prelimCountLabel")}
                    error={roundCountError || undefined}
                    value={prelimRoundCount}
                    onChange={(event) => setPrelimRoundCount(Number(event.target.value))}
                    className={`w-32 ${NUMBER_CLASS}`}
                  />
                  <Button
                    variant="secondary"
                    onClick={handleRoundCountSave}
                    disabled={prelimRoundCount === activePrelimCount}
                    loading={isSavingRoundCount}
                    loadingText={t("setup.config.updatingRoundCount")}
                  >
                    {t("setup.config.updateRoundCount")}
                  </Button>
                </div>
                <p className="text-xs text-fg-muted">{t("setup.config.prelimCountHelp")}</p>
              </div>

              <div className="space-y-6 border-t border-border pt-4">
                <section aria-labelledby="feedback-by-round-heading">
                  <h3 id="feedback-by-round-heading" className="text-[13px] font-semibold text-fg">
                    {t("setup.config.feedbackByRoundTitle")}
                  </h3>
                  <p className="mt-0.5 text-xs text-fg-muted">{t("setup.config.feedbackByRoundHelp")}</p>
                  <div className="mt-2 space-y-1">
                    {rounds.map((round) => (
                      <Checkbox
                        key={round.id}
                        className="rounded-md border border-border px-3 py-2"
                        label={roundLabel(round)}
                        checked={round.feedbackEnabled ?? (
                          round.stage !== "elimination" || prefs.feedbackInEliminationRounds !== false
                        )}
                        onChange={(event) => {
                          setRoundFeedbackError("");
                          void updateRound({ ...round, feedbackEnabled: event.target.checked })
                            .catch(() => setRoundFeedbackError(t("setup.config.roundFeedbackFailed", { round: round.name })));
                        }}
                      />
                    ))}
                  </div>
                  {roundFeedbackError && <p role="alert" className="mt-2 text-xs text-danger">{roundFeedbackError}</p>}
                </section>
                <RoundWeightsEditor rounds={rounds} updateRound={updateRound} />
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Select
                    id="delete-round-select"
                    label={t("setup.config.deleteRoundLabel")}
                    wrapperClassName="w-full sm:max-w-xs"
                    value={roundToDeleteId}
                    onChange={(event) => setRoundToDeleteId(event.target.value)}
                  >
                    <option value="">{t("setup.config.deleteRoundPlaceholder")}</option>
                    {rounds.map((round) => (
                      <option key={round.id} value={round.id}>
                        {roundLabel(round)}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="danger"
                    onClick={() => setShowDeleteRoundConfirm(true)}
                    disabled={!roundToDelete || isDeletingRound}
                  >
                    <Trash2 aria-hidden="true" />
                    <span>{t("setup.config.deleteRoundButton")}</span>
                  </Button>
                </div>
                {deleteRoundError && <p role="alert" className="text-xs text-danger">{deleteRoundError}</p>}
              </div>
            </CardBody>
          </Card>
        )}

        {/* ============================================================ */}
        {/* 3. FORMAT & TEAMS */}
        {/* ============================================================ */}
        {category === "format" && (
          <Card>
            <CardHeader
              icon={<Shield aria-hidden="true" />}
              title={t("setup.config.formatTitle")}
              description={t("setup.config.formatDescription")}
            />
            <CardBody className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Select
                label={t("setup.config.formatLabel")}
                help={ballotShapeLocked ? t("setup.config.ballotShapeLocked") : undefined}
                value={format}
                disabled={ballotShapeLocked}
                onChange={(e) => {
                  const newFmt = e.target.value as TournamentFormat;
                  setFormat(newFmt);
                  if (newFmt === "bp") {
                    setPrefs((p) => ({
                      ...p,
                      teamsInDebate: 4,
                      substantiveSpeakers: 2,
                      replyScoresEnabled: false,
                    }));
                  } else {
                    setPrefs((p) => ({
                      ...p,
                      teamsInDebate: 2,
                      substantiveSpeakers: 3,
                      replyScoresEnabled: true,
                    }));
                  }
                }}
              >
                <option value="bp">{t("setup.config.formatBp")}</option>
                <option value="uadc">{t("setup.config.formatUadc")}</option>
                <option value="australs">{t("setup.config.formatAustrals")}</option>
                <option value="wsdc">{t("setup.config.formatWsdc")}</option>
              </Select>

              <Input
                type="number"
                min="1"
                max="5"
                label={t("setup.config.substantiveSpeakersLabel")}
                value={prefs.substantiveSpeakers}
                disabled={ballotShapeLocked}
                onChange={(e) =>
                  setPrefs((p) => ({
                    ...p,
                    substantiveSpeakers: parseInt(e.target.value, 10),
                  }))
                }
                className={NUMBER_CLASS}
              />

              <Checkbox
                className="md:col-span-2"
                label={t("setup.config.replyScoringLabel")}
                description={t("setup.config.replyScoringHelp")}
                checked={Boolean(prefs.replyScoresEnabled)}
                disabled={ballotShapeLocked}
                onChange={(e) => setPrefs((p) => ({ ...p, replyScoresEnabled: e.target.checked }))}
              />
            </CardBody>
          </Card>
        )}

        {/* ============================================================ */}
        {/* 4. SCORING & BALLOTS */}
        {/* ============================================================ */}
        {category === "scoring" && (
          <div className="space-y-6">
            <Card>
              <CardHeader
                icon={<FileCheck2 aria-hidden="true" />}
                title={t("setup.config.speakerScoringTitle")}
                description={t("setup.config.speakerScoringDescription")}
              />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Input
                    type="number"
                    label={t("setup.config.minSpeakerScoreLabel")}
                    help={t("setup.config.defaultValue", { value: 68 })}
                    value={prefs.minSpeakerScore}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, minSpeakerScore: parseFloat(e.target.value) || 68 }))
                    }
                    className={NUMBER_CLASS}
                  />
                  <Input
                    type="number"
                    label={t("setup.config.maxSpeakerScoreLabel")}
                    help={t("setup.config.defaultValue", { value: 84 })}
                    value={prefs.maxSpeakerScore}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, maxSpeakerScore: parseFloat(e.target.value) || 84 }))
                    }
                    className={NUMBER_CLASS}
                  />
                  <Select
                    label={t("setup.config.scoreStepLabel")}
                    help={t("setup.config.scoreStepHelp")}
                    value={prefs.stepSpeakerScore}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, stepSpeakerScore: parseFloat(e.target.value) || 1 }))
                    }
                    className={NUMBER_CLASS}
                  >
                    <option value={1}>{t("setup.config.scoreStepWhole")}</option>
                    <option value={0.5}>{t("setup.config.scoreStepHalf")}</option>
                  </Select>
                </div>

                {prefs.replyScoresEnabled && (
                  <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
                    <Input
                      type="number"
                      label={t("setup.config.minReplyScoreLabel")}
                      help={t("setup.config.minReplyScoreHelp")}
                      value={prefs.minReplyScore ?? 34}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, minReplyScore: parseFloat(e.target.value) || 34 }))
                      }
                      className={NUMBER_CLASS}
                    />
                    <Input
                      type="number"
                      label={t("setup.config.maxReplyScoreLabel")}
                      help={t("setup.config.maxReplyScoreHelp")}
                      value={prefs.maxReplyScore ?? 42}
                      onChange={(e) =>
                        setPrefs((p) => ({ ...p, maxReplyScore: parseFloat(e.target.value) || 42 }))
                      }
                      className={NUMBER_CLASS}
                    />
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Ballot Rules & Options */}
            <Card>
              <CardHeader icon={<FileCheck2 aria-hidden="true" />} title={t("setup.config.ballotRulesTitle")} />
              <CardBody className="space-y-4">
                <Textarea
                  rows={3}
                  label={t("setup.config.ballotIntroLabel")}
                  help={t("setup.config.ballotIntroHelp")}
                  value={prefs.ballotIntroExplanation ?? ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, ballotIntroExplanation: e.target.value }))}
                />

                <Checkbox
                  label={t("setup.config.marginDissentersLabel")}
                  description={t("setup.config.marginDissentersHelp")}
                  checked={prefs.marginIncludesDissenters ?? true}
                  onChange={(e) => setPrefs((p) => ({ ...p, marginIncludesDissenters: e.target.checked }))}
                />
                <Checkbox
                  label={t("setup.config.ghostsLabel")}
                  description={t("setup.config.ghostsHelp")}
                  checked={Boolean(prefs.teamScoreIncludesGhosts)}
                  onChange={(e) => setPrefs((p) => ({ ...p, teamScoreIncludesGhosts: e.target.checked }))}
                />
                <Checkbox
                  label={t("setup.config.doubleEntryLabel")}
                  description={t("setup.config.doubleEntryHelp")}
                  checked={Boolean(prefs.ballotDoubleEntry)}
                  onChange={(e) => setPrefs((p) => ({ ...p, ballotDoubleEntry: e.target.checked }))}
                />

                {prefs.ballotDoubleEntry && (
                  <Select
                    label={t("setup.config.checkModeLabel")}
                    value={prefs.ballotCheckMode ?? "review"}
                    onChange={(e) => setPrefs((p) => ({ ...p, ballotCheckMode: e.target.value as "review" | "blind" }))}
                  >
                    <option value="review">{t("setup.config.checkModeReview")}</option>
                    <option value="blind">{t("setup.config.checkModeBlind")}</option>
                  </Select>
                )}

                {tournament?.format !== "bp" && (
                  <Select
                    label={t("setup.config.prelimBallotModeLabel")}
                    help={t("setup.config.prelimBallotModeHelp")}
                    value={prefs.ballotMode ?? "consensus"}
                    disabled={ballotShapeLocked}
                    onChange={(e) => setPrefs((p) => ({ ...p, ballotMode: e.target.value as "consensus" | "voting" }))}
                  >
                    <option value="consensus">{t("setup.config.ballotModeConsensus")}</option>
                    <option value="voting">{t("setup.config.ballotModeVoting")}</option>
                  </Select>
                )}

                {tournament?.format !== "bp" && (
                  <Select
                    label={t("setup.config.elimBallotModeLabel")}
                    help={eliminationBallotModeLocked
                      ? t("setup.config.elimBallotModeLocked")
                      : t("setup.config.elimBallotModeHelp")}
                    value={prefs.eliminationBallotMode ?? ""}
                    disabled={eliminationBallotModeLocked}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        eliminationBallotMode: (e.target.value || undefined) as "consensus" | "voting" | undefined,
                      }))
                    }
                  >
                    <option value="">{t("setup.config.elimBallotModeSame")}</option>
                    <option value="consensus">{t("setup.config.ballotModeConsensus")}</option>
                    <option value="voting">{t("setup.config.ballotModeVoting")}</option>
                  </Select>
                )}

                {(
                  [
                    ["enableMotionVetoes", "setup.config.motionVetoesLabel", "setup.config.motionVetoesHelp"],
                    ...(tournament?.format !== "bp"
                      ? [["enableForfeits", "setup.config.forfeitsLabel", "setup.config.forfeitsHelp"]]
                      : []),
                  ] as Array<["enableMotionVetoes" | "enableForfeits", MessageKey, MessageKey]>
                ).map(([key, label, help]) => (
                  <Checkbox
                    key={key}
                    label={t(label)}
                    description={t(help)}
                    checked={Boolean(prefs[key])}
                    onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.checked }))}
                  />
                ))}

                <ResultsRulesSettings
                  prefs={prefs}
                  onChange={(patch) => setPrefs((p) => ({ ...p, ...patch }))}
                  format={format}
                  shapeLocked={ballotShapeLocked}
                />
              </CardBody>
            </Card>

            {/* Adjudicator Feedback */}
            <Card>
              <CardHeader icon={<MessageSquare aria-hidden="true" />} title={t("setup.config.feedbackTitle")} />
              <CardBody className="space-y-4">
                <Checkbox
                  label={t("setup.config.feedbackEnabledLabel")}
                  checked={prefs.feedbackEnabled !== false}
                  onChange={(e) => setPrefs((p) => ({ ...p, feedbackEnabled: e.target.checked }))}
                />

                {prefs.feedbackEnabled !== false && (
                  <div className="space-y-4 border-t border-border pt-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        type="number"
                        label={t("setup.config.feedbackMinLabel")}
                        value={prefs.feedbackMinScore ?? 1}
                        onChange={(e) =>
                          setPrefs((p) => ({ ...p, feedbackMinScore: parseInt(e.target.value, 10) || 1 }))
                        }
                        className={NUMBER_CLASS}
                      />
                      <Input
                        type="number"
                        label={t("setup.config.feedbackMaxLabel")}
                        value={prefs.feedbackMaxScore ?? 10}
                        onChange={(e) =>
                          setPrefs((p) => ({ ...p, feedbackMaxScore: parseInt(e.target.value, 10) || 10 }))
                        }
                        className={NUMBER_CLASS}
                      />
                    </div>
                    <FeedbackOptionsFields value={prefs} onChange={(change) => setPrefs((p) => ({ ...p, ...change }))} />
                  </div>
                )}

                {prefs.feedbackEnabled !== false && (
                  <section aria-labelledby="feedback-questions-heading" className="space-y-3 rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 id="feedback-questions-heading" className="text-[13px] font-semibold text-fg">
                          {t("setup.config.questionsTitle")}
                        </h3>
                        <p className="text-xs text-fg-muted">{t("setup.config.questionsDescription")}</p>
                      </div>
                      <Button size="sm" variant="secondary" onClick={addFeedbackQuestion}>
                        {t("setup.config.addQuestion")}
                      </Button>
                    </div>
                    <Select
                      label={t("setup.config.questionnaireLabel")}
                      wrapperClassName="max-w-xs"
                      value={questionnaireSource}
                      onChange={(event) => {
                        if (event.target.value === "team" || event.target.value === "adjudicator") {
                          setQuestionnaireSource(event.target.value);
                        }
                      }}
                    >
                      <option value="team">{t("setup.config.questionnaireTeam")}</option>
                      <option value="adjudicator">{t("setup.config.questionnaireAdjudicator")}</option>
                    </Select>
                    {feedbackQuestionError && (
                      <Alert tone="danger" role="alert">{feedbackQuestionError}</Alert>
                    )}
                    {currentFeedbackQuestions.map((question, index) => (
                      <div key={question.id} className="grid grid-cols-1 gap-3 rounded-md bg-muted p-3 sm:grid-cols-2">
                        <Input
                          label={t("setup.config.questionLabel", { number: index + 1 })}
                          value={question.label}
                          onChange={(event) => updateFeedbackQuestion(question.id, { label: event.target.value })}
                          placeholder={t("setup.config.questionPlaceholder")}
                        />
                        <Select
                          label={t("setup.config.answerTypeLabel")}
                          value={question.type}
                          onChange={(event) => {
                            const type = event.target.value as FeedbackQuestion["type"];
                            // Scales need bounds; start them at what the inputs show.
                            const needsBounds = type === "scale" || type === "integer_scale";
                            updateFeedbackQuestion(question.id, {
                              type,
                              ...(needsBounds ? { min: question.min ?? 1, max: question.max ?? 5 } : {}),
                            });
                          }}
                        >
                          {FEEDBACK_QUESTION_TYPES.map(({ type }) => (
                            <option key={type} value={type}>{t(QUESTION_TYPE_LABELS[type])}</option>
                          ))}
                        </Select>
                        {(question.type === "select_one" || question.type === "select_many") && (
                          <Input
                            label={t("setup.config.optionsLabel")}
                            wrapperClassName="sm:col-span-2"
                            value={(question.options ?? []).join(", ")}
                            onChange={(event) => updateFeedbackQuestion(question.id, {
                              options: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
                            })}
                            placeholder={t("setup.config.optionsPlaceholder")}
                          />
                        )}
                        {(question.type === "scale" || question.type === "integer_scale") && (
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              label={t("setup.config.minimumLabel")}
                              wrapperClassName="flex-1"
                              step={question.type === "integer_scale" ? 1 : "any"}
                              value={question.min ?? 1}
                              onChange={(event) => updateFeedbackQuestion(question.id, { min: Number(event.target.value) })}
                              className={NUMBER_CLASS}
                            />
                            <Input
                              type="number"
                              label={t("setup.config.maximumLabel")}
                              wrapperClassName="flex-1"
                              step={question.type === "integer_scale" ? 1 : "any"}
                              value={question.max ?? 5}
                              onChange={(event) => updateFeedbackQuestion(question.id, { max: Number(event.target.value) })}
                              className={NUMBER_CLASS}
                            />
                          </div>
                        )}
                        {(question.type === "integer" || question.type === "float") && (
                          <div className="flex gap-2">
                            {(["min", "max"] as const).map((bound) => (
                              <Input
                                key={bound}
                                type="number"
                                label={bound === "min" ? t("setup.config.minimumOptionalLabel") : t("setup.config.maximumOptionalLabel")}
                                wrapperClassName="flex-1"
                                step={question.type === "integer" ? 1 : "any"}
                                value={question[bound] ?? ""}
                                onChange={(event) => updateFeedbackQuestion(question.id, {
                                  [bound]: event.target.value === "" ? undefined : Number(event.target.value),
                                })}
                                placeholder={t("setup.config.noLimitPlaceholder")}
                                className={NUMBER_CLASS}
                              />
                            ))}
                          </div>
                        )}
                        <Checkbox
                          className="self-center"
                          label={t("setup.config.questionRequired")}
                          checked={question.required}
                          onChange={(event) => updateFeedbackQuestion(question.id, { required: event.target.checked })}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="justify-self-end text-danger"
                          onClick={() => setPrefs((current) => questionnaireSource === "team"
                            ? {
                                ...current,
                                teamFeedbackQuestions: (current.teamFeedbackQuestions ?? current.feedbackQuestions ?? [])
                                  .filter((item) => item.id !== question.id),
                              }
                            : {
                                ...current,
                                adjudicatorFeedbackQuestions: (current.adjudicatorFeedbackQuestions ?? current.feedbackQuestions ?? [])
                                  .filter((item) => item.id !== question.id),
                              })}
                        >
                          {t("setup.config.removeQuestion")}
                        </Button>
                      </div>
                    ))}
                    <div className="space-y-3 border-t border-border pt-3">
                      <div>
                        <h3 className="text-[13px] font-semibold text-fg">{t("setup.config.feedbackPathsTitle")}</h3>
                        <p className="text-xs text-fg-muted">{t("setup.config.feedbackPathsDescription")}</p>
                      </div>
                      <FeedbackPathsEditor
                        idPrefix="feedback-paths"
                        legend={prefs.eliminationFeedbackPaths ? t("setup.config.pathsPreliminaryRounds") : t("setup.config.pathsAllRounds")}
                        value={preliminaryFeedbackPaths(prefs)}
                        onChange={(feedbackPaths) => setPrefs((current) => ({ ...current, feedbackPaths }))}
                      />
                      <Checkbox
                        label={t("setup.config.feedbackInElimLabel")}
                        checked={prefs.feedbackInEliminationRounds !== false}
                        onChange={(event) => setPrefs((current) => ({
                          ...current,
                          feedbackInEliminationRounds: event.target.checked,
                        }))}
                      />
                      {prefs.feedbackInEliminationRounds !== false && (
                        <Checkbox
                          label={t("setup.config.elimPathsLabel")}
                          checked={Boolean(prefs.eliminationFeedbackPaths)}
                          onChange={(event) => setPrefs((current) => ({
                            ...current,
                            eliminationFeedbackPaths: event.target.checked ? preliminaryFeedbackPaths(current) : undefined,
                          }))}
                        />
                      )}
                      {prefs.feedbackInEliminationRounds !== false && prefs.eliminationFeedbackPaths && (
                        <FeedbackPathsEditor
                          idPrefix="elimination-feedback-paths"
                          legend={t("setup.config.pathsEliminationRounds")}
                          value={prefs.eliminationFeedbackPaths}
                          onChange={(eliminationFeedbackPaths) => setPrefs((current) => ({ ...current, eliminationFeedbackPaths }))}
                        />
                      )}
                    </div>
                  </section>
                )}
              </CardBody>
            </Card>
          </div>
        )}

        {/* ============================================================ */}
        {/* 5. STANDINGS RULES */}
        {/* ============================================================ */}
        {category === "standings" && (
          <Card>
            <CardHeader
              icon={<Trophy aria-hidden="true" />}
              title={t("setup.config.standingsTitle")}
              description={t("setup.config.standingsDescription")}
            />
            <CardBody className="space-y-6">
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-fg">{t("setup.config.teamPrecedenceTitle")}</h3>
                <PrecedenceEditor
                  value={prefs.teamStandingsPrecedence ?? []}
                  onChange={(teamStandingsPrecedence) => setPrefs((p) => ({ ...p, teamStandingsPrecedence }))}
                  labels={TEAM_METRIC_LABELS}
                  disabledIds={[...(format === "bp" ? TWO_TEAM_ONLY_TEAM_METRICS : BP_ONLY_TEAM_METRICS), ...EXTRA_ONLY_TEAM_METRICS]}
                  repeatableIds={REPEATABLE_TEAM_METRICS}
                />
                <p className="text-xs text-fg-muted">{t("setup.config.whoBeatWhomHelp")}</p>
                <p className="text-xs text-fg-muted">
                  {t("setup.config.teamPrecedenceDefault", {
                    chain: resolveTeamPrecedence(format, {}).map((m) => TEAM_METRIC_LABELS[m]).join(" → "),
                  })}
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-fg">{t("setup.config.teamExtraTitle")}</h3>
                <ExtraMetricsEditor
                  value={prefs.teamStandingsExtra ?? []}
                  onChange={(teamStandingsExtra) => setPrefs((p) => ({ ...p, teamStandingsExtra }))}
                  labels={TEAM_METRIC_LABELS}
                  exclude={[...(prefs.teamStandingsPrecedence ?? []), ...RANKING_ONLY_TEAM_METRICS]}
                />
              </section>

              <section className="space-y-2 border-t border-border pt-4">
                <h3 className="text-[13px] font-semibold text-fg">{t("setup.config.speakerPrecedenceTitle")}</h3>
                <PrecedenceEditor
                  value={prefs.speakerStandingsPrecedence ?? []}
                  onChange={(speakerStandingsPrecedence) => setPrefs((p) => ({ ...p, speakerStandingsPrecedence }))}
                  labels={SPEAKER_METRIC_LABELS}
                  disabledIds={format === "bp" ? TWO_TEAM_ONLY_SPEAKER_METRICS : BP_ONLY_SPEAKER_METRICS}
                />
                <p className="text-xs text-fg-muted">{t("setup.config.speakerTeamMetricsHelp")}</p>
                <p className="text-xs text-fg-muted">
                  {t("setup.config.speakerPrecedenceDefault", {
                    chain: resolveSpeakerPrecedence({}).map((m) => SPEAKER_METRIC_LABELS[m]).join(" → "),
                  })}
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-fg">{t("setup.config.speakerExtraTitle")}</h3>
                <ExtraMetricsEditor
                  value={prefs.speakerStandingsExtra ?? []}
                  onChange={(speakerStandingsExtra) => setPrefs((p) => ({ ...p, speakerStandingsExtra }))}
                  labels={SPEAKER_METRIC_LABELS}
                  exclude={prefs.speakerStandingsPrecedence ?? []}
                />
              </section>

              <Input
                type="number"
                min={0}
                label={t("setup.config.speakerTrimLabel")}
                help={t("setup.config.speakerTrimHelp")}
                className={`w-32 ${NUMBER_CLASS}`}
                value={prefs.speakerTrim ?? 1}
                onChange={(e) => setPrefs((p) => ({ ...p, speakerTrim: Math.max(0, Math.floor(Number(e.target.value)) || 0) }))}
              />

              <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
                {(
                  [
                    ["standingsMissedDebates", "setup.config.missedDebatesLabel", "setup.config.missedDebatesHelp"],
                    ["standingsMissedReplies", "setup.config.missedRepliesLabel", "setup.config.missedRepliesHelp"],
                  ] as const
                ).map(([key, label, help]) => (
                  <Input
                    key={key}
                    id={`pref-${key}`}
                    type="number"
                    min={-1}
                    label={t(label)}
                    help={t(help)}
                    className={`w-32 ${NUMBER_CLASS}`}
                    value={prefs[key] ?? -1}
                    onChange={(e) => {
                      const value = Math.floor(Number(e.target.value));
                      setPrefs((p) => ({ ...p, [key]: Number.isFinite(value) && value >= 0 ? value : undefined }));
                    }}
                  />
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {/* ============================================================ */}
        {/* 6. PUBLIC VISIBILITY */}
        {/* ============================================================ */}
        {category === "visibility" && (
          <Card>
            <CardHeader
              icon={<Eye aria-hidden="true" />}
              title={t("setup.config.visibilityTitle")}
              description={t("setup.config.visibilityDescription")}
            />
            <CardBody className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Checkbox
                  label={t("setup.config.publicResultsLabel")}
                  description={t("setup.config.publicResultsHelp")}
                  checked={prefs.publicResults !== false}
                  onChange={(e) => setPrefs((p) => ({ ...p, publicResults: e.target.checked }))}
                />
                <Checkbox
                  label={t("setup.config.publicStandingsLabel")}
                  description={t("setup.config.publicStandingsHelp")}
                  checked={prefs.publicStandings !== false}
                  onChange={(e) => setPrefs((p) => ({ ...p, publicStandings: e.target.checked }))}
                />
                <Checkbox
                  label={t("setup.config.publicMotionsLabel")}
                  description={t("setup.config.publicMotionsHelp")}
                  checked={prefs.publicMotions !== false}
                  onChange={(e) => setPrefs((p) => ({ ...p, publicMotions: e.target.checked }))}
                />
                <Checkbox
                  label={t("setup.config.publicCheckinsLabel")}
                  description={t("setup.config.publicCheckinsHelp")}
                  checked={prefs.publicCheckInStatus === true}
                  onChange={(e) => setPrefs((p) => ({ ...p, publicCheckInStatus: e.target.checked }))}
                />
                <Checkbox
                  label={t("setup.config.selfCheckinLabel")}
                  description={t("setup.config.selfCheckinHelp")}
                  checked={prefs.allowSelfCheckIn === true}
                  onChange={(e) => setPrefs((p) => ({ ...p, allowSelfCheckIn: e.target.checked }))}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  label={t("setup.config.checkinExpiryLabel")}
                  help={t("setup.config.checkinExpiryHelp")}
                  value={prefs.checkInExpiresAfterHours ?? 0}
                  onChange={(event) => setPrefs((current) => ({
                    ...current,
                    checkInExpiresAfterHours: Math.max(0, Number(event.target.value) || 0),
                  }))}
                  className={NUMBER_CLASS}
                />
                <Input
                  type="number"
                  min="0"
                  step="1"
                  label={t("setup.config.roomCheckinExpiryLabel")}
                  help={t("setup.config.roomCheckinExpiryHelp")}
                  value={prefs.venueCheckInExpiresAfterHours ?? 0}
                  onChange={(event) => setPrefs((current) => ({
                    ...current,
                    venueCheckInExpiresAfterHours: Math.max(0, Number(event.target.value) || 0),
                  }))}
                  className={NUMBER_CLASS}
                />
                <Select
                  label={t("setup.config.publicLanguageLabel")}
                  help={t("setup.config.publicLanguageHelp")}
                  value={prefs.publicLanguage ?? ""}
                  onChange={(event) => setPrefs((current) => {
                    // Drop the key rather than store undefined, which Firestore rejects.
                    const next = { ...current };
                    if (event.target.value) next.publicLanguage = event.target.value;
                    else delete next.publicLanguage;
                    return next;
                  })}
                >
                  <option value="">{t("setup.config.publicLanguageBrowser")}</option>
                  {LOCALES.map((locale) => (
                    <option key={locale.code} value={locale.code}>
                      {"machineDrafted" in locale && locale.machineDrafted
                        ? t("setup.config.localeMachineDrafted", { language: locale.englishName })
                        : locale.englishName}
                    </option>
                  ))}
                </Select>
              </div>

              <PublicSiteSettingsFields prefs={prefs} setPrefs={setPrefs} />
            </CardBody>
          </Card>
        )}

        {/* Submit */}
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-fg-muted">
            {rich(
              "setup.config.changesApplyTo",
              { b: (text) => <strong className="font-semibold text-fg">{text}</strong> },
              { tournament: tournament?.name ?? "" }
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div role="status" aria-live="polite">
              {savedSuccess && <StatusPill tone="success">{t("setup.config.settingsSaved")}</StatusPill>}
            </div>
            <Button
              type="submit"
              variant="primary"
              loading={isSaving}
              loadingText={t("setup.common.saving")}
            >
              <Save aria-hidden="true" />
              <span>{t("setup.config.saveSettings")}</span>
            </Button>
          </div>
        </div>
        {saveError && (
          <Alert tone="danger" role="alert">{saveError}</Alert>
        )}
      </form>

      {category === "format" && tournament && (
        <TeamNamingCard
          tournament={tournament}
          teams={teams}
          institutions={institutions}
          onSaveTournament={saveTournament}
          onSaveTeams={async (teamsUpdated) => {
            await saveEntityBatch({ teamsUpdated }, "Team names");
          }}
        />
      )}

      {category === "format" && tournament && (
        <ConfigTransferCard
          tournament={tournament}
          preferences={tournament.preferences}
          lockedFields={lockedFields}
          hasDebates={debates.length > 0}
          onSave={saveTournament}
        />
      )}

      {showDeleteRoundConfirm && roundToDelete && (
        <ConfirmActionDialog
          title={t("setup.config.deleteRoundTitle", { round: roundToDelete.name })}
          description={t("setup.config.deleteRoundDescription", {
            debates: plural("setup.config.debateCount", debatesToDelete.length),
            ballots: plural("setup.config.ballotCount", ballotsToDelete.length),
          })}
          confirmLabel={t("setup.config.deleteRoundConfirm")}
          onConfirm={handleRoundDelete}
          onCancel={() => setShowDeleteRoundConfirm(false)}
          variant="danger"
          isBusy={isDeletingRound}
          error={deleteRoundError}
        />
      )}
    </div>
  );
}

export default function ConfigForm({ category }: { category: SettingsCategory }) {
  return <ConfigFormContent category={category} />;
}
