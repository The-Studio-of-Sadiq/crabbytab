"use client";

import React, { useMemo } from "react";
import { Layers } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { StatusPill } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import {
  concurrentRoundClashes,
  describeConcurrentClashes,
  roundsInSameSlot,
  scheduleGroupOf,
} from "@/features/tournament/application/schedule";

/**
 * Shown on pages that work on the active round (draw, allocation, results, availability) when
 * that round shares its schedule slot with others: switches between the concurrent rounds and
 * shows each one's progress and any team, adjudicator or venue it shares with another.
 */
export function CurrentRoundsBar({ what = "debates" }: { what?: "debates" | "results" | "availability" }) {
  const { rounds, debates, ballots, activeRound, setActiveRound } = useTournament();
  const slot = useMemo(() => roundsInSameSlot(activeRound, rounds), [activeRound, rounds]);
  const summaries = useMemo(() => slot.map((round) => {
    const roundDebates = debates.filter((debate) => debate.roundId === round.id);
    const confirmed = new Set(
      ballots.filter((ballot) => ballot.roundId === round.id && ballot.confirmed && !ballot.discarded).map((ballot) => ballot.debateId)
    );
    const done = roundDebates.filter((debate) => debate.byeTeamId || confirmed.has(debate.id)).length;
    const clashes = concurrentRoundClashes(round, rounds, debates);
    return { round, debates: roundDebates.length, done, clashes };
  }), [slot, debates, ballots, rounds]);
  if (!activeRound || slot.length === 0) return null;

  // Clashes are symmetric, so the active round's list covers every pair it is part of.
  const clashing = summaries.filter((summary) => summary.round.id === activeRound.id && summary.clashes.length > 0);
  return (
    <nav
      aria-label={`Rounds in schedule slot ${scheduleGroupOf(activeRound)}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-fg"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          Running at the same time:
        </span>
        {summaries.map(({ round, debates: count, done, clashes }) => {
          const active = round.id === activeRound.id;
          const detail = count === 0 ? "no draw" : what === "results" ? `${done}/${count} results` : `${count} debates`;
          return (
            <button
              key={round.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setActiveRound(round)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                active ? "border-accent bg-accent-subtle text-accent-text" : "border-border text-fg-muted hover:bg-muted hover:text-fg",
                focusRing
              )}
            >
              <span>{round.name}</span>
              <span className="font-normal text-fg-muted">· {detail}</span>
              {clashes.length > 0 && <span className="sr-only">(shares participants with another round)</span>}
            </button>
          );
        })}
      </div>
      {clashing.length > 0 && (
        <div className="flex flex-col gap-1">
          {clashing.map(({ round, clashes }) => (
            <p key={round.id} className="flex items-start gap-1.5 text-xs text-fg">
              <StatusPill tone="warning">Clash</StatusPill>
              <span>{describeConcurrentClashes(round, clashes)}</span>
            </p>
          ))}
        </div>
      )}
    </nav>
  );
}
