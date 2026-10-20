"use client";

import React from "react";
import type { DebateSide, Motion } from "@/types";
import type { MotionPreferences } from "@/lib/motions/preferences";

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

/**
 * Ranked motion preferences for each side of a debate (Tabbycat DebateTeamMotionPreference):
 * one select per rank, most preferred first. A motion already ranked by the side is not offered
 * again at a lower rank.
 */
export function MotionPreferencesFields({
  sides,
  teamNames,
  motions,
  value,
  onChange,
}: {
  sides: DebateSide[];
  teamNames: Partial<Record<DebateSide, string>>;
  motions: Motion[];
  value: MotionPreferences;
  onChange: (value: MotionPreferences) => void;
}) {
  const ranks = Math.min(motions.length, ORDINALS.length);
  const label = (motion: Motion) => `${motion.reference ? `${motion.reference}: ` : ""}${motion.text}`;

  const setRank = (side: DebateSide, rank: number, motionId: string) => {
    const ranking = [...(value[side] || [])];
    while (ranking.length < rank) ranking.push("");
    ranking[rank] = motionId;
    // Later ranks may not repeat an earlier choice; empty trailing ranks are dropped.
    const cleaned = ranking.map((id, index) => (id && ranking.indexOf(id) === index ? id : ""));
    while (cleaned.length > 0 && !cleaned[cleaned.length - 1]) cleaned.pop();
    onChange({ ...value, [side]: cleaned });
  };

  return (
    <fieldset className="grid gap-3 rounded border border-gray-200 p-3 sm:grid-cols-2">
      <legend className="px-1 text-xs font-bold text-gray-700">Motion preferences (most preferred first)</legend>
      {sides.map((side) => {
        const ranking = value[side] || [];
        return (
          <div key={side} className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-700">{teamNames[side] || side}</p>
            {Array.from({ length: ranks }, (_, rank) => (
              <label key={rank} className="flex items-center gap-2 text-xs text-gray-700">
                <span className="w-8 shrink-0 font-semibold">{ORDINALS[rank]}</span>
                <select
                  value={ranking[rank] || ""}
                  onChange={(event) => setRank(side, rank, event.target.value)}
                  aria-label={`${teamNames[side] || side} ${ORDINALS[rank]} choice`}
                  className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs"
                >
                  <option value="">Not ranked</option>
                  {motions
                    .filter((motion) => motion.id === ranking[rank] || !ranking.slice(0, rank).includes(motion.id))
                    .map((motion) => (
                      <option key={motion.id} value={motion.id}>{label(motion)}</option>
                    ))}
                </select>
              </label>
            ))}
          </div>
        );
      })}
    </fieldset>
  );
}
