"use client";

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ListOrdered, X } from "lucide-react";
import type { Round } from "@/types";
import { useTournament } from "@/contexts/TournamentContext";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { MotionReleaseControl } from "@/features/tournament/components/MotionReleaseControl";
import {
  copyMotionsToRound,
  copyPreviousRoundMotions,
  moveRoundMotion,
  orderRoundMotions,
  previousRoundForMotions,
  removeMotionFromRound,
} from "@/lib/motions/roundMotions";
import { formatScheduleTime } from "@/lib/schedule/time";

/**
 * One round's motions: release state, order within the round (Tabbycat RoundMotion.seq) and
 * reuse of motions from other rounds. Motions are shared records, so reusing one assigns the same
 * motion to this round rather than duplicating it.
 */
export function RoundMotionsPanel({ round }: { round: Round }) {
  const { motions, rounds, isOwnerOrAdmin, updateMotions } = useTournament();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [motionToAdd, setMotionToAdd] = useState("");
  const roundMotions = useMemo(() => orderRoundMotions(motions, round.id), [motions, round.id]);
  const previous = previousRoundForMotions(round, rounds);
  const otherMotions = motions.filter((motion) => !motion.rounds?.includes(round.id));
  const roundName = (roundId: string) => rounds.find((item) => item.id === roundId)?.name;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this round's motions.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<ListOrdered aria-hidden="true" />}
        title={`${round.name} motions`}
        description={
          round.startsAt
            ? `Round starts ${formatScheduleTime(round.startsAt)}.`
            : "Order, reuse and release the motions debated in this round."
        }
        actions={<MotionReleaseControl round={round} />}
      />
      <CardBody className="space-y-3">
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        {roundMotions.length === 0 ? (
          <p className="text-xs text-fg-muted">No motions are assigned to {round.name} yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {roundMotions.map((motion, index) => {
              const elsewhere = (motion.rounds || []).filter((id) => id !== round.id).map(roundName).filter(Boolean);
              return (
                <li key={motion.id} className="flex items-start gap-2 rounded-md border border-border px-3 py-2">
                  <span className="mt-0.5 w-5 shrink-0 text-xs font-semibold tabular-nums text-fg-muted">{index + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-fg">{motion.text}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {motion.reference && <Badge>{motion.reference}</Badge>}
                      {motion.infoSlide?.trim() && <Badge tone="info">Info slide</Badge>}
                      <Badge tone={motion.released ? "success" : "neutral"}>{motion.released ? "Public" : "Hidden"}</Badge>
                      {elsewhere.length > 0 && <span className="text-[11px] text-fg-muted">Also in {elsewhere.join(", ")}</span>}
                    </div>
                  </div>
                  {isOwnerOrAdmin && (
                    <div className="flex shrink-0 items-center">
                      <IconButton
                        label={`Move ${motion.reference || "motion"} up`}
                        size="sm"
                        disabled={busy || index === 0}
                        onClick={() => run(() => updateMotions(moveRoundMotion(motions, round.id, motion.id, -1), `${round.name} motion order changed`))}
                        icon={<ArrowUp aria-hidden="true" />}
                      />
                      <IconButton
                        label={`Move ${motion.reference || "motion"} down`}
                        size="sm"
                        disabled={busy || index === roundMotions.length - 1}
                        onClick={() => run(() => updateMotions(moveRoundMotion(motions, round.id, motion.id, 1), `${round.name} motion order changed`))}
                        icon={<ArrowDown aria-hidden="true" />}
                      />
                      <IconButton
                        label={`Remove ${motion.reference || "motion"} from ${round.name}`}
                        size="sm"
                        disabled={busy}
                        onClick={() => run(() => updateMotions([removeMotionFromRound(motion, round.id)], `Motion removed from ${round.name}`))}
                        icon={<X aria-hidden="true" />}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {isOwnerOrAdmin && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <Select
              label="Reuse a motion from another round"
              value={motionToAdd}
              onChange={(event) => setMotionToAdd(event.target.value)}
              className="min-w-0 sm:w-80"
              disabled={busy || otherMotions.length === 0}
            >
              <option value="">{otherMotions.length === 0 ? "No other motions" : "Choose a motion…"}</option>
              {otherMotions.map((motion) => (
                <option key={motion.id} value={motion.id}>
                  {(motion.reference ? `${motion.reference}: ` : "") + motion.text.slice(0, 80)}
                </option>
              ))}
            </Select>
            <Button
              size="md"
              disabled={busy || !motionToAdd}
              onClick={() => run(async () => {
                await updateMotions(copyMotionsToRound(motions, [motionToAdd], round.id), `Motion reused in ${round.name}`);
                setMotionToAdd("");
              })}
            >
              Add to {round.name}
            </Button>
            <Button
              size="md"
              variant="ghost"
              disabled={busy || !previous}
              title={previous ? `Assign ${previous.name}'s motions to ${round.name}` : "There is no earlier round"}
              onClick={() => run(() => updateMotions(
                copyPreviousRoundMotions(motions, round, rounds),
                `Motions copied to ${round.name} from ${previous?.name}`
              ))}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy from {previous ? previous.name : "previous round"}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
