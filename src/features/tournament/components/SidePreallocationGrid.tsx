"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { BallotSubmission, Debate, Round, Team, TwoTeamSide } from "@/types";
import { getEligibleTeamsForRound } from "@/lib/draw/generator";
import { resolveRecordedSides, sidesPending } from "@/lib/draw/manualSides";
import { randomSeed } from "@/lib/draw/rng";
import { generateSidePreallocations, sideCountsOf, sidesFromRound, type SideMap } from "@/lib/draw/sidePreallocation";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useTournament } from "@/contexts/TournamentContext";
import { sideLabel, sideNamesFor, translatedSideName } from "@/lib/sideNames";
import { Alert } from "@/components/ui/Feedback";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";

interface SidePreallocationGridProps {
  rounds: Round[];
  teams: Team[];
  debates: Debate[];
  ballots: BallotSubmission[];
  updateRounds: (rounds: Round[], summary: string) => Promise<void>;
}

type Draft = Record<string, Record<string, TwoTeamSide | "">>;

const bySeq = (a: Round, b: Round) => a.seq - b.seq;

/** Pre-allocated sides can still change only while a round has no draw. */
function isOpen(round: Round, debates: Debate[]): boolean {
  return round.drawStatus === "none" && !debates.some((debate) => debate.roundId === round.id);
}

function toSideMap(sides: Record<string, TwoTeamSide | ""> | undefined): SideMap {
  const out: SideMap = {};
  for (const [teamId, side] of Object.entries(sides ?? {})) if (side) out[teamId] = side;
  return out;
}

const sameSides = (a: SideMap, b: SideMap) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([teamId, side]) => b[teamId] === side);

/**
 * Tabbycat's side pre-allocations page: every preliminary round as a column, every team as a row.
 * Rounds without a draw are editable; drawn rounds show the side each team actually took. Also
 * generates random balanced sides for every open round (Tabbycat's generatesideallocations) and
 * copies a finished round's sides, same or opposite, into an open round.
 */
export function SidePreallocationGrid({ rounds, teams, debates, ballots, updateRounds }: SidePreallocationGridProps) {
  const { t, plural } = useI18n();
  const { tournament } = useTournament();
  const preferences = tournament?.preferences;
  const prelims = useMemo(
    () => rounds.filter((round) => round.stage === "preliminary" && !round.cancelled).sort(bySeq),
    [rounds]
  );
  const openRounds = useMemo(() => prelims.filter((round) => isOpen(round, debates)), [prelims, debates]);
  const finishedRounds = useMemo(
    () => prelims.filter((round) => round.drawStatus === "confirmed" || round.drawStatus === "released"),
    [prelims]
  );
  const eligible = useMemo(
    () => new Map(prelims.map((round) => [round.id, new Set(getEligibleTeamsForRound(teams, round).map((team) => team.id))])),
    [prelims, teams]
  );
  const rows = useMemo(
    () => teams.filter((team) => prelims.some((round) => eligible.get(round.id)?.has(team.id))).sort((a, b) => a.name.localeCompare(b.name)),
    [teams, prelims, eligible]
  );
  /** Side each team took in drawn rounds (sides recorded on confirmed ballots included). */
  const takenSides = useMemo(() => {
    const out = new Map<string, Map<string, TwoTeamSide>>();
    for (const round of prelims) {
      if (isOpen(round, debates)) continue;
      const roundDebates = resolveRecordedSides(debates.filter((debate) => debate.roundId === round.id), ballots);
      const sides = new Map<string, TwoTeamSide>();
      for (const debate of roundDebates) {
        if (debate.byeTeamId || sidesPending(debate)) continue;
        for (const side of ["AFF", "NEG"] as const) {
          const teamId = debate.teams?.[side]?.teamId;
          if (teamId) sides.set(teamId, side);
        }
      }
      out.set(round.id, sides);
    }
    return out;
  }, [prelims, debates, ballots]);

  const stored = useMemo<Draft>(
    () => Object.fromEntries(openRounds.map((round) => [round.id, { ...(round.preallocatedSides ?? {}) }])),
    [openRounds]
  );
  const [draft, setDraft] = useState<Draft>(stored);
  useEffect(() => setDraft(stored), [stored]);

  const [status, setStatus] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [direction, setDirection] = useState<"same" | "opposite">("same");

  const changedRounds = openRounds.filter((round) => !sameSides(toSideMap(draft[round.id]), toSideMap(stored[round.id])));
  const hasEntries = openRounds.some((round) => Object.keys(toSideMap(draft[round.id])).length > 0);

  const save = async (next: Draft, summary: string, success: string) => {
    const changed = openRounds
      .filter((round) => !sameSides(toSideMap(next[round.id]), toSideMap(round.preallocatedSides)))
      .map((round) => ({ ...round, preallocatedSides: toSideMap(next[round.id]) }));
    setIsSaving(true);
    setStatus(null);
    try {
      await updateRounds(changed, summary);
      setStatus({ kind: "success", message: success });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : t("tabroom.draw.setup.saveFailed") });
    } finally {
      setIsSaving(false);
    }
  };

  const generate = async () => {
    setConfirmGenerate(false);
    const seed = randomSeed();
    let generated: Record<string, SideMap>;
    try {
      generated = generateSidePreallocations(
        openRounds.map((round) => ({ roundId: round.id, roundName: round.name, teamIds: [...(eligible.get(round.id) ?? [])] })),
        seed
      );
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : t("tabroom.draw.setup.saveFailed") });
      return;
    }
    await save(
      generated,
      `Random side pre-allocations generated for ${openRounds.map((round) => round.name).join(", ")} (seed ${seed})`,
      t("tabroom.draw.sidesGrid.generated", { count: openRounds.length, seed })
    );
  };

  const applyFromRound = () => {
    const source = finishedRounds.find((round) => round.id === sourceId);
    const target = openRounds.find((round) => round.id === targetId);
    if (!source || !target) return;
    const teamIds = [...(eligible.get(target.id) ?? [])];
    const result = sidesFromRound(
      resolveRecordedSides(debates.filter((debate) => debate.roundId === source.id), ballots),
      teamIds,
      direction
    );
    // As Tabbycat: teams with a side in the source round are set; the others keep their entry.
    setDraft((current) => ({ ...current, [target.id]: { ...(current[target.id] ?? {}), ...result.sides } }));
    setStatus({
      kind: "success",
      message: plural("tabroom.draw.sidesGrid.applied", result.applied, {
        skipped: result.skippedTeamIds.length,
        source: source.name,
        target: target.name,
      }),
    });
  };

  if (prelims.length === 0) return null;

  return (
    <Card role="region" aria-labelledby="side-grid-heading">
      <CardHeader
        className="py-2.5"
        icon={<ArrowLeftRight aria-hidden="true" />}
        title={<span id="side-grid-heading">{t("tabroom.draw.sidesGrid.title")}</span>}
      />
      <CardBody className="space-y-3 p-3 sm:p-4">
        <p className="text-xs text-fg-muted">{t("tabroom.draw.sidesGrid.help")}</p>

        <div className="flex flex-wrap items-end gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={isSaving || openRounds.length === 0}
            onClick={() => (hasEntries || changedRounds.length > 0 ? setConfirmGenerate(true) : void generate())}
          >
            {t("tabroom.draw.sidesGrid.generate")}
          </Button>
          {finishedRounds.length > 0 && openRounds.length > 0 && (
            <fieldset className="flex flex-wrap items-end gap-2">
              <legend className="sr-only">{t("tabroom.draw.sidesGrid.applyLegend")}</legend>
              <Select
                label={t("tabroom.draw.sidesGrid.source")}
                wrapperClassName="space-y-1"
                className="h-7 w-auto text-xs"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                <option value="">{t("tabroom.draw.sidesGrid.choose")}</option>
                {finishedRounds.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
              </Select>
              <Select
                label={t("tabroom.draw.sidesGrid.direction")}
                wrapperClassName="space-y-1"
                className="h-7 w-auto text-xs"
                value={direction}
                onChange={(e) => setDirection(e.target.value as "same" | "opposite")}
              >
                <option value="same">{t("tabroom.draw.sidesGrid.same")}</option>
                <option value="opposite">{t("tabroom.draw.sidesGrid.opposite")}</option>
              </Select>
              <Select
                label={t("tabroom.draw.sidesGrid.target")}
                wrapperClassName="space-y-1"
                className="h-7 w-auto text-xs"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                <option value="">{t("tabroom.draw.sidesGrid.choose")}</option>
                {openRounds.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
              </Select>
              <Button size="sm" variant="secondary" disabled={!sourceId || !targetId || isSaving} onClick={applyFromRound}>
                {t("tabroom.draw.sidesGrid.apply")}
              </Button>
            </fieldset>
          )}
        </div>

        <div className="max-h-96 overflow-auto rounded border border-border">
          <table className="w-full text-xs">
            <caption className="sr-only">{t("tabroom.draw.sidesGrid.title")}</caption>
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th scope="col" className="px-2 py-1.5 text-left font-semibold">{t("tabroom.draw.sidesGrid.team")}</th>
                {prelims.map((round) => {
                  const open = isOpen(round, debates);
                  const counts = open ? sideCountsOf(toSideMap(draft[round.id])) : undefined;
                  const unequal = counts !== undefined && counts.aff !== counts.neg;
                  return (
                    <th key={round.id} scope="col" className="px-2 py-1.5 text-left font-semibold">
                      <span className="block">{round.abbreviation || round.name}</span>
                      <span className={unequal ? "block font-normal text-danger" : "block font-normal text-fg-muted"}>
                        {counts
                          ? sideNamesFor(preferences) === "aff-neg"
                            ? t(unequal ? "tabroom.draw.sidesGrid.countsUnequal" : "tabroom.draw.sidesGrid.counts", counts)
                            : t(unequal ? "tabroom.draw.sidesGrid.countsNamedUnequal" : "tabroom.draw.sidesGrid.countsNamed", {
                                ...counts,
                                affSide: sideLabel("AFF", preferences),
                                negSide: sideLabel("NEG", preferences),
                              })
                          : t("tabroom.draw.sidesGrid.drawn")}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((team) => (
                <tr key={team.id} className="border-t border-border">
                  <th scope="row" className="px-2 py-1 text-left font-normal">{team.name}</th>
                  {prelims.map((round) => {
                    const inRound = eligible.get(round.id)?.has(team.id);
                    if (!isOpen(round, debates)) {
                      const side = takenSides.get(round.id)?.get(team.id);
                      return <td key={round.id} className="px-2 py-1 text-fg-muted">{side === "AFF" || side === "NEG" ? translatedSideName(t, side, preferences) : "—"}</td>;
                    }
                    if (!inRound) return <td key={round.id} className="px-2 py-1 text-fg-muted">—</td>;
                    return (
                      <td key={round.id} className="px-2 py-1">
                        <Select
                          aria-label={t("tabroom.draw.sidesGrid.cellLabel", { team: team.name, round: round.name })}
                          className="h-7 w-auto text-xs"
                          value={draft[round.id]?.[team.id] ?? ""}
                          disabled={isSaving}
                          onChange={(e) => {
                            const value = e.target.value as TwoTeamSide | "";
                            setDraft((current) => ({ ...current, [round.id]: { ...(current[round.id] ?? {}), [team.id]: value } }));
                          }}
                        >
                          <option value="">{t("tabroom.draw.setup.sideNotSet")}</option>
                          <option value="AFF">{translatedSideName(t, "AFF", preferences)}</option>
                          <option value="NEG">{translatedSideName(t, "NEG", preferences)}</option>
                        </Select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button
          size="sm"
          variant="primary"
          disabled={isSaving || changedRounds.length === 0}
          onClick={() =>
            save(draft, `Side pre-allocations saved (${changedRounds.map((round) => round.name).join(", ")})`, t("tabroom.draw.setup.sidesSaved"))
          }
        >
          {t("tabroom.draw.setup.saveSides")}
        </Button>

        {status && (
          <Alert
            tone={status.kind === "error" ? "danger" : "success"}
            role={status.kind === "error" ? "alert" : "status"}
            className="p-2 text-xs"
          >
            {status.message}
          </Alert>
        )}
      </CardBody>

      {confirmGenerate && (
        <ConfirmActionDialog
          title={t("tabroom.draw.sidesGrid.confirmTitle")}
          description={t("tabroom.draw.sidesGrid.confirmDescription", { count: openRounds.length })}
          confirmLabel={t("tabroom.draw.sidesGrid.confirm")}
          variant="danger"
          onConfirm={() => void generate()}
          onCancel={() => setConfirmGenerate(false)}
        />
      )}
    </Card>
  );
}
