"use client";

import React from "react";
import type { DebateSide, Motion } from "@/types";
import type { MotionPreferences } from "@/lib/motions/preferences";
import type { MessageKey } from "@/lib/i18n/messages";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Select } from "@/components/ui/Field";

const ORDINALS: MessageKey[] = [
  "results.ballot.motionPrefs.ordinal1",
  "results.ballot.motionPrefs.ordinal2",
  "results.ballot.motionPrefs.ordinal3",
  "results.ballot.motionPrefs.ordinal4",
  "results.ballot.motionPrefs.ordinal5",
  "results.ballot.motionPrefs.ordinal6",
];

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
  const { t } = useI18n();
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
    <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
      <legend className="px-1 text-xs font-semibold text-fg">{t("results.ballot.motionPrefs.legend")}</legend>
      {sides.map((side) => {
        const ranking = value[side] || [];
        const team = teamNames[side] || side;
        return (
          <div key={side} className="space-y-1.5">
            <p className="text-xs font-medium text-fg">{team}</p>
            {Array.from({ length: ranks }, (_, rank) => (
              <div key={rank} className="flex items-center gap-2 text-xs text-fg-muted">
                <span className="w-8 shrink-0 font-medium" aria-hidden="true">{t(ORDINALS[rank])}</span>
                <Select
                  value={ranking[rank] || ""}
                  onChange={(event) => setRank(side, rank, event.target.value)}
                  aria-label={t("results.ballot.motionPrefs.choiceLabel", { team, rank: t(ORDINALS[rank]) })}
                  className="min-w-0 flex-1 text-xs"
                >
                  <option value="">{t("results.ballot.motionPrefs.notRanked")}</option>
                  {motions
                    .filter((motion) => motion.id === ranking[rank] || !ranking.slice(0, rank).includes(motion.id))
                    .map((motion) => (
                      <option key={motion.id} value={motion.id}>{label(motion)}</option>
                    ))}
                </Select>
              </div>
            ))}
          </div>
        );
      })}
    </fieldset>
  );
}
