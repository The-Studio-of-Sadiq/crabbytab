"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Tags } from "lucide-react";

import type { BreakCategory, SpeakerCategoryEligibilityRule } from "@/types";
import { useTournament } from "@/contexts/TournamentContext";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import {
  describeEligibilityRule,
  effectiveSpeakerCategories,
  planEligibilityFromSpeakerCategories,
} from "@/lib/speakerCategories";

/**
 * A break category's eligibility derived from speaker categories, e.g. "ESL break: every speaker
 * is ESL" or "at least 2 speakers are novices". The rule is stored on the break category and
 * applied to team eligibility only when the organiser asks, after seeing which teams change, so
 * manual eligibility edits are never overwritten silently.
 */
export function SpeakerCategoryEligibilityPanel({ category }: { category: BreakCategory }) {
  const { tournament, teams, breakCategories, saveBreakCategories, saveEntityBatch, isOwnerOrAdmin } = useTournament();
  const speakerCategories = useMemo(
    () => effectiveSpeakerCategories(tournament?.preferences.speakerCategories, teams),
    [tournament?.preferences.speakerCategories, teams]
  );
  const rule = category.speakerCategoryRule;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const change = useMemo(
    () => planEligibilityFromSpeakerCategories(teams, category, speakerCategories),
    [teams, category, speakerCategories]
  );

  if (category.isGeneral) return null;

  const saveRule = async (next: SpeakerCategoryEligibilityRule | undefined) => {
    setBusy(true);
    setError("");
    try {
      await saveBreakCategories(
        breakCategories.map((item) => {
          if (item.id !== category.id) return item;
          const { speakerCategoryRule: _previous, ...rest } = item;
          return next ? { ...rest, speakerCategoryRule: next } : rest;
        })
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the rule.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      await saveEntityBatch({ teamsUpdated: change.updated }, `${category.name} eligibility from speaker categories`);
      setConfirming(false);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Could not update team eligibility.");
    } finally {
      setBusy(false);
    }
  };

  const names = (list: { name: string }[]) =>
    list.length === 0 ? "none" : list.slice(0, 12).map((team) => team.name).join(", ") + (list.length > 12 ? ` and ${list.length - 12} more` : "");

  return (
    <section aria-label="Eligibility from speaker categories" className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 space-y-2">
      <h4 className="flex items-center gap-1.5 font-semibold text-gray-900">
        <Tags className="h-3.5 w-3.5" aria-hidden="true" />
        Eligibility from speaker categories
      </h4>
      {speakerCategories.length === 0 ? (
        <p>
          No speaker categories yet. Add them under{" "}
          <Link className="underline" href={`/${tournament?.slug}/imports/speaker-categories`}>Speaker categories</Link>.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Speaker category</span>
            <select
              value={rule?.speakerCategoryId ?? ""}
              disabled={!isOwnerOrAdmin || busy}
              onChange={(event) =>
                void saveRule(event.target.value ? { speakerCategoryId: event.target.value, minimumSpeakers: rule?.minimumSpeakers } : undefined)
              }
              className="rounded border border-gray-300 bg-white px-2 py-1"
            >
              <option value="">No rule (set eligibility by hand)</option>
              {speakerCategories.map((item) => (
                <option key={item.id} value={item.id}>{item.name}{item.unsaved ? " (unsaved)" : ""}</option>
              ))}
            </select>
          </label>
          {rule && (
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Speakers required</span>
              <select
                value={rule.minimumSpeakers ?? 0}
                disabled={!isOwnerOrAdmin || busy}
                onChange={(event) => {
                  const minimum = Number(event.target.value);
                  void saveRule({ speakerCategoryId: rule.speakerCategoryId, ...(minimum > 0 ? { minimumSpeakers: minimum } : {}) });
                }}
                className="rounded border border-gray-300 bg-white px-2 py-1"
              >
                <option value={0}>Every speaker</option>
                {[1, 2, 3].map((count) => (
                  <option key={count} value={count}>At least {count}</option>
                ))}
              </select>
            </label>
          )}
          {rule && isOwnerOrAdmin && (
            <button
              type="button"
              disabled={busy || change.updated.length === 0}
              onClick={() => setConfirming(true)}
              className="rounded bg-purple-600 px-3 py-1.5 font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {change.updated.length === 0 ? "Eligibility matches the rule" : `Apply to ${change.updated.length} team${change.updated.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
      {rule && (
        <p>
          Rule: eligible when {describeEligibilityRule(rule, speakerCategories)}.{" "}
          {change.updated.length > 0 && `${change.teamsToAdd.length} team(s) would become eligible and ${change.teamsToRemove.length} would lose eligibility.`}
        </p>
      )}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {confirming && rule && (
        <ConfirmActionDialog
          title={`Update ${category.name} eligibility?`}
          description={`Becoming eligible: ${names(change.teamsToAdd)}. Losing eligibility: ${names(change.teamsToRemove)}. Manual changes for these teams are replaced; other teams are not touched.`}
          confirmLabel="Update eligibility"
          onConfirm={() => void apply()}
          onCancel={() => setConfirming(false)}
          isBusy={busy}
          error={error}
        />
      )}
    </section>
  );
}
