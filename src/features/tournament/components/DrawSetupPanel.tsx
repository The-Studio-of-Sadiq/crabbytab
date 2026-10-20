"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import type { DrawType, Round, Team, Tournament, TwoTeamSide } from "@/types";
import { getEligibleTeamsForRound } from "@/lib/draw/generator";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import { Alert } from "@/components/ui/Feedback";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";

interface DrawSetupPanelProps {
  tournament: Tournament;
  round: Round;
  teams: Team[];
  updateRound: (round: Round) => Promise<void>;
  updateTeam: (team: Team) => Promise<void>;
}

const DRAW_TYPE_LABELS: Record<Exclude<DrawType, "elimination">, MessageKey> = {
  power_paired: "tabroom.draw.setup.type.power_paired",
  random: "tabroom.draw.setup.type.random",
  seeded: "tabroom.draw.setup.type.seeded",
  round_robin: "tabroom.draw.setup.type.round_robin",
  manual: "tabroom.draw.setup.type.manual",
};

/**
 * Per-round inputs the draw generator needs before a preliminary draw:
 * the draw type, team seeds for seeded draws, and preallocated sides.
 */
export function DrawSetupPanel({ tournament, round, teams, updateRound, updateTeam }: DrawSetupPanelProps) {
  const { t } = useI18n();
  const isBP = tournament.format === "bp";
  const usesPreallocatedSides = !isBP && tournament.preferences?.sideAllocationRule === "preallocated";
  const usesSeeds = round.drawType === "seeded";
  const roundTeams = useMemo(
    () => getEligibleTeamsForRound(teams, round).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [teams, round]
  );

  const [seeds, setSeeds] = useState<Record<string, string>>({});
  const [sides, setSides] = useState<Record<string, TwoTeamSide | "">>({});
  const [status, setStatus] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSeeds(Object.fromEntries(roundTeams.map((team) => [team.id, team.seed === undefined ? "" : String(team.seed)])));
  }, [roundTeams]);
  useEffect(() => {
    setSides(Object.fromEntries(roundTeams.map((team) => [team.id, round.preallocatedSides?.[team.id] ?? ""])));
  }, [roundTeams, round.preallocatedSides]);

  const drawTypes = (Object.keys(DRAW_TYPE_LABELS) as (keyof typeof DRAW_TYPE_LABELS)[]).filter(
    (type) => !isBP || (type !== "seeded" && type !== "round_robin")
  );
  const affCount = Object.values(sides).filter((side) => side === "AFF").length;
  const negCount = Object.values(sides).filter((side) => side === "NEG").length;

  const run = async (action: () => Promise<void>, success: string) => {
    setIsSaving(true);
    setStatus(null);
    try {
      await action();
      setStatus({ kind: "success", message: success });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : t("tabroom.draw.setup.saveFailed") });
    } finally {
      setIsSaving(false);
    }
  };

  const saveSeeds = () =>
    run(async () => {
      const changed: Team[] = [];
      for (const team of roundTeams) {
        const raw = seeds[team.id]?.trim() ?? "";
        const seed = raw === "" ? undefined : Number(raw);
        if (seed !== undefined && (!Number.isInteger(seed) || seed < 0)) {
          throw new Error(t("tabroom.draw.setup.seedInvalid", { team: team.name }));
        }
        if (seed !== team.seed) changed.push({ ...team, seed });
      }
      for (const team of changed) await updateTeam(team);
    }, t("tabroom.draw.setup.seedsSaved"));

  const saveSides = () =>
    run(async () => {
      const preallocatedSides: Record<string, TwoTeamSide> = {};
      for (const [teamId, side] of Object.entries(sides)) if (side) preallocatedSides[teamId] = side;
      await updateRound({ ...round, preallocatedSides });
    }, t("tabroom.draw.setup.sidesSaved"));

  if (round.stage !== "preliminary") return null;

  return (
    <Card role="region" aria-labelledby="draw-setup-heading">
      <CardHeader
        className="py-2.5"
        icon={<Settings2 aria-hidden="true" />}
        title={<span id="draw-setup-heading">{t("tabroom.draw.setup.title", { round: round.name })}</span>}
      />
      <CardBody className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Select
            label={t("tabroom.draw.setup.drawType")}
            wrapperClassName="space-y-1"
            className="h-7 w-auto text-xs"
            value={round.drawType}
            disabled={isSaving}
            onChange={(e) =>
              run(() => updateRound({ ...round, drawType: e.target.value as DrawType }), t("tabroom.draw.setup.drawTypeSaved"))
            }
          >
            {drawTypes.map((type) => (
              <option key={type} value={type}>{t(DRAW_TYPE_LABELS[type])}</option>
            ))}
          </Select>
          <p className="max-w-md text-[11px] text-fg-muted">{t("tabroom.draw.setup.drawTypeHelp")}</p>
        </div>

        {usesSeeds && !isBP && (
          <fieldset className="border-t border-border pt-3">
            <legend className="text-xs font-semibold text-fg">{t("tabroom.draw.setup.seedsLegend")}</legend>
            <div className="mt-2 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {roundTeams.map((team) => (
                <label key={team.id} className="flex items-center justify-between gap-2 text-xs text-fg">
                  <span className="truncate">{team.name}</span>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className="h-7 w-20 font-mono text-xs"
                    value={seeds[team.id] ?? ""}
                    onChange={(e) => setSeeds((current) => ({ ...current, [team.id]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <Button size="sm" variant="primary" onClick={saveSeeds} disabled={isSaving} className="mt-2">
              {t("tabroom.draw.setup.saveSeeds")}
            </Button>
          </fieldset>
        )}

        {usesPreallocatedSides && (
          <fieldset className="border-t border-border pt-3">
            <legend className="text-xs font-semibold text-fg">
              {affCount !== negCount
                ? t("tabroom.draw.setup.sidesLegendUnequal", { aff: affCount, neg: negCount })
                : t("tabroom.draw.setup.sidesLegend", { aff: affCount, neg: negCount })}
            </legend>
            <div className="mt-2 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {roundTeams.map((team) => (
                <label key={team.id} className="flex items-center justify-between gap-2 text-xs text-fg">
                  <span className="truncate">{team.name}</span>
                  <Select
                    className="h-7 w-auto text-xs"
                    value={sides[team.id] ?? ""}
                    onChange={(e) => setSides((current) => ({ ...current, [team.id]: e.target.value as TwoTeamSide | "" }))}
                  >
                    <option value="">{t("tabroom.draw.setup.sideNotSet")}</option>
                    <option value="AFF">{t("side.AFF")}</option>
                    <option value="NEG">{t("side.NEG")}</option>
                  </Select>
                </label>
              ))}
            </div>
            <Button size="sm" variant="primary" onClick={saveSides} disabled={isSaving} className="mt-2">
              {t("tabroom.draw.setup.saveSides")}
            </Button>
          </fieldset>
        )}

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
    </Card>
  );
}
