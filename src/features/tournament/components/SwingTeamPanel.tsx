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
import { useI18n } from "@/components/i18n/I18nProvider";
import type { PluralKey } from "@/lib/i18n";
import { Alert } from "@/components/ui/Feedback";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { Input, Select } from "@/components/ui/Field";

interface SwingTeamPanelProps {
  tournament: Tournament;
  round: Round;
  teams: Team[];
  addTeam: (team: Omit<Team, "id" | "tournamentId">) => Promise<void>;
  updateTeam: (team: Team) => Promise<void>;
}

const BYE_MESSAGES: Record<string, PluralKey> = {
  lowest_ranked: "tabroom.draw.swing.byesLowestRanked",
  random: "tabroom.draw.swing.byesRandom",
};

/**
 * Swing teams for a preliminary round, offered next to automatic byes: when the available teams
 * do not fill every room, form a swing team from reserves or other teams' speakers (or reuse an
 * earlier swing team). Swing teams are drawn like any team but are not ranked in the tab.
 */
export function SwingTeamPanel({ tournament, round, teams, addTeam, updateTeam }: SwingTeamPanelProps) {
  const { t, plural } = useI18n();
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
      setStatus({ kind: "error", message: error instanceof Error ? error.message : t("tabroom.draw.swing.saveFailed") });
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
    }, t("tabroom.draw.swing.created", { team: proposedName, round: round.name }));
  };

  const roundShort = round.abbreviation || round.name;

  return (
    <details open={needed > 0} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
      <summary className={cn("cursor-pointer rounded-sm font-semibold text-fg", focusRing)}>
        <Users className="mr-1 inline h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
        {needed > 0
          ? plural("tabroom.draw.swing.summaryShort", needed, { available: field.available })
          : inRound.length > 0
            ? t("tabroom.draw.swing.summaryInRound", { count: inRound.length, round: round.name })
            : t("tabroom.draw.swing.summary")}
      </summary>
      <div className="mt-2 space-y-3">
        {needed > 0 && (
          <p className="text-fg">
            {usesByes
              ? plural(BYE_MESSAGES[byeMethod ?? ""] ?? "tabroom.draw.swing.byesOther", field.excess)
              : t("tabroom.draw.swing.noByes")}{" "}
            {plural("tabroom.draw.swing.addNeeded", needed)}
          </p>
        )}

        {inRound.length > 0 && (
          <ul className="space-y-1" aria-label={t("tabroom.draw.swing.inRoundAria", { round: round.name })}>
            {inRound.map((team) => (
              <li key={team.id} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-fg">{team.name}</span>
                <span className="text-fg-muted">{team.speakers.map((speaker) => speaker.name).join(", ")}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => updateTeam(withoutSwingRound(team, round)),
                      t("tabroom.draw.swing.removed", { team: team.name, round: round.name })
                    )
                  }
                >
                  {t("tabroom.draw.swing.removeFrom", { round: roundShort })}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {reusable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-fg-muted">{t("tabroom.draw.swing.earlier")}</span>
            {reusable.map((team) => (
              <Button
                key={team.id}
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => updateTeam(withSwingRound(team, round)),
                    t("tabroom.draw.swing.added", { team: team.name, round: round.name })
                  )
                }
              >
                {t("tabroom.draw.swing.use", { team: team.name, round: roundShort })}
              </Button>
            ))}
          </div>
        )}

        <form onSubmit={create} className="space-y-2" aria-label={t("tabroom.draw.swing.formAria")}>
          <Input
            label={t("tabroom.draw.swing.name")}
            wrapperClassName="max-w-xs space-y-1"
            className="h-7 text-xs"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={proposedName}
            maxLength={100}
          />
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-fg">{t("tabroom.draw.swing.speakers", { count: speakerCount })}</legend>
            {rows.map((speaker, index) => (
              <div key={index} className="flex flex-col gap-1 sm:flex-row sm:items-center">
                <Input
                  aria-label={t("tabroom.draw.swing.speakerNameAria", { number: index + 1 })}
                  wrapperClassName="sm:w-56"
                  className="h-7 text-xs sm:w-56"
                  value={speaker.name}
                  onChange={(event) => setSpeaker(index, { name: event.target.value, sourceSpeakerId: undefined })}
                  placeholder={t("tabroom.draw.swing.speakerPlaceholder", { number: index + 1 })}
                  maxLength={100}
                />
                <label className="flex items-center gap-1 text-fg-muted">
                  <span>{t("tabroom.draw.swing.fromTeam")}</span>
                  <Select
                    value={speaker.sourceSpeakerId ?? ""}
                    onChange={(event) => {
                      const source = registeredSpeakers.find((item) => item.id === event.target.value);
                      setSpeaker(index, source ? { name: source.name, sourceSpeakerId: source.id } : { sourceSpeakerId: undefined });
                    }}
                    className="h-7 max-w-[16rem] text-xs"
                  >
                    <option value="">{t("tabroom.draw.swing.reserve")}</option>
                    {registeredSpeakers.map((item) => (
                      <option key={item.id} value={item.id}>{item.name} ({item.teamName})</option>
                    ))}
                  </Select>
                </label>
              </div>
            ))}
          </fieldset>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={busy}
            loadingText={t("tabroom.common.saving")}
          >
            {t("tabroom.draw.swing.submit", { round: roundShort })}
          </Button>
        </form>
        {status && (
          <Alert
            tone={status.kind === "error" ? "danger" : "success"}
            role={status.kind === "error" ? "alert" : "status"}
            className="p-2 text-xs"
          >
            {status.message}
          </Alert>
        )}
      </div>
    </details>
  );
}
