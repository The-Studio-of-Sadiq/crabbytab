"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { buttonClasses } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/Feedback";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { FeedbackReviewControls } from "@/features/tournament/components/FeedbackReviewControls";
import { duplicateFeedbackGroups } from "@/lib/participants/reports";

/**
 * Feedback submitted more than once by the same source on the same target in the same debate
 * (Tabbycat's `printmultiplefeedback` command, as a page). Nothing is changed automatically; each
 * submission can be ignored or confirmed with the usual review controls.
 */
export default function DuplicateFeedbackPage() {
  const { tournament, feedback, rounds, reviewFeedback, isOwnerOrAdmin } = useTournament();
  const { t, plural, formatDecimal, formatDateTime } = useI18n();
  const [minimum, setMinimum] = useState(2);
  const groups = useMemo(() => duplicateFeedbackGroups(feedback, minimum), [feedback, minimum]);
  const roundName = (roundId: string) => rounds.find((round) => round.id === roundId)?.name ?? "—";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/${tournament?.slug}/feedback`}
          className={buttonClasses({ variant: "ghost", size: "sm", className: "-ms-2.5" })}
        >
          <ArrowLeft className="rtl:-scale-x-100" aria-hidden="true" />
          {t("results.feedback.back")}
        </Link>
        <PageHeader
          title={t("results.feedback.duplicates.title")}
          description={t("results.feedback.duplicates.description")}
          actions={
            <Select
              label={t("results.feedback.duplicates.minimum")}
              value={minimum}
              onChange={(event) => setMinimum(Number(event.target.value))}
              className="w-auto"
            >
              {[2, 3, 4, 5].map((count) => (
                <option key={count} value={count}>
                  {t("results.feedback.duplicates.atLeast", { count })}
                </option>
              ))}
            </Select>
          }
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState title={t("results.feedback.duplicates.none")} />
      ) : (
        groups.map((group) => (
          <Card key={group.key} className="overflow-hidden">
            <CardHeader
              title={t("results.feedback.duplicates.groupTitle", { source: group.sourceName, target: group.targetName })}
              description={plural("results.feedback.duplicates.groupDetail", group.submissions.length, {
                round: roundName(group.roundId),
              })}
            />
            <TableContainer className="rounded-none border-0">
              <Table>
                <THead>
                  <TR>
                    <TH>{t("results.feedback.duplicates.colSubmitted")}</TH>
                    <TH align="right">{t("results.feedback.duplicates.colScore")}</TH>
                    <TH>{t("results.feedback.duplicates.colComments")}</TH>
                    <TH>{t("results.feedback.duplicates.colStatus")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {group.submissions.map((submission) => (
                    <TR key={submission.id}>
                      <TD className="whitespace-nowrap text-xs text-fg-muted">
                        {formatDateTime(submission.timestamp) || submission.timestamp}
                      </TD>
                      <TD numeric>{formatDecimal(submission.score, 1)}</TD>
                      <TD className="max-w-md whitespace-normal text-xs">{submission.comments || "—"}</TD>
                      <TD>
                        <FeedbackReviewControls submission={submission} canEdit={isOwnerOrAdmin} onReview={reviewFeedback} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>
          </Card>
        ))
      )}
    </div>
  );
}
