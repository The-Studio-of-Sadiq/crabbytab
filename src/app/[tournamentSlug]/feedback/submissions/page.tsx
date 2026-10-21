"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { ArrowLeft, Lock, MessageSquareHeart, Users2 } from "lucide-react";
import { FeedbackSubmission } from "@/types";
import { FeedbackReviewControls } from "@/features/tournament/components/FeedbackReviewControls";
import { filterFeedbackSubmissions, type FeedbackFilters } from "@/lib/feedback/filters";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Checkbox, Select } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/Feedback";
import { TabPanel, Tabs } from "@/components/ui/Tabs";

type FeedbackKind = "team" | "adjudicator";

function isTeamFeedback(submission: FeedbackSubmission): boolean {
  return submission.targetType === "team" || Boolean(submission.targetTeamId || submission.targetTeamName);
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-fg">{children}</dd>
    </div>
  );
}

export default function FeedbackSubmissionsPage() {
  const { tournament, feedback, rounds, debates, adjudicators, reviewFeedback, isOwnerOrAdmin } = useTournament();
  const { t, formatNumber, formatDateTime } = useI18n();
  const baseScores = useMemo(() => new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator.baseScore])), [adjudicators]);
  const importantThreshold = tournament?.preferences?.feedbackImportantThreshold ?? 2;
  const [activeKind, setActiveKind] = useState<FeedbackKind>("team");
  const [filters, setFilters] = useState<FeedbackFilters>({});
  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;
  const filteredFeedback = useMemo(
    () => filterFeedbackSubmissions(feedback, filters, { baseScores, importantThreshold }),
    [feedback, filters, baseScores, importantThreshold]
  );
  const teamFeedback = filteredFeedback
    .filter(isTeamFeedback)
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const adjudicatorFeedback = filteredFeedback
    .filter((submission) => !isTeamFeedback(submission))
    .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const selectedFeedback = activeKind === "team" ? teamFeedback : adjudicatorFeedback;
  const sources = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const submission of feedback) {
      byKey.set(`${submission.sourceType}:${submission.sourceId}`, submission.sourceName || submission.sourceId);
    }
    return [...byKey].sort((a, b) => a[1].localeCompare(b[1]));
  }, [feedback]);
  const roundNames = new Map(rounds.map((round) => [round.id, round.name]));
  const debatesById = new Map(debates.map((debate) => [debate.id, debate]));

  const displayAnswer = (answer: unknown): string => {
    if (typeof answer === "string") return answer;
    if (answer === null || answer === undefined) return "—";
    if (typeof answer === "number") return formatNumber(answer);
    if (typeof answer === "boolean") return answer ? t("feedbackQuestions.yes") : t("feedbackQuestions.no");
    return JSON.stringify(answer) ?? String(answer);
  };

  const backLink = (
    <Link href={`/${tournament?.slug}/feedback`} className={buttonClasses({ variant: "ghost", size: "sm", className: "-ms-2.5" })}>
      <ArrowLeft className="rtl:-scale-x-100" aria-hidden="true" />
      {t("results.feedback.back")}
    </Link>
  );

  if (!feedbackEnabled) {
    return (
      <div className="space-y-6">
        {backLink}
        <PageHeader title={t("results.feedback.submissions.title")} />
        <EmptyState
          icon={<Lock />}
          title={t("results.feedback.disabledTitle")}
          description={t("results.feedback.submissions.disabledBody")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {backLink}
        <PageHeader
          title={t("results.feedback.submissions.title")}
          description={t("results.feedback.submissions.description")}
        />
      </div>

      <Tabs<FeedbackKind>
        id="feedback-kind"
        ariaLabel={t("results.feedback.submissions.tabsLabel")}
        value={activeKind}
        onValueChange={setActiveKind}
        items={[
          { value: "team", label: t("results.feedback.submissions.tabTeam"), icon: <Users2 aria-hidden="true" />, count: teamFeedback.length },
          {
            value: "adjudicator",
            label: t("results.feedback.submissions.tabAdjudicator"),
            icon: <MessageSquareHeart aria-hidden="true" />,
            count: adjudicatorFeedback.length,
          },
        ]}
      />

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t("results.feedback.filters.label")}>
        <Select
          label={t("results.feedback.filters.round")}
          wrapperClassName="w-40"
          value={filters.roundId ?? ""}
          onChange={(event) => setFilters({ ...filters, roundId: event.target.value || undefined })}
        >
          <option value="">{t("results.feedback.filters.allRounds")}</option>
          {[...rounds].sort((a, b) => a.seq - b.seq).map((round) => (
            <option key={round.id} value={round.id}>{round.name}</option>
          ))}
        </Select>
        <Select
          label={t("results.feedback.filters.aboutAdjudicator")}
          wrapperClassName="w-48"
          value={filters.targetAdjudicatorId ?? ""}
          onChange={(event) => setFilters({ ...filters, targetAdjudicatorId: event.target.value || undefined })}
        >
          <option value="">{t("results.feedback.filters.anyone")}</option>
          {[...adjudicators].sort((a, b) => a.name.localeCompare(b.name)).map((adjudicator) => (
            <option key={adjudicator.id} value={adjudicator.id}>{adjudicator.name}</option>
          ))}
        </Select>
        <Select
          label={t("results.feedback.filters.sourceType")}
          wrapperClassName="w-48"
          value={filters.sourceType ?? ""}
          onChange={(event) => setFilters({
            ...filters,
            sourceType: event.target.value === "team" || event.target.value === "adjudicator" ? event.target.value : undefined,
            sourceId: undefined,
          })}
        >
          <option value="">{t("results.feedback.filters.sourceTypeAll")}</option>
          <option value="team">{t("results.feedback.filters.teams")}</option>
          <option value="adjudicator">{t("results.feedback.filters.adjudicators")}</option>
        </Select>
        <Select
          label={t("results.feedback.filters.from")}
          wrapperClassName="w-48"
          value={filters.sourceId ? `${filters.sourceType ?? ""}:${filters.sourceId}` : ""}
          onChange={(event) => {
            const [type, ...rest] = event.target.value.split(":");
            setFilters({
              ...filters,
              sourceType: type === "team" || type === "adjudicator" ? type : undefined,
              sourceId: rest.join(":") || undefined,
            });
          }}
        >
          <option value="">{t("results.feedback.filters.anyone")}</option>
          {sources
            .filter(([key]) => !filters.sourceType || key.startsWith(`${filters.sourceType}:`))
            .map(([key, name]) => (
              <option key={key} value={key}>
                {t(key.startsWith("team:") ? "results.feedback.filters.sourceOptionTeam" : "results.feedback.filters.sourceOptionAdjudicator", { name })}
              </option>
            ))}
        </Select>
        <Select
          label={t("results.feedback.filters.status")}
          wrapperClassName="w-36"
          value={filters.status ?? ""}
          onChange={(event) => setFilters({
            ...filters,
            status: event.target.value === "counted" || event.target.value === "ignored" || event.target.value === "unconfirmed"
              ? event.target.value
              : undefined,
          })}
        >
          <option value="">{t("results.feedback.filters.anyStatus")}</option>
          <option value="counted">{t("results.feedback.filters.counted")}</option>
          <option value="unconfirmed">{t("results.feedback.review.unconfirmed")}</option>
          <option value="ignored">{t("results.feedback.review.ignored")}</option>
        </Select>
        <Checkbox
          className="pb-1.5"
          label={t("results.feedback.filters.importantOnly", { threshold: importantThreshold })}
          description={t("results.feedback.filters.importantHint", { threshold: importantThreshold })}
          checked={filters.important === true}
          onChange={(event) => setFilters({ ...filters, important: event.target.checked || undefined })}
        />
        {Object.values(filters).some(Boolean) && (
          <Button variant="ghost" onClick={() => setFilters({})}>
            {t("results.feedback.filters.clear")}
          </Button>
        )}
        <span role="status" className="pb-1.5 text-xs text-fg-muted">
          {t("results.feedback.filters.showing", { shown: filteredFeedback.length, total: feedback.length })}
        </span>
      </div>

      <TabPanel id="feedback-kind" value={activeKind}>
        {selectedFeedback.length === 0 ? (
          <EmptyState
            icon={<MessageSquareHeart />}
            title={t(activeKind === "team" ? "results.feedback.submissions.emptyTeam" : "results.feedback.submissions.emptyAdjudicator")}
          />
        ) : (
          <div className="space-y-3">
            {selectedFeedback.map((submission) => {
              const debate = debatesById.get(submission.debateId);
              const targetName = isTeamFeedback(submission)
                ? submission.targetTeamName || t("results.feedback.role.team")
                : submission.targetAdjudicatorName || t("results.feedback.adjudicatorFallback");
              const submittedAt = submission.timestamp
                ? formatDateTime(submission.timestamp) || submission.timestamp
                : t("results.feedback.submissions.dateUnavailable");

              return (
                <article key={submission.id} className="rounded-lg border border-border bg-surface">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <p className="text-[13px] text-fg-muted">
                      <span className="font-semibold text-fg">{targetName}</span>
                      <span className="mx-1.5 text-fg-subtle" aria-hidden="true">·</span>
                      {t("results.feedback.submissions.submittedBy", {
                        source: submission.sourceName || t("results.feedback.unknown"),
                      })}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                      <span>{submittedAt}</span>
                      <FeedbackReviewControls submission={submission} canEdit={isOwnerOrAdmin} onReview={reviewFeedback} />
                    </div>
                  </div>
                  <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label={t("results.feedback.field.round")}>{roundNames.get(submission.roundId) || "—"}</Field>
                    <Field label={t("results.feedback.field.venue")}>
                      {debate?.venueName ||
                        (submission.debateId === "direct-feedback" ? t("results.feedback.submissions.directFeedback") : "—")}
                    </Field>
                    <Field label={t("results.feedback.field.score")}>
                      <span className="font-mono font-semibold">{formatNumber(submission.score)}</span>
                    </Field>
                    <Field label={t("results.feedback.field.agreement")}>
                      {submission.agreeWithDecision === undefined
                        ? t("results.feedback.submissions.notProvided")
                        : submission.agreeWithDecision
                        ? t("results.feedback.submissions.agreed")
                        : t("results.feedback.submissions.disagreed")}
                    </Field>
                    <Field label={t("results.feedback.field.comments")} className="sm:col-span-2 lg:col-span-4">
                      <span className="whitespace-pre-wrap">
                        {submission.comments?.trim() || (
                          <span className="text-fg-muted">{t("results.feedback.submissions.noComments")}</span>
                        )}
                      </span>
                    </Field>
                    {submission.answers && Object.entries(submission.answers).map(([question, answer]) => (
                      <Field key={question} label={question} className="sm:col-span-2">
                        <span className="whitespace-pre-wrap">{displayAnswer(answer)}</span>
                      </Field>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </TabPanel>
    </div>
  );
}
