"use client";

import React from "react";
import { History } from "lucide-react";
import type { BallotSubmission, DebateSide, TournamentPreferences } from "@/types";
import { sideLabel } from "@/lib/sideNames";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useFormatScore } from "@/features/tournament/components/results/useFormatScore";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatusPill, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { MessageKey } from "@/lib/i18n/messages";

interface BallotHistoryProps {
  ballots: BallotSubmission[];
  /** Hidden during a blind check so the checker cannot see the entry being checked. */
  hideScores?: boolean;
  canConfirm: (ballot: BallotSubmission) => boolean;
  onLoad?: (ballot: BallotSubmission) => void;
  onConfirm: (ballot: BallotSubmission) => void;
  onDiscard: (ballot: BallotSubmission) => void;
  busy?: boolean;
  /** For the tournament's side names. */
  preferences?: Partial<TournamentPreferences>;
}

function status(ballot: BallotSubmission): { key: MessageKey; tone: Tone } {
  if (ballot.discarded) return { key: "results.ballot.history.discarded", tone: "neutral" };
  if (ballot.confirmed) return { key: "results.ballot.history.confirmed", tone: "success" };
  return { key: "results.ballot.history.awaitingCheck", tone: "warning" };
}

const SUBMITTER_KEYS: Record<BallotSubmission["submitterType"], MessageKey> = {
  tabroom: "results.ballot.history.submitter.tabroom",
  public: "results.ballot.history.submitter.public",
  judge: "results.ballot.history.submitter.judge",
};

export function BallotHistory({ ballots, hideScores, canConfirm, onLoad, onConfirm, onDiscard, busy, preferences }: BallotHistoryProps) {
  const { t, plural, formatDateTime } = useI18n();
  const formatScore = useFormatScore();
  if (ballots.length === 0) return null;
  const ordered = [...ballots].sort((left, right) => (right.version || 0) - (left.version || 0));

  const describeResult = (ballot: BallotSubmission): string => {
    const label = (side: DebateSide) => sideLabel(side, preferences);
    if (ballot.forfeitSide) return t("results.ballot.history.forfeited", { side: label(ballot.forfeitSide) });
    const sides = Object.values(ballot.teamScores || {});
    const winner = sides.find((score) => score.rank === 1);
    if (!winner) return "—";
    if (sides.length > 2) {
      return sides
        .slice()
        .sort((left, right) => (left.rank ?? 9) - (right.rank ?? 9))
        .map((score) => label(score.side))
        .join(" › ");
    }
    const side = label(winner.side);
    const byMargin = !ballot.noSpeakerScores && winner.margin !== undefined;
    if (winner.votes !== undefined) {
      return byMargin
        ? plural("results.ballot.history.wonByWithVotes", winner.votes, { side, margin: formatScore(winner.margin) })
        : plural("results.ballot.history.wonWithVotes", winner.votes, { side });
    }
    return byMargin
      ? t("results.ballot.history.wonBy", { side, margin: formatScore(winner.margin) })
      : t("results.ballot.history.won", { side });
  };

  return (
    <Card className="no-print">
      <CardHeader icon={<History aria-hidden="true" />} title={t("results.ballot.history.title")} />
      <ul className="divide-y divide-border">
        {ordered.map((ballot) => {
          const badge = status(ballot);
          const submitter = ballot.submitterName || t(SUBMITTER_KEYS[ballot.submitterType]);
          return (
            <li key={ballot.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-xs">
              <span className="font-mono font-semibold text-fg">
                {t("results.ballot.versionShort", { version: ballot.version })}
              </span>
              <StatusPill tone={badge.tone}>{t(badge.key)}</StatusPill>
              <span className="text-fg">{hideScores ? t("results.ballot.history.hidden") : describeResult(ballot)}</span>
              <span className="text-fg-muted">
                {ballot.sheets?.length
                  ? plural("results.ballot.history.metaSheets", ballot.sheets.length, {
                      submitter,
                      time: formatDateTime(ballot.timestamp),
                    })
                  : t("results.ballot.history.meta", { submitter, time: formatDateTime(ballot.timestamp) })}
              </span>
              {ballot.discardedBy && (
                <span className="text-fg-muted">{t("results.ballot.history.discardedBy", { name: ballot.discardedBy })}</span>
              )}
              <span className="ms-auto flex flex-wrap gap-1.5">
                {onLoad && !hideScores && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onLoad(ballot)}>
                    {t("results.ballot.history.edit")}
                  </Button>
                )}
                {!ballot.confirmed && !ballot.discarded && canConfirm(ballot) && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => onConfirm(ballot)}>
                    {t("results.ballot.history.confirm", { version: ballot.version })}
                  </Button>
                )}
                {!ballot.discarded && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    disabled={busy}
                    onClick={() => onDiscard(ballot)}
                  >
                    {t("results.ballot.history.discard", { version: ballot.version })}
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
