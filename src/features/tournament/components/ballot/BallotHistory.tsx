"use client";

import React from "react";
import { History } from "lucide-react";
import type { BallotSubmission, DebateSide, TournamentPreferences } from "@/types";
import { sideLabel } from "@/lib/sideNames";
import { formatScore } from "@/lib/scoreDisplay";

interface BallotHistoryProps {
  ballots: BallotSubmission[];
  /** Hidden during a blind check so the checker cannot see the entry being checked. */
  hideScores?: boolean;
  canConfirm: (ballot: BallotSubmission) => boolean;
  onLoad?: (ballot: BallotSubmission) => void;
  onConfirm: (ballot: BallotSubmission) => void;
  onDiscard: (ballot: BallotSubmission) => void;
  busy?: boolean;
  /** For the tournament's side names. */
  preferences?: Partial<TournamentPreferences>;
}

function status(ballot: BallotSubmission): { label: string; className: string } {
  if (ballot.discarded) return { label: "Discarded", className: "bg-gray-100 text-gray-600" };
  if (ballot.confirmed) return { label: "Confirmed", className: "bg-emerald-100 text-emerald-800" };
  return { label: "Awaiting check", className: "bg-amber-100 text-amber-800" };
}

function describeResult(ballot: BallotSubmission, preferences?: Partial<TournamentPreferences>): string {
  const label = (side: DebateSide) => sideLabel(side, preferences);
  if (ballot.forfeitSide) return `${label(ballot.forfeitSide)} forfeited`;
  const sides = Object.values(ballot.teamScores || {});
  const winner = sides.find((score) => score.rank === 1);
  if (!winner) return "—";
  if (sides.length > 2) {
    return sides
      .slice()
      .sort((left, right) => (left.rank ?? 9) - (right.rank ?? 9))
      .map((score) => label(score.side))
      .join(" › ");
  }
  const votes = winner.votes !== undefined ? ` (${winner.votes} vote${winner.votes === 1 ? "" : "s"})` : "";
  if (ballot.noSpeakerScores || winner.margin === undefined) return `${label(winner.side)} won${votes}`;
  return `${label(winner.side)} won by ${formatScore(winner.margin)}${votes}`;
}

export function BallotHistory({ ballots, hideScores, canConfirm, onLoad, onConfirm, onDiscard, busy, preferences }: BallotHistoryProps) {
  if (ballots.length === 0) return null;
  const ordered = [...ballots].sort((left, right) => (right.version || 0) - (left.version || 0));
  return (
    <section className="no-print rounded-lg border border-[#d0d7de] bg-white">
      <h3 className="flex items-center gap-2 border-b border-[#d0d7de] bg-[#f6f8fa] px-4 py-2 text-sm font-bold text-gray-900">
        <History className="h-4 w-4 text-gray-500" />
        Ballot versions
      </h3>
      <ul className="divide-y divide-gray-100">
        {ordered.map((ballot) => {
          const badge = status(ballot);
          return (
            <li key={ballot.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-xs">
              <span className="font-mono font-bold text-gray-900">v{ballot.version}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${badge.className}`}>{badge.label}</span>
              <span className="text-gray-700">{hideScores ? "Hidden during blind check" : describeResult(ballot, preferences)}</span>
              <span className="text-gray-500">
                {ballot.submitterName || ballot.submitterType}
                {ballot.sheets?.length ? ` · ${ballot.sheets.length} scoresheets` : ""}
                {" · "}
                {new Date(ballot.timestamp).toLocaleString()}
              </span>
              {ballot.discardedBy && <span className="text-gray-400">discarded by {ballot.discardedBy}</span>}
              <span className="ml-auto flex gap-2">
                {onLoad && !hideScores && (
                  <button type="button" disabled={busy} onClick={() => onLoad(ballot)} className="font-semibold text-blue-700 hover:underline disabled:opacity-50">
                    Edit as new version
                  </button>
                )}
                {!ballot.confirmed && !ballot.discarded && canConfirm(ballot) && (
                  <button type="button" disabled={busy} onClick={() => onConfirm(ballot)} className="font-semibold text-emerald-700 hover:underline disabled:opacity-50">
                    Confirm
                  </button>
                )}
                {!ballot.discarded && (
                  <button type="button" disabled={busy} onClick={() => onDiscard(ballot)} className="font-semibold text-red-700 hover:underline disabled:opacity-50">
                    Discard
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
