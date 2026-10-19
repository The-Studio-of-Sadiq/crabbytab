"use client";

import React, { useState } from "react";
import { Eye, EyeOff, Megaphone } from "lucide-react";

import { useTournament } from "@/contexts/TournamentContext";
import { ReleaseActionDialog } from "@/features/tournament/components/ReleaseActionDialog";
import { getPublicRelease, isTabRound, setRelease } from "@/lib/publicRelease";

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
  const [pending, setPending] = useState<{ item: ReleaseItem; released: boolean } | null>(null);

  if (!tournament || !isOwnerOrAdmin) return null;

  const preferences = tournament.preferences;
  const release = getPublicRelease(preferences);
  const prelims = rounds.filter((round) => round.stage === "preliminary" && !round.cancelled);
  const completedPrelims = prelims.filter(isTabRound);
  const items: ReleaseItem[] = [
    {
      key: "teamTab",
      label: "Team tab",
      description: "Full team standings, including silent rounds.",
      released: release.teamTab,
      change: (released) => ({ kind: "teamTab", released }),
    },
    {
      key: "speakerTab",
      label: "Speaker tab",
      description: "Individual speaker scores and rankings.",
      released: release.speakerTab,
      change: (released) => ({ kind: "speakerTab", released }),
    },
    ...(preferences.replyScoresEnabled
      ? [{
          key: "repliesTab",
          label: "Replies tab",
          description: "Reply speaker rankings.",
          released: release.repliesTab,
          change: (released: boolean): ReleaseChange => ({ kind: "repliesTab", released }),
        }]
      : []),
    {
      key: "participants",
      label: "Participants list",
      description: "Every team with its speakers, and every adjudicator with their institution.",
      released: release.participants,
      change: (released) => ({ kind: "participants", released }),
    },
    {
      key: "institutions",
      label: "Institutions list",
      description: "Institution names, codes and regions (with team and adjudicator counts if participants are public).",
      released: release.institutions,
      change: (released) => ({ kind: "institutions", released }),
    },
    {
      key: "adjudicatorCore",
      label: "Adjudication core",
      description: `${adjudicators.filter((item) => item.adjCore).length} adjudicator(s) marked as core in the participant directory.`,
      released: release.adjudicatorCore,
      change: (released) => ({ kind: "adjudicatorCore", released }),
    },
    {
      key: "breakingAdjudicators",
      label: "Breaking adjudicators",
      description: `${adjudicators.filter((item) => item.breaking).length} adjudicator(s) marked as breaking in the participant directory.`,
      released: release.breakingAdjudicators,
      change: (released) => ({ kind: "breakingAdjudicators", released }),
    },
    ...[...breakCategories]
      .sort((left, right) => (right.priority || 0) - (left.priority || 0))
      .map((category) => {
        const generated = Boolean(
          category.generatedBreak || teams.some((team) => team.breakCategoryIds?.includes(category.id))
        );
        return {
          key: `break-${category.id}`,
          label: `${category.name} break`,
          description: generated ? "The generated break for this category." : "Not generated yet; nothing will show until it is.",
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

  return (
    <section aria-labelledby="release-panel-title" className="bg-white border border-[#d0d7de] rounded-lg shadow-xs">
      <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] flex flex-wrap items-center justify-between gap-2">
        <h2 id="release-panel-title" className="text-xs font-bold text-gray-900 uppercase tracking-wide flex items-center gap-1.5">
          <Megaphone className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
          Public release
        </h2>
        <span className="text-[11px] text-gray-500">
          Tabs cover {completedPrelims.length} of {prelims.length} preliminary rounds (completed rounds only).
        </span>
      </div>
      <ul className="divide-y divide-gray-100">
        {items.map((item) => (
          <li key={item.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2">
            <div>
              <p className="text-xs font-semibold text-gray-900">{item.label}</p>
              <p className="text-[11px] text-gray-500">{item.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${
                  item.released ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-gray-100 text-gray-600 border-gray-300"
                }`}
              >
                {item.released ? <Eye className="w-3 h-3" aria-hidden="true" /> : <EyeOff className="w-3 h-3" aria-hidden="true" />}
                {item.released ? "Public" : "Hidden"}
              </span>
              <button
                type="button"
                onClick={() => setPending({ item, released: !item.released })}
                className={`rounded px-2.5 py-1 text-[11px] font-bold ${
                  item.released
                    ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                {item.released ? "Unrelease" : "Release"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {pending && (
        <ReleaseActionDialog
          title={`${pending.released ? "Release" : "Unrelease"} ${pending.item.label.toLowerCase()}?`}
          description={pending.released
            ? `${pending.item.description}${
                completedPrelims.length < prelims.length && pending.item.key.endsWith("Tab")
                  ? ` Only ${completedPrelims.length} of ${prelims.length} preliminary rounds are complete.`
                  : ""
              }`
            : "It will be hidden from the public page."}
          confirmLabel={pending.released ? "Release and publish" : "Unrelease and publish"}
          apply={applyRelease}
          onClose={() => setPending(null)}
        />
      )}
    </section>
  );
}
