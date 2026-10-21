"use client";

import React, { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { Adjudicator, BallotSubmission, Debate, Institution, Round, Team, Tournament, Venue } from "@/types";
import { validateDraw } from "@/lib/draw/validateDraw";
import { useI18n } from "@/components/i18n/I18nProvider";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

interface DrawCheckPanelProps {
  tournament: Tournament;
  round: Round;
  rounds: Round[];
  debates: Debate[];
  teams: Team[];
  adjudicators: Adjudicator[];
  venues: Venue[];
  /** Sides recorded on confirmed ballots (manual-ballot sides) count in the side history. */
  ballots?: BallotSubmission[];
  /** Institutions, for their soft room constraints. */
  institutions?: Institution[];
}

/** Lists what the draw check finds in the selected round's draw. Read-only. */
export function DrawCheckPanel({ tournament, round, rounds, debates, teams, adjudicators, venues, ballots, institutions }: DrawCheckPanelProps) {
  const { t, plural } = useI18n();
  const hasDraw = debates.some((debate) => debate.roundId === round.id);
  const issues = useMemo(
    () => (hasDraw ? validateDraw({ tournament, round, rounds, debates, teams, adjudicators, venues, ballots, institutions }) : []),
    [hasDraw, tournament, round, rounds, debates, teams, adjudicators, venues, ballots, institutions]
  );
  if (!hasDraw) return null;

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-fg-muted" role="status">
        <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
        {t("tabroom.draw.check.clean")}
      </p>
    );
  }

  const summary =
    errorCount > 0 && warningCount > 0
      ? t("tabroom.draw.check.summaryBoth", {
          problems: plural("tabroom.draw.check.problemsToFix", errorCount),
          warnings: plural("tabroom.draw.check.warnings", warningCount),
        })
      : errorCount > 0
        ? plural("tabroom.draw.check.problemsToFix", errorCount)
        : plural("tabroom.draw.check.warnings", warningCount);

  return (
    <details open={errorCount > 0} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
      <summary className={cn("cursor-pointer rounded-sm font-semibold text-fg", focusRing)}>
        {t("tabroom.draw.check.title", { summary })}
      </summary>
      <ul className="mt-2 space-y-1" aria-label={t("tabroom.draw.check.resultsAria")}>
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`} className="flex items-start gap-1.5 text-fg">
            {issue.severity === "error" ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
            ) : (
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            )}
            <span>
              <span className={cn("font-semibold", issue.severity === "error" ? "text-danger" : "text-warning")}>
                {issue.severity === "error" ? t("tabroom.draw.check.problem") : t("tabroom.draw.check.warning")}
              </span>{" "}
              {issue.message}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
