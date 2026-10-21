"use client";

import { useMemo } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import {
  roundIntakeRows,
  summarizeIntake,
  usesPerAdjudicatorSheets,
  type DebateIntakeRow,
  type DebateIntakeStatus,
  type IntakeSummary,
} from "@/features/tournament/application/ballotIntake";
import type { Tone } from "@/components/ui/Badge";
import type { MessageKey } from "@/lib/i18n/messages";

/** Paper-ballot status rows and counts for one round, from the tournament context. */
export function useRoundIntake(roundId: string | undefined): {
  rows: DebateIntakeRow[];
  summary: IntakeSummary;
  perAdjudicator: boolean;
} {
  const { tournament, rounds, debates, adjudicators, ballots, ballotIntake } = useTournament();
  const round = rounds.find((item) => item.id === roundId);
  const perAdjudicator = usesPerAdjudicatorSheets(round, {
    format: tournament?.format || "bp",
    preferences: tournament?.preferences,
  });
  const doubleEntry = Boolean(tournament?.preferences?.ballotDoubleEntry);
  const format = tournament?.format || "bp";
  const rows = useMemo(
    () => roundId
      ? roundIntakeRows({ roundId, debates, adjudicators, intake: ballotIntake, ballots, perAdjudicator, doubleEntry, format })
      : [],
    [roundId, debates, adjudicators, ballotIntake, ballots, perAdjudicator, doubleEntry, format]
  );
  const summary = useMemo(() => summarizeIntake(rows), [rows]);
  return { rows, summary, perAdjudicator };
}

export const INTAKE_STATUS_TONES: Record<DebateIntakeStatus, Tone> = {
  missing: "neutral",
  partial: "warning",
  received: "info",
  entered: "accent",
  awaiting_check: "warning",
  disputed: "danger",
  confirmed: "success",
};

/** Display names for intake statuses (the English labels in ballotIntake.ts are not translated). */
export const INTAKE_STATUS_KEYS: Record<DebateIntakeStatus, MessageKey> = {
  missing: "results.intake.status.missing",
  partial: "results.intake.status.partial",
  received: "results.intake.status.received",
  entered: "results.intake.status.entered",
  awaiting_check: "results.intake.status.awaiting_check",
  disputed: "results.intake.status.disputed",
  confirmed: "results.intake.status.confirmed",
};
