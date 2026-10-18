"use client";

import React, { useMemo, useState } from "react";
import { Users2 } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import type { Adjudicator, Speaker, Team } from "@/types";
import { formatDiversityCounts, panelDiversitySummary, participantRegion } from "@/lib/adjudicators/diversity";

type Kind = "speakers" | "adjudicators";

interface DiversityInputProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  disabled: boolean;
  onSave(value: string | undefined): Promise<void>;
}

/** Saves on blur, only when the trimmed value changed. */
function DiversityInput({ label, value, placeholder, disabled, onSave }: DiversityInputProps) {
  return (
    <input
      key={value ?? ""}
      type="text"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      onBlur={(event) => {
        const next = event.target.value.trim() || undefined;
        if (next !== (value?.trim() || undefined)) void onSave(next);
      }}
      className="w-full rounded border border-gray-300 px-2 py-1 text-xs disabled:bg-gray-50"
    />
  );
}

export default function DiversityPage() {
  const { teams, adjudicators, institutions, updateTeam, updateAdjudicator, isOwnerOrAdmin } = useTournament();
  const [kind, setKind] = useState<Kind>("speakers");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const institutionsById = useMemo(
    () => new Map(institutions.map((institution) => [institution.id, institution])),
    [institutions]
  );

  const speakerRows = useMemo(
    () =>
      teams.flatMap((team) => team.speakers.map((speaker) => ({ team, speaker })))
        .filter(({ team, speaker }) =>
          `${speaker.name} ${team.name}`.toLowerCase().includes(query.trim().toLowerCase())
        ),
    [teams, query]
  );
  const adjudicatorRows = useMemo(
    () => adjudicators.filter((adjudicator) =>
      `${adjudicator.name} ${adjudicator.institutionName ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
    ),
    [adjudicators, query]
  );
  const summary = useMemo(
    () =>
      kind === "speakers"
        ? panelDiversitySummary(
            teams.flatMap((team) => team.speakers.map((speaker) => ({ ...speaker, institutionId: team.institutionId }))),
            institutionsById
          )
        : panelDiversitySummary(adjudicators, institutionsById),
    [kind, teams, adjudicators, institutionsById]
  );

  const run = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the change.");
    }
  };

  const saveSpeaker = (team: Team, speaker: Speaker, patch: Partial<Pick<Speaker, "gender" | "region">>) =>
    run(() =>
      updateTeam({
        ...team,
        speakers: team.speakers.map((item) => (item.id === speaker.id ? { ...item, ...patch } : item)),
      })
    );
  const saveAdjudicator = (adjudicator: Adjudicator, patch: Partial<Pick<Adjudicator, "gender" | "region">>) =>
    run(() => updateAdjudicator({ ...adjudicator, ...patch }));

  return (
    <div className="space-y-6">
      <div className="border-b border-[#d0d7de] pb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gray-900">
          <Users2 className="h-6 w-6 text-violet-600" /> Diversity
        </h1>
        <p className="mt-1 max-w-3xl text-xs text-gray-500">
          Optional, self-described gender and region for speakers and adjudicators. Region falls back to the
          institution&apos;s region. These fields are private to tournament staff; the allocation editor can show
          them as badges and a per-panel summary.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["speakers", "adjudicators"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setKind(item)}
            aria-pressed={kind === item}
            className={`rounded-md px-3 py-1.5 text-xs font-bold ${
              kind === item ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {item === "speakers" ? "Speakers" : "Adjudicators"}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search…"
          aria-label="Search participants"
          className="ml-auto w-48 rounded border border-gray-300 px-2.5 py-1 text-xs"
        />
      </div>

      <p className="text-xs text-gray-600">
        <span className="font-semibold">{summary.size} {kind}:</span> gender {formatDiversityCounts(summary.genders) || "—"};
        region {formatDiversityCounts(summary.regions) || "—"}
      </p>
      {!isOwnerOrAdmin && <p className="text-xs text-gray-500">Only tournament administrators can edit these fields.</p>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-[#d0d7de] bg-white">
        <table className="tabby-table w-full text-left">
          <thead>
            <tr>
              <th>Name</th>
              <th>{kind === "speakers" ? "Team" : "Institution"}</th>
              <th className="w-48">Gender</th>
              <th className="w-48">Region</th>
            </tr>
          </thead>
          <tbody>
            {kind === "speakers"
              ? speakerRows.map(({ team, speaker }) => (
                  <tr key={`${team.id}-${speaker.id}`}>
                    <td className="text-xs font-semibold text-gray-900">{speaker.name}</td>
                    <td className="text-xs text-gray-600">{team.name}</td>
                    <td>
                      <DiversityInput
                        label={`Gender of ${speaker.name}`}
                        value={speaker.gender}
                        disabled={!isOwnerOrAdmin}
                        onSave={(gender) => saveSpeaker(team, speaker, { gender })}
                      />
                    </td>
                    <td>
                      <DiversityInput
                        label={`Region of ${speaker.name}`}
                        value={speaker.region}
                        placeholder={participantRegion({ institutionId: team.institutionId }, institutionsById)}
                        disabled={!isOwnerOrAdmin}
                        onSave={(region) => saveSpeaker(team, speaker, { region })}
                      />
                    </td>
                  </tr>
                ))
              : adjudicatorRows.map((adjudicator) => (
                  <tr key={adjudicator.id}>
                    <td className="text-xs font-semibold text-gray-900">{adjudicator.name}</td>
                    <td className="text-xs text-gray-600">{adjudicator.institutionName ?? "Independent"}</td>
                    <td>
                      <DiversityInput
                        label={`Gender of ${adjudicator.name}`}
                        value={adjudicator.gender}
                        disabled={!isOwnerOrAdmin}
                        onSave={(gender) => saveAdjudicator(adjudicator, { gender })}
                      />
                    </td>
                    <td>
                      <DiversityInput
                        label={`Region of ${adjudicator.name}`}
                        value={adjudicator.region}
                        placeholder={participantRegion({ institutionId: adjudicator.institutionId }, institutionsById)}
                        disabled={!isOwnerOrAdmin}
                        onSave={(region) => saveAdjudicator(adjudicator, { region })}
                      />
                    </td>
                  </tr>
                ))}
            {(kind === "speakers" ? speakerRows.length : adjudicatorRows.length) === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-xs text-gray-400">No {kind} found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
