"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import {
  ADJ_SCORE_MAX,
  ADJ_SCORE_MIN,
  adjudicatorScoreHistory,
  blendAdjudicatorScore,
  calculateFeedbackSummaries,
  feedbackWeightKey,
  isFeedbackCountedForScore,
  normalizeFeedbackWeight,
  preFeedbackScore,
} from "@/lib/feedback/scores";
import { agreementTally, analyzeFeedbackAnswers, type FeedbackQuestionAnalysis } from "@/lib/feedback/answers";
import { questionsForFeedbackSource } from "@/lib/feedback/questions";
import { MAX_SCORE_CHANGE_REASON_LENGTH } from "@/lib/feedback/scoreHistory";
import { FeedbackReviewControls } from "@/features/tournament/components/FeedbackReviewControls";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { focusRing } from "@/components/ui/focus";
import { cn } from "@/components/ui/cn";

function AnalysisRow({ item }: { item: FeedbackQuestionAnalysis }) {
  const { t, plural, formatNumber, formatDecimal } = useI18n();
  let detail: React.ReactNode;
  if (item.kind === "numeric") {
    detail = item.average === undefined
      ? "—"
      : t("results.feedback.detail.numericSummary", {
          average: formatDecimal(item.average, 2),
          min: item.min ?? "—",
          max: item.max ?? "—",
        });
  } else if (item.kind === "boolean") {
    detail = item.answered ? t("results.feedback.detail.booleanSummary", { yes: item.yes, no: item.no }) : "—";
  } else if (item.kind === "choice") {
    detail = item.answered
      ? item.counts.map(({ option, count }) => t("results.feedback.detail.choiceCount", { option, count: formatNumber(count) })).join(" · ")
      : "—";
  } else {
    detail = item.responses.length === 0 ? "—" : (
      <details>
        <summary className={cn("cursor-pointer rounded-sm text-accent-text", focusRing)}>
          {plural("results.feedback.detail.showResponses", item.responses.length)}
        </summary>
        <ul className="mt-1 list-disc space-y-0.5 ps-4">
          {item.responses.map((response, index) => (
            <li key={index} className="whitespace-pre-wrap">{response}</li>
          ))}
        </ul>
      </details>
    );
  }
  return (
    <TR>
      <TD className="font-medium">{item.question.label}</TD>
      <TD numeric>{formatNumber(item.answered)}</TD>
      <TD>{detail}</TD>
    </TR>
  );
}

function parseScore(value: string): number | undefined | "invalid" {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= ADJ_SCORE_MIN && parsed <= ADJ_SCORE_MAX ? parsed : "invalid";
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs font-medium text-fg-muted">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</div>
      {detail && <p className="mt-0.5 text-xs text-fg-muted">{detail}</p>}
    </div>
  );
}

export default function AdjudicatorFeedbackDetailPage() {
  const params = useParams();
  const adjudicatorId = params.adjudicatorId as string;
  const {
    tournament,
    rounds,
    activeRound,
    debates,
    adjudicators,
    feedback,
    updateAdjudicatorScores,
    reviewFeedback,
    isOwnerOrAdmin,
  } = useTournament();
  const { t, plural, formatNumber, formatDecimal, formatDateTime } = useI18n();
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
  const adjudicator = adjudicators.find((item) => item.id === adjudicatorId);
  const preferences = tournament?.preferences;
  const [baseDraft, setBaseDraft] = useState<string | null>(null);
  const [testDraft, setTestDraft] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const summary = useMemo(
    () => calculateFeedbackSummaries(feedback, debates, preferences).get(adjudicatorId),
    [feedback, debates, preferences, adjudicatorId]
  );
  const history = useMemo(
    () => (adjudicator ? adjudicatorScoreHistory(adjudicator, rounds, debates, feedback, preferences) : []),
    [adjudicator, rounds, debates, feedback, preferences]
  );
  const received = useMemo(
    () =>
      feedback
        .filter((item) => item.targetAdjudicatorId === adjudicatorId && item.targetType !== "team")
        .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || "")),
    [feedback, adjudicatorId]
  );
  const debatesById = useMemo(() => new Map(debates.map((debate) => [debate.id, debate])), [debates]);
  // Same submissions as the score: confirmed and not ignored.
  const answerAnalysis = useMemo(() => {
    const counted = received.filter(isFeedbackCountedForScore);
    return (["team", "adjudicator"] as const).map((sourceType) => {
      const fromSource = counted.filter((item) => item.sourceType === sourceType);
      return {
        sourceType,
        count: fromSource.length,
        agreement: agreementTally(fromSource),
        questions: analyzeFeedbackAnswers(questionsForFeedbackSource(sourceType, preferences), fromSource),
      };
    });
  }, [received, preferences]);
  const scoreChanges = useMemo(
    () => [...(adjudicator?.scoreHistory ?? [])].reverse(),
    [adjudicator?.scoreHistory]
  );
  const roundsById = useMemo(() => new Map(rounds.map((round) => [round.id, round])), [rounds]);

  const backLink = (
    <Link href={`/${tournament?.slug}/feedback`} className={buttonClasses({ variant: "ghost", size: "sm", className: "-ms-2.5" })}>
      <ArrowLeft className="rtl:-scale-x-100" aria-hidden="true" />
      {t("results.feedback.back")}
    </Link>
  );

  if (!adjudicator) {
    return (
      <div className="space-y-4">
        {backLink}
        <Alert tone="warning" role="alert" title={t("results.feedback.detail.notFound")} />
      </div>
    );
  }

  const optionalScore = (value: number | undefined) =>
    value === undefined ? t("results.feedback.detail.none") : formatDecimal(value, 1);
  const percent = (fraction: number) => formatNumber(fraction, { style: "percent", maximumFractionDigits: 0 });

  const weight = normalizeFeedbackWeight(activeRound?.feedbackWeight);
  const handleSaveScores = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const base = parseScore(baseDraft ?? String(adjudicator.baseScore));
    const test = parseScore(testDraft ?? (adjudicator.testScore === undefined ? "" : String(adjudicator.testScore)));
    if (base === undefined || base === "invalid" || test === "invalid") {
      setMessage({
        kind: "error",
        text: t("results.feedback.detail.rangeError", { min: ADJ_SCORE_MIN, max: ADJ_SCORE_MAX }),
      });
      return;
    }
    setSaving(true);
    try {
      await updateAdjudicatorScores(adjudicator.id, { baseScore: base, testScore: test }, reasonDraft);
      setBaseDraft(null);
      setTestDraft(null);
      setReasonDraft("");
      setMessage({ kind: "success", text: t("results.feedback.detail.saved") });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("results.feedback.detail.saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const blendedDetail = t(
    preFeedbackScore(adjudicator) === adjudicator.testScore
      ? "results.feedback.detail.blendedDetailTest"
      : "results.feedback.detail.blendedDetailBase",
    {
      feedbackShare: percent(weight),
      otherShare: percent(1 - weight),
      round: activeRound?.name ?? t("results.feedback.detail.defaultWeight"),
    }
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {backLink}
        <PageHeader
          title={adjudicator.name}
          description={adjudicator.institutionName ?? t("common.independent")}
          meta={adjudicator.trainee ? <Badge>{t("role.trainee")}</Badge> : undefined}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("results.feedback.detail.baseScore")} value={formatDecimal(adjudicator.baseScore, 1)} />
        <StatTile
          label={t("results.feedback.detail.testScore")}
          value={adjudicator.testScore === undefined ? "—" : formatDecimal(adjudicator.testScore, 1)}
          detail={t("results.feedback.detail.testScoreHint")}
        />
        <StatTile
          label={t("results.feedback.detail.feedbackWeighted")}
          value={summary ? formatDecimal(summary.average, 2) : "—"}
          detail={
            summary
              ? plural("results.feedback.detail.feedbackDetail", summary.count, { scaled: formatDecimal(summary.scaledAverage, 2) })
              : t("results.feedback.detail.noCounted")
          }
        />
        <StatTile
          label={t("results.feedback.detail.blendedScore")}
          value={formatDecimal(blendAdjudicatorScore(adjudicator, summary?.scaledAverage, activeRound?.feedbackWeight), 2)}
          detail={blendedDetail}
        />
      </div>

      {isOwnerOrAdmin && (
        <Card>
          <CardHeader title={t("results.feedback.detail.editTitle")} description={t("results.feedback.detail.testHelp")} />
          <CardBody>
            <form onSubmit={handleSaveScores} className="flex flex-wrap items-end gap-3">
              <Input
                label={t("results.feedback.detail.baseScore")}
                wrapperClassName="w-28"
                className="font-mono"
                type="number"
                step={0.5}
                min={ADJ_SCORE_MIN}
                max={ADJ_SCORE_MAX}
                required
                value={baseDraft ?? String(adjudicator.baseScore)}
                onChange={(event) => setBaseDraft(event.target.value)}
              />
              <Input
                label={t("results.feedback.detail.testScore")}
                wrapperClassName="w-28"
                className="font-mono"
                type="number"
                step={0.5}
                min={ADJ_SCORE_MIN}
                max={ADJ_SCORE_MAX}
                value={testDraft ?? (adjudicator.testScore === undefined ? "" : String(adjudicator.testScore))}
                onChange={(event) => setTestDraft(event.target.value)}
                placeholder={t("results.feedback.detail.testPlaceholder")}
              />
              <Input
                label={t("results.feedback.detail.reason")}
                wrapperClassName="min-w-[12rem] flex-1"
                type="text"
                maxLength={MAX_SCORE_CHANGE_REASON_LENGTH}
                value={reasonDraft}
                onChange={(event) => setReasonDraft(event.target.value)}
                placeholder={t("results.feedback.detail.reasonPlaceholder")}
              />
              <Button
                type="submit"
                variant="primary"
                loading={saving}
                loadingText={t("results.feedback.saving")}
                disabled={baseDraft === null && testDraft === null}
              >
                <Save aria-hidden="true" />
                {t("results.feedback.detail.saveScores")}
              </Button>
              {message && (
                <Alert
                  className="w-full"
                  tone={message.kind === "error" ? "danger" : "success"}
                  role={message.kind === "error" ? "alert" : "status"}
                  title={message.text}
                />
              )}
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t("results.feedback.detail.historyTitle")} />
        <TableContainer className="rounded-none rounded-b-lg border-0">
          <Table>
            <THead>
              <TR>
                <TH>{t("results.feedback.field.round")}</TH>
                <TH>{t("results.feedback.detail.col.role")}</TH>
                <TH align="right">{t("results.feedback.detail.col.received")}</TH>
                <TH align="right">{t("results.feedback.detail.col.counted")}</TH>
                <TH align="right">{t("results.feedback.detail.col.roundAverage")}</TH>
                <TH align="right">{t("results.feedback.detail.col.scoreAfter")}</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((row) => {
                const venue = row.debateId ? debatesById.get(row.debateId)?.venueName : undefined;
                const role = row.role ? roleLabel(row.role) : t("results.feedback.detail.notAllocated");
                return (
                  <TR key={row.roundId}>
                    <TD className="font-medium">{row.roundName}</TD>
                    <TD className="text-fg-muted">
                      {venue ? t("results.feedback.detail.roleWithVenue", { role, venue }) : role}
                    </TD>
                    <TD numeric>{formatNumber(row.received)}</TD>
                    <TD numeric>{formatNumber(row.summary?.count ?? 0)}</TD>
                    <TD numeric>{row.summary ? formatDecimal(row.summary.average, 2) : "—"}</TD>
                    <TD numeric className="font-semibold">{formatDecimal(row.cumulativeScore, 2)}</TD>
                  </TR>
                );
              })}
              {history.length === 0 && <TableEmpty colSpan={6}>{t("results.feedback.noRounds")}</TableEmpty>}
            </TBody>
          </Table>
        </TableContainer>
      </Card>

      <Card>
        <CardHeader title={t("results.feedback.detail.changesTitle")} />
        <TableContainer className="rounded-none rounded-b-lg border-0">
          <Table>
            <THead>
              <TR>
                <TH>{t("results.feedback.detail.col.when")}</TH>
                <TH>{t("results.feedback.field.score")}</TH>
                <TH>{t("results.feedback.detail.col.change")}</TH>
                <TH>{t("results.feedback.detail.col.by")}</TH>
                <TH>{t("results.feedback.detail.col.reason")}</TH>
              </TR>
            </THead>
            <TBody>
              {scoreChanges.map((change, index) => (
                <TR key={`${change.timestamp}-${change.field}-${index}`}>
                  <TD className="whitespace-nowrap text-fg-muted">{formatDateTime(change.timestamp) || change.timestamp}</TD>
                  <TD className="font-medium">
                    {t(change.field === "baseScore" ? "results.feedback.detail.fieldBase" : "results.feedback.detail.fieldTest")}
                  </TD>
                  <TD className="font-mono text-xs">
                    {optionalScore(change.previous)} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
                    <span className="sr-only"> {t("results.feedback.detail.changedTo")} </span>{" "}
                    <span className="font-semibold">{optionalScore(change.value)}</span>
                  </TD>
                  <TD className="text-fg-muted">{change.actorName || change.actorId || t("results.feedback.unknown")}</TD>
                  <TD className="text-fg-muted">{change.reason || "—"}</TD>
                </TR>
              ))}
              {scoreChanges.length === 0 && (
                <TableEmpty colSpan={5}>{t("results.feedback.detail.changesEmpty")}</TableEmpty>
              )}
            </TBody>
          </Table>
        </TableContainer>
      </Card>

      {answerAnalysis.map((group) => (
        <Card key={group.sourceType}>
          <CardHeader
            title={plural(
              group.sourceType === "team" ? "results.feedback.detail.answersFromTeams" : "results.feedback.detail.answersFromAdjudicators",
              group.count
            )}
            description={t("results.feedback.detail.answersNote")}
          />
          <p className="px-4 py-3 text-[13px] text-fg">
            {group.agreement.answered
              ? t("results.feedback.detail.agreementSummary", {
                  agree: group.agreement.agree,
                  disagree: group.agreement.disagree,
                })
              : t("results.feedback.detail.agreementNone")}
          </p>
          {group.questions.length > 0 && (
            <TableContainer className="rounded-none rounded-b-lg border-0 border-t">
              <Table>
                <THead>
                  <TR>
                    <TH>{t("results.feedback.detail.col.question")}</TH>
                    <TH align="right">{t("results.feedback.detail.col.answered")}</TH>
                    <TH>{t("results.feedback.detail.col.summary")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {group.questions.map((item) => <AnalysisRow key={item.question.id} item={item} />)}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      ))}

      <section className="space-y-3" aria-labelledby="received-feedback">
        <h2 id="received-feedback" className="text-[15px] font-semibold text-fg">
          {t("results.feedback.detail.receivedTitle", { count: received.length })}
        </h2>
        {received.length === 0 ? (
          <EmptyState title={t("results.feedback.detail.receivedEmpty")} />
        ) : (
          received.map((item) => {
            const key = feedbackWeightKey(item, debatesById.get(item.debateId));
            const sourceWeight = key ? preferences?.feedbackSourceWeights?.[key] ?? 1 : 1;
            const [sourceRole, targetRole] = key ? key.split("_on_") : [];
            const from = t("results.feedback.detail.receivedFrom", {
              round: roundsById.get(item.roundId)?.name ?? t("results.feedback.detail.unlinkedRound"),
              source: item.sourceName || t("results.feedback.unknown"),
            });
            return (
              <article key={item.id} className="rounded-lg border border-border bg-surface p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-fg-muted">
                    <span className="font-mono font-semibold text-fg">{formatNumber(item.score)}</span>
                    <span className="mx-1.5 text-fg-subtle" aria-hidden="true">·</span>
                    {key && sourceRole && targetRole
                      ? t("results.feedback.detail.receivedFromWeighted", {
                          from,
                          path: t("results.feedback.pathLabel", { source: roleLabel(sourceRole), target: roleLabel(targetRole) }),
                          weight: formatNumber(sourceWeight),
                        })
                      : from}
                  </p>
                  <FeedbackReviewControls submission={item} canEdit={isOwnerOrAdmin} onReview={reviewFeedback} />
                </div>
                {item.comments?.trim() && <p className="mt-1 whitespace-pre-wrap text-fg">{item.comments}</p>}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
