"use client";

import React, { useState } from "react";
import { Eye, EyeOff, Presentation } from "lucide-react";
import type { MotionsStatus, Round } from "@/types";
import { useTournament } from "@/contexts/TournamentContext";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ReleaseActionDialog } from "@/features/tournament/components/ReleaseActionDialog";
import { motionsStatusOf, preparationMinutes } from "@/features/tournament/application/motionRelease";
import { orderRoundMotions } from "@/lib/motions/roundMotions";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey, MessageValues } from "@/lib/i18n";

type Translate = (key: MessageKey, values?: MessageValues) => string;

function statusOptions(t: Translate) {
  return [
    { value: "not_released", label: t("tabroom.schedule.release.notReleased"), icon: <EyeOff aria-hidden="true" />, description: t("tabroom.schedule.release.notReleasedHelp") },
    { value: "info_slides_released", label: t("tabroom.schedule.release.infoSlides"), icon: <Presentation aria-hidden="true" />, description: t("tabroom.schedule.release.infoSlidesHelp") },
    { value: "motions_released", label: t("tabroom.schedule.release.motions"), icon: <Eye aria-hidden="true" />, description: t("tabroom.schedule.release.motionsHelp") },
  ] as const;
}

function describe(t: Translate, status: MotionsStatus, roundName: string, preparation: number | undefined): { title: string; description: string; confirm: string } {
  const round = roundName;
  if (status === "motions_released") {
    return {
      title: t("tabroom.schedule.release.motionsTitle", { round }),
      description: preparation !== undefined
        ? t("tabroom.schedule.release.motionsPreparation", { round, minutes: preparation })
        : t("tabroom.schedule.release.motionsDescription", { round }),
      confirm: t("tabroom.schedule.release.motionsConfirm"),
    };
  }
  if (status === "info_slides_released") {
    return {
      title: t("tabroom.schedule.release.infoTitle", { round }),
      description: t("tabroom.schedule.release.infoDescription", { round }),
      confirm: t("tabroom.schedule.release.infoConfirm"),
    };
  }
  return {
    title: t("tabroom.schedule.release.withdrawTitle", { round }),
    description: t("tabroom.schedule.release.withdrawDescription", { round }),
    confirm: t("tabroom.schedule.release.withdrawConfirm"),
  };
}

/** Three-state motion release for one round (Tabbycat's motions_status), published on confirm. */
export function MotionReleaseControl({ round }: { round: Round }) {
  const { t } = useI18n();
  const { motions, tournament, isOwnerOrAdmin, setRoundMotionsStatus } = useTournament();
  const [pending, setPending] = useState<MotionsStatus | null>(null);
  const status = motionsStatusOf(round);
  const hasMotions = orderRoundMotions(motions, round.id).length > 0;
  const hasInfoSlides = orderRoundMotions(motions, round.id).some((motion) => Boolean(motion.infoSlide?.trim()));
  const preparation = preparationMinutes(tournament?.preferences);
  const text = pending ? describe(t, pending, round.name, status === "motions_released" ? undefined : preparation) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        label={t("tabroom.schedule.release.label", { round: round.name })}
        size="sm"
        value={status}
        disabled={!isOwnerOrAdmin || round.cancelled}
        options={statusOptions(t).map((option) => ({
          ...option,
          disabled: option.value !== "not_released" && (!hasMotions || (option.value === "info_slides_released" && !hasInfoSlides)),
        }))}
        onChange={setPending}
      />
      {!hasMotions && <span className="text-xs text-fg-muted">{t("tabroom.schedule.release.needMotions")}</span>}
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
