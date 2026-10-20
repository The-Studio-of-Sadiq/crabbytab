"use client";

import React, { useMemo, useState } from "react";
import { Users } from "lucide-react";
import type { Round, Team, Tournament } from "@/types";
import {
  buildSwingTeam,
  roundFieldSize,
  swingTeamsNeeded,
  validateSwingTeam,
  withoutSwingRound,
  withSwingRound,
  type SwingSpeakerInput,
} from "@/features/tournament/application/swingTeams";

interface SwingTeamPanelProps {
  tournament: Tournament;
  round: Round;
  teams: Team[];
  addTeam: (team: Omit<Team, "id" | "tournamentId">) => Promise<void>;
  updateTeam: (team: Team) => Promise<void>;
}

const BYE_LABELS: Record<string, string> = {
  lowest_ranked: "the lowest-ranked teams",
  random: "randomly chosen teams",
};

/**
 * Swing teams for a preliminary round, offered next to automatic byes: when the available teams
 * do not fill every room, form a swing team from reserves or other teams' speakers (or reuse an
 * earlier swing team). Swing teams are drawn like any team but are not ranked in the tab.
 */
export function SwingTeamPanel({ tournament, round, teams, addTeam, updateTeam }: SwingTeamPanelProps) {
  const speakerCount = tournament.preferences?.substantiveSpeakers ?? (tournament.format === "bp" ? 2 : 3);
  const field = useMemo(() => roundFieldSize(tournament, round, teams), [tournament, round, teams]);
  const needed = swingTeamsNeeded(field);
  const swingTeams = teams.filter((team) => team.isSwing);
  const inRound = swingTeams.filter((team) => team.swingRoundIds?.includes(round.id));
  const reusable = swingTeams.filter((team) => !team.swingRoundIds?.includes(round.id));
  const registeredSpeakers = useMemo(
    () => teams
      .filter((team) => !team.isSwing)
      .flatMap((team) => (team.speakers || []).map((speaker) => ({ ...speaker, teamName: team.name })))
      .sort((a, b) => a.teamName.localeCompare(b.teamName) || a.name.localeCompare(b.name)),
    [teams]
  );

  const [name, setName] = useState("");
  const [speakers, setSpeakers] = useState<SwingSpeakerInput[]>(() => Array.from({ length: speakerCount }, () => ({ name: "" })));
  const [status, setStatus] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const byeMethod = tournament.preferences?.byeTeamSelectionMethod;
  const usesByes = Boolean(byeMethod && byeMethod !== "none") && round.drawType !== "manual";
  if (needed === 0 && swingTeams.length === 0) return null;

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus({ kind: "success", message: success });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Could not save the swing team." });
    } finally {
      setBusy(false);
    }
  };

  const rows = Array.from({ length: speakerCount }, (_, index) => speakers[index] ?? { name: "" });
  const setSpeaker = (index: number, patch: Partial<SwingSpeakerInput>) =>
    setSpeakers(rows.map((speaker, i) => (i === index ? { ...speaker, ...patch } : speaker)));
  const proposedName = name.trim() || `Swing ${String.fromCharCode(65 + swingTeams.length % 26)}`;
  const input = { name: proposedName, speakers: rows, round, teams, tournament };

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    const problems = validateSwingTeam(input);
    if (problems.length > 0) {
      setStatus({ kind: "error", message: problems.join(" ") });
      return;
    }
    const stamp = Date.now().toString(36);
    void run(async () => {
      await addTeam(buildSwingTeam(input, (index) => `swing-${stamp}-s${index + 1}`));
      setName("");
      setSpeakers(Array.from({ length: speakerCount }, () => ({ name: "" })));
    }, `${proposedName} added to ${round.name}. Generate the draw to place it.`);
  };

  return (
    <details open={needed > 0} className="rounded border border-gray-200 bg-white px-3 py-2 text-xs">
      <summary className="cursor-pointer font-semibold text-gray-800">
        <Users className="mr-1 inline h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
        Swing teams
        {needed > 0
          ? `: ${field.available} teams available, ${needed} short of full rooms`
          : inRound.length > 0 ? `: ${inRound.length} in ${round.name}` : ""}
      </summary>
      <div className="mt-2 space-y-3">
        {needed > 0 && (
          <p className="text-gray-700">
            {usesByes
              ? `Without swing teams the draw gives byes to ${field.excess} of ${BYE_LABELS[byeMethod!] ?? "the teams"}. `
              : `Without swing teams or byes the draw cannot fill every room. `}
            Add {needed} swing team{needed === 1 ? "" : "s"} to fill the last room instead. Swing teams are drawn like any team,
            their results count for their opponents, and they and their speakers are not ranked in the tab or the break.
          </p>
        )}

        {inRound.length > 0 && (
          <ul className="space-y-1" aria-label={`Swing teams in ${round.name}`}>
            {inRound.map((team) => (
              <li key={team.id} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{team.name}</span>
                <span className="text-gray-500">{team.speakers.map((speaker) => speaker.name).join(", ")}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => updateTeam(withoutSwingRound(team, round)), `${team.name} removed from ${round.name}.`)}
                  className="rounded border border-gray-300 px-2 py-0.5 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Remove from {round.abbreviation || round.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        {reusable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-600">Earlier swing teams:</span>
            {reusable.map((team) => (
              <button
                key={team.id}
                type="button"
                disabled={busy}
                onClick={() => void run(() => updateTeam(withSwingRound(team, round)), `${team.name} added to ${round.name}.`)}
                className="rounded border border-gray-300 px-2 py-0.5 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Use {team.name} in {round.abbreviation || round.name}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={create} className="space-y-2" aria-label="New swing team">
          <label className="block max-w-xs font-semibold text-gray-700">
            Swing team name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={proposedName}
              maxLength={100}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 font-normal"
            />
          </label>
          <fieldset className="space-y-1.5">
            <legend className="font-semibold text-gray-700">Speakers ({speakerCount})</legend>
            {rows.map((speaker, index) => (
              <div key={index} className="flex flex-col gap-1 sm:flex-row sm:items-center">
                <label className="sm:w-56">
                  <span className="sr-only">Speaker {index + 1} name</span>
                  <input
                    value={speaker.name}
                    onChange={(event) => setSpeaker(index, { name: event.target.value, sourceSpeakerId: undefined })}
                    placeholder={`Speaker ${index + 1} (reserve name)`}
                    maxLength={100}
                    className="w-full rounded border border-gray-300 px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-1 text-gray-600">
                  <span>or from a team:</span>
                  <select
                    value={speaker.sourceSpeakerId ?? ""}
                    onChange={(event) => {
                      const source = registeredSpeakers.find((item) => item.id === event.target.value);
                      setSpeaker(index, source ? { name: source.name, sourceSpeakerId: source.id } : { sourceSpeakerId: undefined });
                    }}
                    className="max-w-[16rem] rounded border border-gray-300 px-1 py-1"
                  >
                    <option value="">Reserve (not registered)</option>
                    {registeredSpeakers.map((item) => (
                      <option key={item.id} value={item.id}>{item.name} ({item.teamName})</option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </fieldset>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-1.5 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : `Add swing team to ${round.abbreviation || round.name}`}
          </button>
        </form>
        {status && (
          <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "text-red-700" : "text-emerald-700"}>
            {status.message}
          </p>
        )}
      </div>
    </details>
  );
}
