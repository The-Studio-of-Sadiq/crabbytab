"use client";

import React, { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { Adjudicator, BallotSubmission, Debate, Institution, Round, Team, Tournament, Venue } from "@/types";
import { validateDraw } from "@/lib/draw/validateDraw";

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
      <p className="flex items-center gap-1.5 text-xs text-gray-600">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
        Draw check: no problems found.
      </p>
    );
  }

  const summary = [
    errorCount > 0 ? `${errorCount} problem${errorCount === 1 ? "" : "s"} to fix` : "",
    warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(", ");

  return (
    <details open={errorCount > 0} className="rounded border border-gray-200 bg-white px-3 py-2 text-xs">
      <summary className="cursor-pointer font-semibold text-gray-800">
        Draw check: {summary}
      </summary>
      <ul className="mt-2 space-y-1" aria-label="Draw check results">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`} className="flex items-start gap-1.5 text-gray-700">
            {issue.severity === "error" ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden="true" />
            ) : (
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
            )}
            <span>
              <span className="font-semibold">{issue.severity === "error" ? "Problem:" : "Warning:"}</span> {issue.message}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
