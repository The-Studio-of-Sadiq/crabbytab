"use client";

import { useMemo } from "react";

import { useTournament } from "@/contexts/TournamentContext";
import type { PublicProjectionExtras } from "@/features/tournament/application/publicView";
import { buildPublicProjection, type PublicSourceData, type SourceRecord } from "@/lib/publicView/projection";

/**
 * The public projection's publish-time tabs and aggregates. Shared views get them with the
 * projection; without a cloud copy (local-only use) they are built here from the same pure
 * projection, so pages behave the same either way.
 */
export function usePublicExtras(): PublicProjectionExtras {
  const {
    publicExtras,
    tournament,
    rounds,
    teams,
    adjudicators,
    debates,
    ballots,
    motions,
    breakCategories,
    institutions,
    venues,
    feedback,
  } = useTournament();
  return useMemo(() => {
    if (publicExtras) return publicExtras;
    if (!tournament) return { derived: {} };
    const asRecords = (records: object[]) => records as unknown as SourceRecord[];
    const source: PublicSourceData = {
      rounds: asRecords(rounds),
      teams: asRecords(teams),
      adjudicators: asRecords(adjudicators),
      debates: asRecords(debates),
      ballots: asRecords(ballots),
      motions: asRecords(motions),
      breakCategories: asRecords(breakCategories),
      institutions: asRecords(institutions),
      venues: asRecords(venues),
      feedback: asRecords(feedback),
    };
    const projection = buildPublicProjection(tournament as unknown as SourceRecord, source);
    return { tabs: projection.tabs, derived: projection.derived };
  }, [publicExtras, tournament, rounds, teams, adjudicators, debates, ballots, motions, breakCategories, institutions, venues, feedback]);
}
