"use client";

import React, { useState } from "react";
import { Eye, EyeOff, Megaphone } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { StatusPill } from "@/components/ui/Badge";
import { ReleaseActionDialog } from "@/features/tournament/components/ReleaseActionDialog";
import { getPublicRelease, isTabRound, setRelease } from "@/lib/publicRelease";
import { getPublicSiteSettings } from "@/lib/publicFeatures";

type ReleaseChange = Parameters<typeof setRelease>[1];

interface ReleaseItem {
  key: string;
  label: string;
  description: string;
  released: boolean;
  change: (released: boolean) => ReleaseChange;
}

/** Admin controls for tournament-level public releases (tabs and breaks). */
export function ReleasePanel() {
  const { tournament, rounds, breakCategories, teams, adjudicators, isOwnerOrAdmin, saveTournament } = useTournament();
  const { t, plural } = useI18n();
  const [pending, setPending] = useState<{ item: ReleaseItem; released: boolean } | null>(null);

  if (!tournament || !isOwnerOrAdmin) return null;

  const preferences = tournament.preferences;
  const release = getPublicRelease(preferences);
  const site = getPublicSiteSettings(preferences);
  const anonymousCount =
    teams.reduce((count, team) => count + team.speakers.filter((speaker) => speaker.anonymous).length, 0) +
    adjudicators.filter((adjudicator) => adjudicator.anonymous).length;
  const prelims = rounds.filter((round) => round.stage === "preliminary" && !round.cancelled);
  const completedPrelims = prelims.filter(isTabRound);
  const items: ReleaseItem[] = [
    {
      key: "teamTab",
      label: t("results.release.teamTab"),
      description: t("results.release.teamTabDescription"),
      released: release.teamTab,
      change: (released) => ({ kind: "teamTab", released }),
    },
    {
      key: "speakerTab",
      label: t("results.release.speakerTab"),
      description: t("results.release.speakerTabDescription"),
      released: release.speakerTab,
      change: (released) => ({ kind: "speakerTab", released }),
    },
    ...(preferences.replyScoresEnabled
      ? [{
          key: "repliesTab",
          label: t("results.release.repliesTab"),
          description: t("results.release.repliesTabDescription"),
          released: release.repliesTab,
          change: (released: boolean): ReleaseChange => ({ kind: "repliesTab", released }),
        }]
      : []),
    {
      key: "participants",
      label: t("results.release.participants"),
      description: t("results.release.participantsDescription"),
      released: release.participants,
      change: (released) => ({ kind: "participants", released }),
    },
    {
      key: "institutions",
      label: t("results.release.institutions"),
      description: t("results.release.institutionsDescription"),
      released: release.institutions,
      change: (released) => ({ kind: "institutions", released }),
    },
    {
      key: "adjudicatorCore",
      label: t("results.release.adjudicatorCore"),
      description: plural("results.release.adjudicatorCoreDescription", adjudicators.filter((item) => item.adjCore).length),
      released: release.adjudicatorCore,
      change: (released) => ({ kind: "adjudicatorCore", released }),
    },
    {
      key: "breakingAdjudicators",
      label: t("results.release.breakingAdjudicators"),
      description: plural("results.release.breakingAdjudicatorsDescription", adjudicators.filter((item) => item.breaking).length),
      released: release.breakingAdjudicators,
      change: (released) => ({ kind: "breakingAdjudicators", released }),
    },
    {
      key: "adjudicatorTab",
      label: t("results.release.adjudicatorTab"),
      description: t(
        site.adjudicatorTabShows === "test"
          ? "results.release.adjudicatorTabDescriptionBase"
          : site.adjudicatorTabShows === "final"
            ? "results.release.adjudicatorTabDescriptionFinal"
            : "results.release.adjudicatorTabDescriptionAll"
      ),
      released: site.adjudicatorTab,
      change: (released) => ({ kind: "adjudicatorTab", released }),
    },
    {
      key: "ballots",
      label: t("results.release.ballots"),
      description: t("results.release.ballotsDescription"),
      released: site.ballots,
      change: (released) => ({ kind: "ballots", released }),
    },
    {
      key: "privateBallots",
      label: t("results.release.privateBallots"),
      description: t("results.release.privateBallotsDescription"),
      released: site.privateBallots,
      change: (released) => ({ kind: "privateBallots", released }),
    },
    ...(breakCategories.length > 0
      ? [{
          key: "breakCategoryTabs",
          label: t("results.release.breakCategoryTabs"),
          description: t("results.release.breakCategoryTabsDescription"),
          released: site.breakCategoryTabs,
          change: (released: boolean): ReleaseChange => ({ kind: "breakCategoryTabs", released }),
        }]
      : []),
    {
      key: "recordPages",
      label: t("results.release.recordPages"),
      description: t("results.release.recordPagesDescription"),
      released: site.recordPages,
      change: (released) => ({ kind: "recordPages", released }),
    },
    ...(preferences.sideAllocationRule === "preallocated"
      ? [{
          key: "sideAllocations",
          label: t("results.release.sideAllocations"),
          description: t("results.release.sideAllocationsDescription"),
          released: site.sideAllocations,
          change: (released: boolean): ReleaseChange => ({ kind: "sideAllocations", released }),
        }]
      : []),
    {
      key: "bracket",
      label: t("results.release.bracket"),
      description: t("results.release.bracketDescription"),
      released: site.bracket,
      change: (released) => ({ kind: "bracket", released }),
    },
    {
      key: "diversity",
      label: t("results.release.diversity"),
      description: anonymousCount > 0
        ? `${t("results.release.diversityDescription")} ${plural("results.release.diversityAnonymous", anonymousCount)}`
        : t("results.release.diversityDescription"),
      released: site.diversity,
      change: (released) => ({ kind: "diversity", released }),
    },
    ...(preferences.enableMotionVetoes
      ? [{
          key: "vetoStatistics",
          label: t("results.release.vetoStatistics"),
          description: t("results.release.vetoStatisticsDescription"),
          released: site.vetoStatistics,
          change: (released: boolean): ReleaseChange => ({ kind: "vetoStatistics", released }),
        }]
      : []),
    {
      key: "motionTab",
      label: t("results.release.motionTab"),
      description: t("results.release.motionTabDescription"),
      released: site.motionTab,
      change: (released) => ({ kind: "motionTab", released }),
    },
    {
      key: "feedbackProgress",
      label: t("results.release.feedbackProgress"),
      description: t("results.release.feedbackProgressDescription"),
      released: site.feedbackProgress,
      change: (released) => ({ kind: "feedbackProgress", released }),
    },
    ...[...breakCategories]
      .sort((left, right) => (right.priority || 0) - (left.priority || 0))
      .map((category) => {
        const generated = Boolean(
          category.generatedBreak || teams.some((team) => team.breakCategoryIds?.includes(category.id))
        );
        return {
          key: `break-${category.id}`,
          label: t("results.release.breakItem", { name: category.name }),
          description: t(generated ? "results.release.breakGenerated" : "results.release.breakNotGenerated"),
          released: release.breakCategoryIds.has(category.id),
          change: (released: boolean): ReleaseChange => ({ kind: "break", categoryId: category.id, released }),
        };
      }),
  ];

  const applyRelease = async () => {
    if (!pending) return;
    await saveTournament({
      ...tournament,
      preferences: setRelease(tournament.preferences, pending.item.change(pending.released)),
    });
  };

  const incompleteTabs = (item: ReleaseItem) =>
    completedPrelims.length < prelims.length && item.key.endsWith("Tab")
      ? ` ${t("results.release.incompleteRounds", { completed: completedPrelims.length, total: prelims.length })}`
      : "";

  return (
    <Card role="region" aria-label={t("results.release.title")}>
      <CardHeader
        icon={<Megaphone aria-hidden="true" />}
        title={t("results.release.title")}
        description={t("results.release.coverage", { completed: completedPrelims.length, total: prelims.length })}
      />
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.key} className="flex flex-col justify-between gap-2 px-4 py-2 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">{item.label}</p>
              <p className="text-xs text-fg-muted">{item.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {item.released ? (
                <StatusPill tone="success" icon={<Eye aria-hidden="true" />}>
                  {t("results.release.public")}
                </StatusPill>
              ) : (
                <StatusPill tone="neutral" icon={<EyeOff aria-hidden="true" />}>
                  {t("results.release.hidden")}
                </StatusPill>
              )}
              <Button
                size="sm"
                variant="secondary"
                aria-label={t(item.released ? "results.release.unreleaseItem" : "results.release.releaseItem", { item: item.label })}
                onClick={() => setPending({ item, released: !item.released })}
              >
                {t(item.released ? "results.release.unrelease" : "results.release.release")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {pending && (
        <ReleaseActionDialog
          title={t(pending.released ? "results.release.confirmReleaseTitle" : "results.release.confirmUnreleaseTitle", {
            item: pending.item.label.toLowerCase(),
          })}
          description={pending.released
            ? `${pending.item.description}${incompleteTabs(pending.item)}`
            : t("results.release.unreleaseDescription")}
          confirmLabel={t(pending.released ? "results.release.confirmRelease" : "results.release.confirmUnrelease")}
          apply={applyRelease}
          onClose={() => setPending(null)}
        />
      )}
    </Card>
  );
}
