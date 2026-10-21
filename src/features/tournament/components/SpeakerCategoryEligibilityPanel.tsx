"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Tags } from "lucide-react";

import type { BreakCategory, SpeakerCategoryEligibilityRule } from "@/types";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { focusRing } from "@/components/ui/focus";
import { effectiveSpeakerCategories, planEligibilityFromSpeakerCategories } from "@/lib/speakerCategories";

/** Team names shown in the confirmation before the list is shortened to "… and N more". */
const NAMES_SHOWN = 12;

/**
 * A break category's eligibility derived from speaker categories, e.g. "ESL break: every speaker
 * is ESL" or "at least 2 speakers are novices". The rule is stored on the break category and
 * applied to team eligibility only when the organiser asks, after seeing which teams change, so
 * manual eligibility edits are never overwritten silently.
 */
export function SpeakerCategoryEligibilityPanel({ category }: { category: BreakCategory }) {
  const { tournament, teams, breakCategories, saveBreakCategories, saveEntityBatch, isOwnerOrAdmin } = useTournament();
  const { t, plural, rich, formatList } = useI18n();
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
      setError(saveError instanceof Error ? saveError.message : t("results.break.eligibility.saveRuleFailed"));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      // The audit summary is saved with the record, so it stays in English for every viewer.
      await saveEntityBatch({ teamsUpdated: change.updated }, `${category.name} eligibility from speaker categories`);
      setConfirming(false);
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : t("results.break.eligibility.applyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const names = (list: { name: string }[]) => {
    if (list.length === 0) return t("results.break.eligibility.none");
    const shown = formatList(list.slice(0, NAMES_SHOWN).map((team) => team.name));
    return list.length > NAMES_SHOWN
      ? t("results.break.eligibility.namesAndMore", { names: shown, count: list.length - NAMES_SHOWN })
      : shown;
  };

  const ruleCategoryName = rule
    ? speakerCategories.find((item) => item.id === rule.speakerCategoryId)?.name ?? t("results.break.eligibility.unknownCategory")
    : "";
  const ruleText = rule
    ? rule.minimumSpeakers
      ? plural("results.break.eligibility.ruleAtLeast", rule.minimumSpeakers, { category: ruleCategoryName })
      : t("results.break.eligibility.ruleEvery", { category: ruleCategoryName })
    : "";

  return (
    <section
      aria-labelledby={`eligibility-${category.id}`}
      className="space-y-2 border-b border-border bg-muted/40 px-4 py-3 text-xs text-fg-muted"
    >
      <h3 id={`eligibility-${category.id}`} className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
        <Tags className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
        {t("results.break.eligibility.title")}
      </h3>
      {speakerCategories.length === 0 ? (
        <p>
          {rich("results.break.eligibility.noCategories", {
            link: (text) => (
              <Link
                className={`rounded-sm font-medium text-accent-text underline underline-offset-2 ${focusRing}`}
                href={`/${tournament?.slug}/imports/speaker-categories`}
              >
                {text}
              </Link>
            ),
          })}
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={t("results.break.eligibility.speakerCategory")}
            value={rule?.speakerCategoryId ?? ""}
            disabled={!isOwnerOrAdmin || busy}
            onChange={(event) =>
              void saveRule(event.target.value ? { speakerCategoryId: event.target.value, minimumSpeakers: rule?.minimumSpeakers } : undefined)
            }
            className="w-auto min-w-48"
          >
            <option value="">{t("results.break.eligibility.noRule")}</option>
            {speakerCategories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.unsaved ? t("results.break.eligibility.unsavedCategory", { name: item.name }) : item.name}
              </option>
            ))}
          </Select>
          {rule && (
            <Select
              label={t("results.break.eligibility.speakersRequired")}
              value={rule.minimumSpeakers ?? 0}
              disabled={!isOwnerOrAdmin || busy}
              onChange={(event) => {
                const minimum = Number(event.target.value);
                void saveRule({ speakerCategoryId: rule.speakerCategoryId, ...(minimum > 0 ? { minimumSpeakers: minimum } : {}) });
              }}
              className="w-auto min-w-36"
            >
              <option value={0}>{t("results.break.eligibility.everySpeaker")}</option>
              {[1, 2, 3].map((count) => (
                <option key={count} value={count}>{t("results.break.eligibility.atLeast", { count })}</option>
              ))}
            </Select>
          )}
          {rule && isOwnerOrAdmin && (
            <Button
              variant="secondary"
              disabled={busy || change.updated.length === 0}
              onClick={() => setConfirming(true)}
            >
              {change.updated.length === 0
                ? t("results.break.eligibility.matchesRule")
                : plural("results.break.eligibility.applyToTeams", change.updated.length)}
            </Button>
          )}
        </div>
      )}
      {rule && (
        <p>
          {ruleText}
          {change.updated.length > 0 && (
            <>
              {" "}
              {plural("results.break.eligibility.wouldBecomeEligible", change.teamsToAdd.length)}{" "}
              {plural("results.break.eligibility.wouldLoseEligibility", change.teamsToRemove.length)}
            </>
          )}
        </p>
      )}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {confirming && rule && (
        <ConfirmActionDialog
          title={t("results.break.eligibility.confirmTitle", { category: category.name })}
          description={t("results.break.eligibility.confirmDescription", {
            add: names(change.teamsToAdd),
            remove: names(change.teamsToRemove),
          })}
          confirmLabel={t("results.break.eligibility.confirmLabel")}
          onConfirm={() => void apply()}
          onCancel={() => setConfirming(false)}
          isBusy={busy}
          error={error}
        />
      )}
    </section>
  );
}
