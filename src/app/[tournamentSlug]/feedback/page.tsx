"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { MessageSquareHeart, Plus, Users2, Lock, Printer, ClipboardList, Scale, Download, Search } from "lucide-react";
import { adjudicatorScoresCsv, csvFileStem, feedbackSubmissionsCsv } from "@/lib/csv/exporters";
import { downloadCsv } from "@/lib/csv/download";
import { validateFeedbackScore } from "@/lib/scoring/validator";
import type { FeedbackAnswer, FeedbackWeightKey } from "@/types";
import { FeedbackQuestionFields } from "@/components/feedback/FeedbackQuestionFields";
import { validateFeedbackAnswers, questionsForFeedbackSource } from "@/lib/feedback/questions";
import {
  FEEDBACK_SOURCE_ROLES,
  FEEDBACK_TARGET_ROLES,
  blendAdjudicatorScore,
  calculateFeedbackSummaries,
  isFeedbackCountedForScore,
} from "@/lib/feedback/scores";
import { feedbackSourcesForTarget, roundFeedbackProgress, unexpectedFeedback } from "@/lib/feedback/progress";
import { defaultFeedbackScore, feedbackScoreStep } from "@/lib/scoring/validator";
import { describeFeedbackPaths, feedbackPathsForRound } from "@/lib/feedback/paths";
import { adminFeedbackLinkError } from "@/features/tournament/application/feedback";
import { AdjudicatorFlagToggle } from "@/features/tournament/components/AdjudicatorFlagToggle";
import { mayEditAdjudicatorScores } from "@/lib/staffPermissions";
import { BulkScoreUpdate } from "@/features/tournament/components/BulkScoreUpdate";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Dialog } from "@/components/ui/Dialog";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/components/ui/cn";

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs font-medium text-fg-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</div>
      {detail && <p className="mt-0.5 text-xs text-fg-muted">{detail}</p>}
    </div>
  );
}

export default function FeedbackPage() {
  const {
    tournament,
    rounds,
    activeRound,
    debates,
    teams,
    adjudicators,
    feedback,
    addFeedback,
    saveTournament,
    isOwnerOrAdmin,
    isDataEntryAssistant,
    staffPermissions,
  } = useTournament();
  // Breaking and tester flags: administrators and staff with adjudicators.scores_edit (synced
  // through the data-entry sync).
  const canEditScores = mayEditAdjudicatorScores({ isOwnerOrAdmin, isDataEntryAssistant, permissions: staffPermissions });
  const { t, plural, rich, richPlural, formatNumber, formatDecimal, formatList } = useI18n();
  const preferences = tournament?.preferences;
  const feedbackEnabled = preferences?.feedbackEnabled !== false;
  const minScore = preferences?.feedbackMinScore ?? 1;
  const maxScore = preferences?.feedbackMaxScore ?? 10;

  const [showModal, setShowModal] = useState(false);
  const [targetAdjId, setTargetAdjId] = useState("");
  const [entryRoundId, setEntryRoundId] = useState("");
  const [entryDebateId, setEntryDebateId] = useState("");
  const [entrySourceKey, setEntrySourceKey] = useState("");
  const [score, setScore] = useState(defaultFeedbackScore(preferences));
  const [agree, setAgree] = useState(true);
  const [comments, setComments] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, FeedbackAnswer>>({});
  const [progressRoundId, setProgressRoundId] = useState("");
  const [weightsDraft, setWeightsDraft] = useState<Partial<Record<FeedbackWeightKey, number>> | null>(null);
  const [weightsMessage, setWeightsMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const adjudicatorsById = useMemo(() => new Map(adjudicators.map((adj) => [adj.id, adj])), [adjudicators]);
  const roundsById = useMemo(() => new Map(rounds.map((round) => [round.id, round])), [rounds]);
  const debatesById = useMemo(() => new Map(debates.map((debate) => [debate.id, debate])), [debates]);
  const orderedRounds = useMemo(
    () => [...rounds].filter((round) => !round.cancelled).sort((a, b) => a.seq - b.seq),
    [rounds]
  );

  const roleLabel = (role: string) =>
    role === "team"
      ? t("results.feedback.role.team")
      : role === "chair"
      ? t("role.chair")
      : role === "panellist"
      ? t("role.panellist")
      : role === "trainee"
      ? t("role.trainee")
      : role;
  const percent = (fraction: number) => formatNumber(fraction, { style: "percent", maximumFractionDigits: 0 });

  // ─── Admin entry: judge → round → debate → source ───
  const separator = entrySourceKey.indexOf(":");
  const entrySourceType: "team" | "adjudicator" | undefined =
    separator > 0 ? (entrySourceKey.slice(0, separator) === "team" ? "team" : "adjudicator") : undefined;
  const entrySourceId = separator > 0 ? entrySourceKey.slice(separator + 1) : "";
  const feedbackQuestions = questionsForFeedbackSource(entrySourceType ?? "team", preferences);
  const targetDebates = useMemo(
    () =>
      debates.filter((debate) => {
        if (!targetAdjId || debate.byeTeamId) return false;
        if (entryRoundId && debate.roundId !== entryRoundId) return false;
        const panel = debate.adjudicators;
        return panel?.chairId === targetAdjId ||
          panel?.panellistIds?.includes(targetAdjId) ||
          panel?.traineeIds?.includes(targetAdjId);
      }),
    [debates, targetAdjId, entryRoundId]
  );
  const entryDebate = entryDebateId ? debatesById.get(entryDebateId) : undefined;
  const sourceOptions = entryDebate && targetAdjId
    ? feedbackSourcesForTarget(
        entryDebate,
        targetAdjId,
        feedbackPathsForRound(preferences, roundsById.get(entryDebate.roundId))
      )
    : [];
  // These fallbacks are saved into the submission (sourceName), so they stay in English.
  const sourceName = (type: "team" | "adjudicator", id: string) =>
    type === "team" ? teamsById.get(id)?.name ?? "Team" : adjudicatorsById.get(id)?.name ?? "Adjudicator";

  const resetEntry = () => {
    setTargetAdjId("");
    setEntryRoundId("");
    setEntryDebateId("");
    setEntrySourceKey("");
    setComments("");
    setAnswers({});
    setFormError("");
  };

  const handleCreateFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!entryDebate || !entrySourceType || !entrySourceId) {
      setFormError(t("results.feedback.entry.missingFields"));
      return;
    }
    const link = {
      roundId: entryDebate.roundId,
      debateId: entryDebate.id,
      targetAdjudicatorId: targetAdjId,
      sourceType: entrySourceType,
      sourceId: entrySourceId,
    };
    const linkError = adminFeedbackLinkError(link, debates);
    if (linkError) {
      setFormError(linkError);
      return;
    }
    const check = validateFeedbackScore(score, preferences);
    if (!check.valid && check.error) {
      setFormError(check.error);
      return;
    }
    const answerError = validateFeedbackAnswers(feedbackQuestions, answers);
    if (answerError) {
      setFormError(answerError);
      return;
    }

    setSubmitting(true);
    try {
      await addFeedback({
        ...link,
        targetType: "adjudicator",
        targetAdjudicatorName: adjudicatorsById.get(targetAdjId)?.name || "Adjudicator",
        sourceName: sourceName(entrySourceType, entrySourceId),
        score,
        agreeWithDecision: agree,
        comments: comments.trim(),
        answers,
        confirmed: true,
      });
      resetEntry();
      setShowModal(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("results.feedback.entry.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Scores ───
  const summaries = useMemo(
    () => calculateFeedbackSummaries(feedback, debates, preferences),
    [feedback, debates, preferences]
  );
  const countedFeedback = feedback.filter(isFeedbackCountedForScore);
  const agreement = useMemo(() => {
    const map = new Map<string, { agrees: number; answered: number }>();
    for (const item of feedback) {
      if (!isFeedbackCountedForScore(item) || item.agreeWithDecision === undefined) continue;
      const stat = map.get(item.targetAdjudicatorId!) ?? { agrees: 0, answered: 0 };
      stat.answered += 1;
      if (item.agreeWithDecision) stat.agrees += 1;
      map.set(item.targetAdjudicatorId!, stat);
    }
    return map;
  }, [feedback]);
  const filteredAdjs = adjudicators.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()));

  // ─── Admin-only exports (sources, comments and scores are private) ───
  const exportFeedbackCsv = () => {
    downloadCsv(
      `${csvFileStem(tournament?.name ?? "Tournament")}_Feedback_ADMIN_ONLY.csv`,
      feedbackSubmissionsCsv(feedback, {
        rounds,
        teams,
        adjudicators,
        questions: [
          ...(preferences?.teamFeedbackQuestions ?? []),
          ...(preferences?.adjudicatorFeedbackQuestions ?? []),
          ...(preferences?.feedbackQuestions ?? []),
        ],
      })
    );
  };
  const exportScoresCsv = () => {
    downloadCsv(
      `${csvFileStem(tournament?.name ?? "Tournament")}_Adjudicator_Scores_ADMIN_ONLY.csv`,
      adjudicatorScoresCsv(adjudicators.map((adj) => {
        const summary = summaries.get(adj.id);
        return {
          adjudicator: adj,
          feedbackCount: summary?.count ?? 0,
          feedbackAverage: summary?.average,
          score: blendAdjudicatorScore(adj, summary?.scaledAverage, activeRound?.feedbackWeight),
        };
      }))
    );
  };

  // ─── Progress ───
  const progressRound = roundsById.get(progressRoundId) ?? activeRound ?? orderedRounds[orderedRounds.length - 1];
  const progress = useMemo(
    () =>
      progressRound
        ? roundFeedbackProgress(
            progressRound,
            debates,
            feedback,
            feedbackPathsForRound(preferences, progressRound),
            preferences?.feedbackInEliminationRounds !== false
          )
        : undefined,
    [progressRound, debates, feedback, preferences]
  );
  // Tabbycat's show_unexpected_feedback: submissions no path expected in this round.
  const unexpected = useMemo(
    () =>
      progressRound && preferences?.showUnexpectedFeedback !== false
        ? unexpectedFeedback(progressRound, debates, feedback, feedbackPathsForRound(preferences, progressRound))
        : [],
    [progressRound, debates, feedback, preferences]
  );

  // ─── Source weights ───
  const savedWeights = preferences?.feedbackSourceWeights ?? {};
  const weights = weightsDraft ?? savedWeights;
  const saveWeights = async () => {
    if (!tournament || !weightsDraft) return;
    setWeightsMessage(null);
    try {
      await saveTournament({
        ...tournament,
        preferences: { ...tournament.preferences, feedbackSourceWeights: weightsDraft },
      });
      setWeightsDraft(null);
      setWeightsMessage({ kind: "success", text: t("results.feedback.weights.saved") });
    } catch (error) {
      setWeightsMessage({
        kind: "error",
        text: error instanceof Error ? error.message : t("results.feedback.weights.saveFailed"),
      });
    }
  };

  if (!feedbackEnabled) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("results.feedback.title")} />
        <EmptyState
          icon={<Lock />}
          title={t("results.feedback.disabledTitle")}
          description={t("results.feedback.disabledBody")}
        />
      </div>
    );
  }

  const scoreWeightHint = activeRound
    ? t("results.feedback.scoreWeightHint", { round: activeRound.name })
    : t("results.feedback.scoreWeightHintNoRound");
  const debateLabel = (debateId: string) => debatesById.get(debateId)?.venueName ?? t("results.feedback.debateFallback");
  const adjudicatorLabel = (adjudicatorId: string | undefined, savedName?: string) =>
    savedName ?? adjudicatorsById.get(adjudicatorId ?? "")?.name ?? t("results.feedback.adjudicatorFallback");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("results.feedback.title")}
        description={t("results.feedback.description", { min: minScore, max: maxScore })}
        actions={
          <>
            <Link href={`/${tournament?.slug}/feedback/submissions`} className={buttonClasses({ variant: "secondary" })}>
              <Users2 aria-hidden="true" />
              {t("results.feedback.viewSubmissions")}
            </Link>
            <Link href={`/${tournament?.slug}/feedback/duplicates`} className={buttonClasses({ variant: "ghost" })}>
              {t("results.feedback.duplicates.link")}
            </Link>
            {isOwnerOrAdmin && (
              <>
                <Button onClick={exportFeedbackCsv} title={t("results.feedback.exportFeedbackHint")}>
                  <Download aria-hidden="true" />
                  {t("results.feedback.exportFeedback")}
                </Button>
                <Button
                  onClick={exportScoresCsv}
                  title={
                    activeRound
                      ? t("results.feedback.exportScoresHint", { round: activeRound.name })
                      : t("results.feedback.exportScoresHintNoRound")
                  }
                >
                  <Download aria-hidden="true" />
                  {t("results.feedback.exportScores")}
                </Button>
              </>
            )}
            <Link href={`/${tournament?.slug}/print/feedback`} className={buttonClasses({ variant: "secondary" })}>
              <Printer aria-hidden="true" />
              {t("results.feedback.printForms")}
            </Link>
            <Button
              variant="primary"
              onClick={() => {
                resetEntry();
                setScore(defaultFeedbackScore(preferences));
                setShowModal(true);
              }}
            >
              <Plus aria-hidden="true" />
              {t("results.feedback.enterFeedback")}
            </Button>
          </>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label={t("results.feedback.stat.forms")}
          value={formatNumber(feedback.length)}
          detail={plural("results.feedback.stat.counted", countedFeedback.length)}
        />
        <StatTile label={t("results.feedback.stat.judgesEvaluated")} value={formatNumber(summaries.size)} />
        <StatTile
          label={t("results.feedback.stat.averageCounted")}
          value={
            countedFeedback.length > 0
              ? formatDecimal(countedFeedback.reduce((sum, f) => sum + f.score, 0) / countedFeedback.length, 2)
              : "—"
          }
        />
      </div>

      {/* Progress */}
      <Card>
        <CardHeader
          icon={<ClipboardList aria-hidden="true" />}
          title={t("results.feedback.progress.title")}
          actions={
            <Select
              aria-label={t("results.feedback.progress.round")}
              className="w-44"
              value={progressRound?.id ?? ""}
              onChange={(event) => setProgressRoundId(event.target.value)}
            >
              {orderedRounds.map((round) => (
                <option key={round.id} value={round.id}>{round.name}</option>
              ))}
            </Select>
          }
        />
        <CardBody className="space-y-3 text-[13px]">
          {!progress ? (
            <p className="text-fg-muted">{t("results.feedback.noRounds")}</p>
          ) : !progress.enabled ? (
            <p className="text-fg-muted">{t("results.feedback.progress.off", { round: progressRound?.name ?? "" })}</p>
          ) : progress.expected === 0 ? (
            <p className="text-fg-muted">{t("results.feedback.progress.noDebates", { round: progressRound?.name ?? "" })}</p>
          ) : (
            <>
              <p className="text-fg">
                {rich(
                  "results.feedback.progress.received",
                  { b: (text) => <strong className="font-semibold">{text}</strong> },
                  {
                    submitted: progress.submitted,
                    expected: progress.expected,
                    percent: percent(progress.submitted / progress.expected),
                  }
                )}{" "}
                {richPlural(
                  "results.feedback.progress.outstanding",
                  progress.outstanding.length,
                  { b: (text) => <strong className="font-semibold">{text}</strong> },
                  {
                    teams: progress.outstanding.filter((item) => item.sourceType === "team").length,
                    adjudicators: progress.outstanding.filter((item) => item.sourceType === "adjudicator").length,
                  }
                )}
              </p>
              <p className="text-xs text-fg-muted">
                {t("results.feedback.progress.expectedPaths", {
                  round: progressRound?.name ?? "",
                  paths: describeFeedbackPaths(feedbackPathsForRound(preferences, progressRound)),
                })}
              </p>
              {progress.outstanding.length > 0 && (
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {progress.outstanding.map((item) => (
                    <li key={`${item.sourceType}-${item.sourceId}-${item.debateId}`} className="px-3 py-1.5 text-fg-muted">
                      {rich(
                        "results.feedback.progress.owes",
                        { b: (text) => <span className="font-semibold text-fg">{text}</span> },
                        {
                          source: sourceName(item.sourceType, item.sourceId),
                          role: roleLabel(item.sourceRole),
                          venue: debateLabel(item.debateId),
                          targets: formatList(
                            item.owed.map((owed) =>
                              t("results.feedback.nameWithRole", {
                                name: adjudicatorLabel(owed.targetAdjudicatorId),
                                role: roleLabel(owed.targetRole),
                              })
                            )
                          ),
                        }
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {unexpected.length > 0 && (
                <details className="rounded-md border border-border px-3 py-1.5">
                  <summary className={cn("cursor-pointer rounded-sm text-fg", focusRing)}>
                    <span aria-hidden="true">? </span>
                    {plural("results.feedback.progress.unexpected", unexpected.length)}
                  </summary>
                  <ul className="mt-1 divide-y divide-border text-fg-muted">
                    {unexpected.map((submission) => (
                      <li key={submission.id} className="py-1">
                        {t("results.feedback.progress.unexpectedItem", {
                          source: submission.sourceName,
                          target: adjudicatorLabel(submission.targetAdjudicatorId, submission.targetAdjudicatorName),
                          venue: debateLabel(submission.debateId),
                        })}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {/* Source weights */}
      {isOwnerOrAdmin && (
        <Card>
          <CardHeader
            icon={<Scale aria-hidden="true" />}
            title={t("results.feedback.weights.title")}
            description={t("results.feedback.weights.help")}
            actions={
              <Button variant="primary" size="sm" onClick={saveWeights} disabled={!weightsDraft}>
                {t("results.feedback.weights.save")}
              </Button>
            }
          />
          <CardBody className="space-y-3">
            {weightsMessage && (
              <Alert
                tone={weightsMessage.kind === "error" ? "danger" : "success"}
                role={weightsMessage.kind === "error" ? "alert" : "status"}
                title={weightsMessage.text}
              />
            )}
            <div className="overflow-x-auto">
              <table className="text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="pe-3 text-start text-xs font-medium text-fg-muted">
                      {t("results.feedback.weights.corner")}
                    </th>
                    {FEEDBACK_TARGET_ROLES.map((target) => (
                      <th key={target} scope="col" className="px-2 pb-1 text-xs font-medium text-fg-muted">
                        {roleLabel(target)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEEDBACK_SOURCE_ROLES.map((source) => (
                    <tr key={source}>
                      <th scope="row" className="pe-3 text-start font-medium text-fg">{roleLabel(source)}</th>
                      {FEEDBACK_TARGET_ROLES.map((target) => {
                        const key = `${source}_on_${target}` as FeedbackWeightKey;
                        const same = source === target && source === "chair";
                        return (
                          <td key={target} className="px-2 py-1 text-center">
                            {same ? (
                              <span className="text-fg-subtle" aria-hidden="true">—</span>
                            ) : (
                              <Input
                                type="number"
                                min={0}
                                step={0.25}
                                value={weights[key] ?? 1}
                                aria-label={t("results.feedback.weights.inputLabel", {
                                  source: roleLabel(source),
                                  target: roleLabel(target),
                                })}
                                onChange={(event) => {
                                  const value = parseFloat(event.target.value);
                                  setWeightsMessage(null);
                                  setWeightsDraft({
                                    ...weights,
                                    [key]: Number.isFinite(value) && value >= 0 ? value : 1,
                                  });
                                }}
                                className="w-20 px-1 text-center font-mono"
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Ratings */}
      <Card>
        <CardHeader
          title={t("results.feedback.ratings.title")}
          actions={
            <Input
              type="search"
              leadingIcon={<Search />}
              placeholder={t("results.feedback.ratings.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t("results.feedback.ratings.searchLabel")}
              wrapperClassName="w-56"
              className="w-56"
            />
          }
        />
        <TableContainer className="max-h-[calc(100vh-16rem)] rounded-none border-0">
          <Table>
            <THead>
              <TR>
                <TH>{t("results.feedback.ratings.col.name")}</TH>
                <TH>{t("results.feedback.ratings.col.institution")}</TH>
                <TH align="right">{t("results.feedback.ratings.col.base")}</TH>
                <TH align="right">{t("results.feedback.ratings.col.test")}</TH>
                <TH align="right">{t("results.feedback.ratings.col.counted")}</TH>
                <TH align="right">{t("results.feedback.ratings.col.weightedAverage")}</TH>
                <TH align="right" title={scoreWeightHint}>{t("results.feedback.field.score")}</TH>
                <TH align="right">{t("results.feedback.ratings.col.agreement")}</TH>
                {canEditScores && (
                  <>
                    <TH align="center" title={t("results.feedback.tester.breakingHelp")}>
                      {t("results.feedback.tester.breakingColumn")}
                    </TH>
                    <TH align="center" title={t("results.feedback.tester.columnHelp")}>
                      {t("results.feedback.tester.column")}
                    </TH>
                  </>
                )}
              </TR>
            </THead>
            <TBody>
              {filteredAdjs.map((adj) => {
                const summary = summaries.get(adj.id);
                const stat = agreement.get(adj.id);
                return (
                  <TR key={adj.id}>
                    <TD className="font-medium">
                      <Link
                        href={`/${tournament?.slug}/feedback/adjudicator/${adj.id}`}
                        className={cn("rounded-sm text-accent-text hover:underline", focusRing)}
                      >
                        {adj.name}
                      </Link>
                    </TD>
                    <TD className="text-fg-muted">{adj.institutionName || "—"}</TD>
                    <TD numeric>{formatDecimal(adj.baseScore ?? 5, 1)}</TD>
                    <TD numeric>{adj.testScore === undefined ? "—" : formatDecimal(adj.testScore, 1)}</TD>
                    <TD numeric>{formatNumber(summary?.count ?? 0)}</TD>
                    <TD numeric>{summary ? formatDecimal(summary.average, 2) : "—"}</TD>
                    <TD numeric className="font-semibold">
                      {formatDecimal(blendAdjudicatorScore(adj, summary?.scaledAverage, activeRound?.feedbackWeight), 2)}
                    </TD>
                    <TD numeric>{stat && stat.answered > 0 ? percent(stat.agrees / stat.answered) : "—"}</TD>
                    {canEditScores && (
                      <>
                        <TD align="center">
                          <AdjudicatorFlagToggle
                            adjudicator={adj}
                            flag="breaking"
                            label={t("results.feedback.tester.breakingLabel", { name: adj.name })}
                          />
                        </TD>
                        <TD align="center">
                          <AdjudicatorFlagToggle
                            adjudicator={adj}
                            flag="isTester"
                            label={t("results.feedback.tester.label", { name: adj.name })}
                            disabled={adj.adjCore === true}
                            disabledReason={t("results.feedback.tester.coreAlways")}
                          />
                        </TD>
                      </>
                    )}
                  </TR>
                );
              })}
              {filteredAdjs.length === 0 && (
                <TableEmpty colSpan={canEditScores ? 10 : 8}>
                  {adjudicators.length === 0 ? t("results.feedback.ratings.emptyNone") : t("results.feedback.ratings.emptySearch")}
                </TableEmpty>
              )}
            </TBody>
          </Table>
        </TableContainer>
        <p className="border-t border-border px-4 py-2 text-xs text-fg-muted">
          {t("results.feedback.ratings.footnote")} {scoreWeightHint}
        </p>
      </Card>

      {canEditScores && <BulkScoreUpdate />}

      {/* Entry dialog */}
      <Dialog
        open={showModal}
        onClose={() => setShowModal(false)}
        dismissible={!submitting}
        icon={<MessageSquareHeart aria-hidden="true" />}
        title={t("results.feedback.entry.title")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              form="feedback-entry-form"
              variant="primary"
              loading={submitting}
              loadingText={t("results.feedback.saving")}
            >
              {t("results.feedback.entry.save")}
            </Button>
          </>
        }
      >
        <form id="feedback-entry-form" onSubmit={handleCreateFeedback} className="space-y-4">
          {formError && <Alert tone="danger" role="alert" title={formError} />}

          <Select
            label={t("results.feedback.entry.judge")}
            required
            value={targetAdjId}
            onChange={(e) => {
              setTargetAdjId(e.target.value);
              setEntryDebateId("");
              setEntrySourceKey("");
            }}
          >
            <option value="">{t("results.feedback.entry.selectJudge")}</option>
            {adjudicators.map((a) => (
              <option key={a.id} value={a.id}>
                {t("results.feedback.entry.judgeOption", {
                  name: a.name,
                  institution: a.institutionName || t("common.independent"),
                })}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label={t("results.feedback.field.round")}
              value={entryRoundId}
              onChange={(e) => {
                setEntryRoundId(e.target.value);
                setEntryDebateId("");
                setEntrySourceKey("");
              }}
            >
              <option value="">{t("results.feedback.entry.anyRound")}</option>
              {orderedRounds.map((round) => (
                <option key={round.id} value={round.id}>{round.name}</option>
              ))}
            </Select>
            <Select
              label={t("results.feedback.entry.debate")}
              required
              value={entryDebateId}
              disabled={!targetAdjId}
              onChange={(e) => {
                setEntryDebateId(e.target.value);
                setEntrySourceKey("");
              }}
            >
              <option value="">
                {targetAdjId
                  ? targetDebates.length
                    ? t("feedbackQuestions.choose")
                    : t("results.feedback.entry.noDebates")
                  : t("results.feedback.entry.pickJudgeFirst")}
              </option>
              {targetDebates.map((debate) => (
                <option key={debate.id} value={debate.id}>
                  {t("results.feedback.entry.debateOption", {
                    round: roundsById.get(debate.roundId)?.abbreviation || roundsById.get(debate.roundId)?.name || "",
                    debate:
                      debate.venueName ||
                      Object.values(debate.teams)
                        .map((slot) => slot.teamName)
                        .join(t("results.feedback.entry.versusSeparator")),
                  })}
                </option>
              ))}
            </Select>
          </div>

          <Select
            label={t("results.feedback.entry.submittedBy")}
            required
            value={entrySourceKey}
            disabled={!entryDebate}
            onChange={(e) => {
              setEntrySourceKey(e.target.value);
              setAnswers({});
            }}
          >
            <option value="">
              {entryDebate ? t("results.feedback.entry.chooseSource") : t("results.feedback.entry.pickDebateFirst")}
            </option>
            {sourceOptions.map((option) => (
              <option key={`${option.sourceType}:${option.sourceId}`} value={`${option.sourceType}:${option.sourceId}`}>
                {t("results.feedback.nameWithRole", {
                  name: sourceName(option.sourceType, option.sourceId),
                  role: roleLabel(option.sourceRole),
                })}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <Input
              label={t("results.feedback.entry.score", { min: minScore, max: maxScore })}
              type="number"
              min={minScore}
              max={maxScore}
              step={feedbackScoreStep(preferences)}
              value={score}
              onChange={(e) => setScore(parseFloat(e.target.value) || minScore)}
              className="font-mono"
            />
            <Checkbox
              className="pb-1.5"
              label={t("results.feedback.entry.agreed")}
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
          </div>

          <Textarea
            label={t("results.feedback.entry.comments")}
            rows={2}
            placeholder={t("results.feedback.entry.commentsPlaceholder")}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />

          <FeedbackQuestionFields
            questions={feedbackQuestions}
            answers={answers}
            onChange={(questionId, value) =>
              setAnswers((current) => ({ ...current, [questionId]: value }))
            }
          />
        </form>
      </Dialog>
    </div>
  );
}
