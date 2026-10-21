"use client";

import React from "react";
import type { DebateSide } from "@/types";
import type { ParticipantMotion } from "@/lib/ballots/participantMotion";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Select } from "@/components/ui/Field";

/**
 * The motion questions of a participant ballot (private URL or public form), as Tabbycat's ballot
 * form: which of the round's motions was debated (required when asked) and, with motion vetoes on,
 * each team's veto.
 */
export function MotionChoiceFields({
  motions,
  askMotion,
  askVetoes,
  sides,
  teamNames,
  motionId,
  vetoes,
  onMotionChange,
  onVetoChange,
  idPrefix,
}: {
  motions: readonly ParticipantMotion[];
  askMotion: boolean;
  askVetoes: boolean;
  sides: readonly DebateSide[];
  teamNames: Partial<Record<DebateSide, string>>;
  motionId: string;
  vetoes: Partial<Record<DebateSide, string>>;
  onMotionChange: (motionId: string) => void;
  onVetoChange: (side: DebateSide, motionId: string) => void;
  idPrefix: string;
}) {
  const { t } = useI18n();
  if (!askMotion && !askVetoes) return null;
  const label = (motion: ParticipantMotion, index: number) => `${index + 1}. ${motion.text}`;
  return (
    <div className="space-y-3">
      {askMotion && (
        <Select
          id={`${idPrefix}-motion`}
          label={t("results.ballot.motion")}
          required
          value={motionId}
          onChange={(event) => onMotionChange(event.target.value)}
        >
          <option value="">{t("results.ballot.selectMotion")}</option>
          {motions.map((motion, index) => (
            <option key={motion.id} value={motion.id}>{label(motion, index)}</option>
          ))}
        </Select>
      )}
      {askVetoes && (
        <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold text-fg">{t("results.ballot.vetoes")}</legend>
          {sides.map((side) => (
            <Select
              key={side}
              id={`${idPrefix}-veto-${side}`}
              label={t("results.ballot.vetoedBy", { team: teamNames[side] || side })}
              value={vetoes[side] || ""}
              onChange={(event) => onVetoChange(side, event.target.value)}
            >
              <option value="">{t("results.ballot.noVeto")}</option>
              {motions.map((motion, index) => motion.id === motionId ? null : (
                <option key={motion.id} value={motion.id}>{label(motion, index)}</option>
              ))}
            </Select>
          ))}
        </fieldset>
      )}
    </div>
  );
}
