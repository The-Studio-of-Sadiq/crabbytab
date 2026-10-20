"use client";

import React, { useState } from "react";
import { Eye, EyeOff, Presentation } from "lucide-react";
import type { MotionsStatus, Round } from "@/types";
import { useTournament } from "@/contexts/TournamentContext";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ReleaseActionDialog } from "@/features/tournament/components/ReleaseActionDialog";
import { motionsStatusOf, preparationMinutes } from "@/features/tournament/application/motionRelease";
import { orderRoundMotions } from "@/lib/motions/roundMotions";

const STATUS_OPTIONS = [
  { value: "not_released", label: "Not released", icon: <EyeOff aria-hidden="true" />, description: "Participants see neither info slides nor motions." },
  { value: "info_slides_released", label: "Info slides", icon: <Presentation aria-hidden="true" />, description: "Participants can read the information slides, not the motions." },
  { value: "motions_released", label: "Motions", icon: <Eye aria-hidden="true" />, description: "Motions are public: portals, assistants, the projector and the public motions tab show them." },
] as const;

function describe(status: MotionsStatus, roundName: string, preparation: number | undefined): { title: string; description: string; confirm: string } {
  if (status === "motions_released") {
    return {
      title: `Release the ${roundName} motions?`,
      description: `Every motion assigned to ${roundName} becomes public (portals, assistants, projector and the public motions tab).` +
        (preparation !== undefined ? ` The round's start time is set to ${preparation} minutes from now.` : ""),
      confirm: "Release motions",
    };
  }
  if (status === "info_slides_released") {
    return {
      title: `Release the ${roundName} info slides?`,
      description: `Participants can read ${roundName}'s information slides. The motions themselves stay hidden (and are withdrawn if they were public).`,
      confirm: "Release info slides",
    };
  }
  return {
    title: `Withdraw the ${roundName} motions?`,
    description: `${roundName}'s motions and info slides are hidden again. People who already saw them may remember them.`,
    confirm: "Withdraw",
  };
}

/** Three-state motion release for one round (Tabbycat's motions_status), published on confirm. */
export function MotionReleaseControl({ round }: { round: Round }) {
  const { motions, tournament, isOwnerOrAdmin, setRoundMotionsStatus } = useTournament();
  const [pending, setPending] = useState<MotionsStatus | null>(null);
  const status = motionsStatusOf(round);
  const hasMotions = orderRoundMotions(motions, round.id).length > 0;
  const hasInfoSlides = orderRoundMotions(motions, round.id).some((motion) => Boolean(motion.infoSlide?.trim()));
  const preparation = preparationMinutes(tournament?.preferences);
  const text = pending ? describe(pending, round.name, status === "motions_released" ? undefined : preparation) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        label={`${round.name} motion release`}
        size="sm"
        value={status}
        disabled={!isOwnerOrAdmin || round.cancelled}
        options={STATUS_OPTIONS.map((option) => ({
          ...option,
          disabled: option.value !== "not_released" && (!hasMotions || (option.value === "info_slides_released" && !hasInfoSlides)),
        }))}
        onChange={setPending}
      />
      {!hasMotions && <span className="text-xs text-fg-muted">Assign motions to this round to release them.</span>}
      {pending && text && (
        <ReleaseActionDialog
          title={text.title}
          description={text.description}
          confirmLabel={text.confirm}
          variant={pending === "not_released" ? "danger" : "primary"}
          apply={() => setRoundMotionsStatus(round.id, pending)}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
