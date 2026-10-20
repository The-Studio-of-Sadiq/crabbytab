"use client";

import React, { useState } from "react";
import type { Round } from "@/types";
import { roundWeight } from "@/lib/ballots/ballotRules";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Input } from "@/components/ui/Field";

/**
 * Tabbycat's Round.weight: team points earned in a preliminary round count this many times in the
 * team standings (wins, speaks and who-beat-whom are not weighted).
 */
export function RoundWeightsEditor({
  rounds,
  updateRound,
}: {
  rounds: Round[];
  updateRound: (round: Round) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const preliminary = rounds.filter((round) => round.stage === "preliminary").sort((a, b) => a.seq - b.seq);
  if (preliminary.length === 0) return null;
  return (
    <section aria-labelledby="round-weights-heading">
      <h3 id="round-weights-heading" className="text-[13px] font-semibold text-fg">
        {t("setup.config.roundWeightsTitle")}
      </h3>
      <p className="mt-0.5 text-xs text-fg-muted">{t("setup.config.roundWeightsHelp")}</p>
      <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {preliminary.map((round) => (
          <div
            key={round.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[13px] text-fg"
          >
            <span className="min-w-0 truncate" aria-hidden="true">{round.name}</span>
            <Input
              type="number"
              min={0}
              step={1}
              aria-label={t("setup.config.roundWeightAria", { round: round.name })}
              value={roundWeight(round)}
              onChange={(event) => {
                const weight = Number(event.target.value);
                if (!Number.isInteger(weight) || weight < 0) {
                  setError(t("setup.config.roundWeightInvalid"));
                  return;
                }
                setError("");
                void updateRound({ ...round, weight }).catch(() =>
                  setError(t("setup.config.roundWeightFailed", { round: round.name }))
                );
              }}
              className="w-16 text-center font-mono tabular-nums"
            />
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
