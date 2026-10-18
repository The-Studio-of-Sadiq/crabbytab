"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import type { DrawType, Round, Team, Tournament, TwoTeamSide } from "@/types";
import { getEligibleTeamsForRound } from "@/lib/draw/generator";

interface DrawSetupPanelProps {
  tournament: Tournament;
  round: Round;
  teams: Team[];
  updateRound: (round: Round) => Promise<void>;
  updateTeam: (team: Team) => Promise<void>;
}

const DRAW_TYPE_LABELS: Record<Exclude<DrawType, "elimination">, string> = {
  power_paired: "Power-paired",
  random: "Random",
  seeded: "Seeded (by team seed)",
  round_robin: "Round robin",
  manual: "Manual (empty rooms)",
};

/**
 * Per-round inputs the draw generator needs before a preliminary draw:
 * the draw type, team seeds for seeded draws, and preallocated sides.
 */
export function DrawSetupPanel({ tournament, round, teams, updateRound, updateTeam }: DrawSetupPanelProps) {
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
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Could not save." });
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
          throw new Error(`${team.name}: seeds must be whole numbers of 0 or more.`);
        }
        if (seed !== team.seed) changed.push({ ...team, seed });
      }
      for (const team of changed) await updateTeam(team);
    }, "Seeds saved.");

  const saveSides = () =>
    run(async () => {
      const preallocatedSides: Record<string, TwoTeamSide> = {};
      for (const [teamId, side] of Object.entries(sides)) if (side) preallocatedSides[teamId] = side;
      await updateRound({ ...round, preallocatedSides });
    }, "Sides saved.");

  if (round.stage !== "preliminary") return null;

  return (
    <section aria-labelledby="draw-setup-heading" className="bg-white border border-[#d0d7de] rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <h2 id="draw-setup-heading" className="text-sm font-bold text-gray-900 flex items-center gap-2 w-full sm:w-auto">
          <Settings2 className="w-4 h-4 text-blue-600" aria-hidden="true" />
          Draw setup for {round.name}
        </h2>
        <label className="text-xs text-gray-700">
          <span className="block font-semibold mb-1">Draw type</span>
          <select
            className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white"
            value={round.drawType}
            disabled={isSaving}
            onChange={(e) =>
              run(() => updateRound({ ...round, drawType: e.target.value as DrawType }), "Draw type saved.")
            }
          >
            {drawTypes.map((type) => (
              <option key={type} value={type}>{DRAW_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-gray-500 max-w-md">
          Applies the next time this round&apos;s draw is generated. Power-paired rounds with no results yet are drawn at random; use a seeded draw to pair the first round by team seed.
        </p>
      </div>

      {usesSeeds && !isBP && (
        <fieldset className="border-t border-gray-100 pt-3">
          <legend className="text-xs font-semibold text-gray-800">Team seeds (higher is stronger)</legend>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
            {roundTeams.map((team) => (
              <label key={team.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{team.name}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  className="w-20 border border-gray-300 rounded px-2 py-1 font-mono"
                  value={seeds[team.id] ?? ""}
                  onChange={(e) => setSeeds((current) => ({ ...current, [team.id]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={saveSeeds}
            disabled={isSaving}
            className="mt-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold disabled:opacity-50"
          >
            Save seeds
          </button>
        </fieldset>
      )}

      {usesPreallocatedSides && (
        <fieldset className="border-t border-gray-100 pt-3">
          <legend className="text-xs font-semibold text-gray-800">
            Preallocated sides ({affCount} affirmative, {negCount} negative{affCount !== negCount ? " — must be equal" : ""})
          </legend>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
            {roundTeams.map((team) => (
              <label key={team.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{team.name}</span>
                <select
                  className="border border-gray-300 rounded px-2 py-1 bg-white"
                  value={sides[team.id] ?? ""}
                  onChange={(e) => setSides((current) => ({ ...current, [team.id]: e.target.value as TwoTeamSide | "" }))}
                >
                  <option value="">Not set</option>
                  <option value="AFF">Affirmative</option>
                  <option value="NEG">Negative</option>
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={saveSides}
            disabled={isSaving}
            className="mt-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold disabled:opacity-50"
          >
            Save sides
          </button>
        </fieldset>
      )}

      {status && (
        <p role={status.kind === "error" ? "alert" : "status"} className={`text-xs ${status.kind === "error" ? "text-red-600" : "text-emerald-700"}`}>
          {status.message}
        </p>
      )}
    </section>
  );
}
