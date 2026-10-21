"use client";

import React, { useState } from "react";
import { CheckCircle2, Globe, Lock, Pin, PinOff, Undo2, Unlock, Users } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { StatusPill, type Tone } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Feedback";
import { ReleaseActionDialog } from "@/features/tournament/components/ReleaseActionDialog";
import {
  drawStageActions,
  drawStageActionChangesVisibility,
  drawStageOf,
  drawStatusAfter,
  type DrawStage,
  type DrawStageAction,
} from "@/lib/draw/drawStatus";
import { currentDrawRoundId, explicitCurrentRound } from "@/lib/publicFeatures";
import type { MessageKey } from "@/lib/i18n";
import type { Round } from "@/types";

const STAGE_LABELS: Record<DrawStage, { key: MessageKey; tone: Tone }> = {
  none: { key: "tabroom.draw.stage.none", tone: "neutral" },
  draft: { key: "tabroom.draw.stage.draft", tone: "warning" },
  locked: { key: "tabroom.draw.stage.locked", tone: "info" },
  teams_released: { key: "tabroom.draw.stage.teamsReleased", tone: "info" },
  released: { key: "tabroom.draw.stage.released", tone: "success" },
};

const ACTIONS: Record<DrawStageAction, { label: MessageKey; icon: React.ReactNode }> = {
  lock: { label: "tabroom.draw.stage.action.lock", icon: <Lock aria-hidden="true" /> },
  unlock: { label: "tabroom.draw.stage.action.unlock", icon: <Unlock aria-hidden="true" /> },
  release_teams: { label: "tabroom.draw.stage.action.releaseTeams", icon: <Users aria-hidden="true" /> },
  release: { label: "tabroom.draw.stage.action.release", icon: <Globe aria-hidden="true" /> },
  unrelease: { label: "tabroom.draw.stage.action.unrelease", icon: <Undo2 aria-hidden="true" /> },
};

const DIALOG_KEYS: Partial<Record<DrawStageAction, { title: MessageKey; description: MessageKey; confirm: MessageKey }>> = {
  release_teams: {
    title: "tabroom.draw.stage.dialog.releaseTeamsTitle",
    description: "tabroom.draw.stage.dialog.releaseTeamsDescription",
    confirm: "tabroom.draw.stage.action.releaseTeams",
  },
  release: {
    title: "tabroom.draw.release.publishTitle",
    description: "tabroom.draw.release.publishDescription",
    confirm: "tabroom.draw.release.publishConfirm",
  },
  unrelease: {
    title: "tabroom.draw.release.unpublishTitle",
    description: "tabroom.draw.stage.dialog.unreleaseDescription",
    confirm: "tabroom.draw.release.unpublishConfirm",
  },
};

type PendingChange =
  | { kind: "stage"; action: DrawStageAction }
  | { kind: "current"; roundId: string | undefined };

/**
 * The draw's release stages (Tabbycat draft -> confirmed -> released, plus "release to teams
 * only") and the tournament's explicit current round. Changes that alter what participants or
 * the public see go through ReleaseActionDialog, which uploads and republishes them.
 */
export function DrawStageControls({ round, hasDebates }: { round: Round; hasDebates: boolean }) {
  const { tournament, rounds, updateRound, saveTournament } = useTournament();
  const { t } = useI18n();
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const stage = drawStageOf(round);
  const status = STAGE_LABELS[stage];
  const actions = hasDebates ? drawStageActions(stage) : [];
  const explicitId = tournament?.preferences?.currentRoundId;
  const explicit = explicitCurrentRound(rounds, explicitId);
  const derivedId = currentDrawRoundId(rounds);
  const derivedName = rounds.find((item) => item.id === derivedId)?.name;

  const runLocal = async (action: DrawStageAction) => {
    setBusy(true);
    setError("");
    try {
      await updateRound({ ...round, drawStatus: drawStatusAfter(action) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("tabroom.draw.stage.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onAction = (action: DrawStageAction) => {
    if (drawStageActionChangesVisibility(action)) setPending({ kind: "stage", action });
    else void runLocal(action);
  };

  const saveCurrentRound = async (roundId: string | undefined) => {
    if (!tournament) return;
    const { currentRoundId: _previous, ...preferences } = tournament.preferences;
    void _previous;
    await saveTournament({
      ...tournament,
      preferences: (roundId ? { ...preferences, currentRoundId: roundId } : preferences) as typeof tournament.preferences,
    });
  };

  const dialog = (() => {
    if (!pending) return null;
    if (pending.kind === "current") {
      return (
        <ReleaseActionDialog
          title={pending.roundId ? t("tabroom.draw.current.setTitle", { round: round.name }) : t("tabroom.draw.current.clearTitle")}
          description={pending.roundId
            ? t("tabroom.draw.current.setDescription", { round: round.name })
            : t("tabroom.draw.current.clearDescription")}
          confirmLabel={pending.roundId ? t("tabroom.draw.current.set") : t("tabroom.draw.current.clear")}
          apply={() => saveCurrentRound(pending.roundId)}
          onClose={() => setPending(null)}
        />
      );
    }
    const keys = DIALOG_KEYS[pending.action];
    if (!keys) return null;
    return (
      <ReleaseActionDialog
        title={t(keys.title)}
        description={t(keys.description, { round: round.name })}
        confirmLabel={t(keys.confirm)}
        apply={() => updateRound({ ...round, drawStatus: drawStatusAfter(pending.action) })}
        onClose={() => setPending(null)}
      />
    );
  })();

  return (
    <section aria-label={t("tabroom.draw.stage.regionLabel")} className="flex flex-wrap items-center gap-2">
      <StatusPill tone={status.tone} icon={stage === "released" ? <CheckCircle2 aria-hidden="true" /> : undefined}>
        {t(status.key)}
      </StatusPill>
      {actions.map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === "release" ? "primary" : "secondary"}
          onClick={() => onAction(action)}
          disabled={busy}
        >
          {ACTIONS[action].icon}
          {t(ACTIONS[action].label)}
        </Button>
      ))}
      <span className="ml-auto text-xs text-fg-muted" role="status">
        {explicit
          ? t("tabroom.draw.current.explicit", { round: explicit.name })
          : derivedName
            ? t("tabroom.draw.current.automatic", { round: derivedName })
            : t("tabroom.draw.current.automaticNone")}
      </span>
      {explicit?.id !== round.id && !round.cancelled && (
        <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "current", roundId: round.id })}>
          <Pin aria-hidden="true" />
          {t("tabroom.draw.current.makeCurrent", { round: round.name })}
        </Button>
      )}
      {explicitId && (
        <Button size="sm" variant="ghost" onClick={() => setPending({ kind: "current", roundId: undefined })}>
          <PinOff aria-hidden="true" />
          {t("tabroom.draw.current.clear")}
        </Button>
      )}
      {error && (
        <Alert tone="danger" role="alert" className="w-full">
          {error}
        </Alert>
      )}
      {dialog}
    </section>
  );
}
