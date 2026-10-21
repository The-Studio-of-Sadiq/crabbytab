"use client";

import React, { useState } from "react";

import { useTournament } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/Field";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n/messages";
import { createSeededRng, randomSeed } from "@/lib/draw/rng";
import { generateTeamCodeNames, hasCodeName, assignTeamEmoji, type CodeNameMethod } from "@/lib/codeNames";
import { getPublicSiteSettings, PUBLIC_TEXT_MAX_LENGTH, publicUsesTeamCodeNames } from "@/lib/publicFeatures";
import type { TournamentPreferences } from "@/types";

type SetPrefs = React.Dispatch<React.SetStateAction<TournamentPreferences>>;

/** Drops a key instead of storing undefined (Firestore rejects undefined values). */
function withValue<K extends keyof TournamentPreferences>(
  current: TournamentPreferences,
  key: K,
  value: TournamentPreferences[K] | undefined
): TournamentPreferences {
  const next = { ...current };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

function limitValue(raw: string): number | undefined {
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Public-site settings (Tabbycat public_features / ui_options) on the Public Visibility page. The
 * per-item releases (adjudicator tab, scoresheets, diversity, ...) are on the Public release panel.
 */
export function PublicSiteSettingsFields({ prefs, setPrefs }: { prefs: TournamentPreferences; setPrefs: SetPrefs }) {
  const { t } = useI18n();
  const site = getPublicSiteSettings(prefs);
  const set = <K extends keyof TournamentPreferences>(key: K, value: TournamentPreferences[K] | undefined) =>
    setPrefs((current) => withValue(current, key, value));

  return (
    <div className="space-y-6 border-t border-border pt-4">
      <section className="space-y-3">
        <h3 className="text-[13px] font-semibold text-fg">{t("setup.config.siteDrawTabsTitle")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t("setup.config.publicDrawLabel")}
            value={site.drawMode}
            help={t("setup.config.publicDrawHelp")}
            onChange={(event) => {
              const mode = event.target.value as TournamentPreferences["publicDrawMode"];
              // The legacy switch is kept in step for older readers.
              setPrefs((current) => ({ ...current, publicDrawMode: mode, publicDraw: mode !== "off" }));
            }}
          >
            <option value="off">{t("setup.config.publicDrawOff")}</option>
            <option value="current">{t("setup.config.publicDrawCurrent")}</option>
            <option value="all">{t("setup.config.publicDrawAll")}</option>
          </Select>
          <Select
            label={t("setup.config.adjTabShowsLabel")}
            value={site.adjudicatorTabShows}
            onChange={(event) => set("adjudicatorTabShows", event.target.value as TournamentPreferences["adjudicatorTabShows"])}
            help={t("setup.config.adjTabShowsHelp")}
          >
            <option value="test">{t("setup.config.adjTabTest")}</option>
            <option value="final">{t("setup.config.adjTabFinal")}</option>
            <option value="all">{t("setup.config.adjTabAll")}</option>
          </Select>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {([
            ["teamTabLimit", "setup.config.teamTabLimitLabel"],
            ["speakerTabLimit", "setup.config.speakerTabLimitLabel"],
            ["repliesTabLimit", "setup.config.repliesTabLimitLabel"],
          ] as const satisfies ReadonlyArray<readonly [string, MessageKey]>).map(([key, label]) => (
            <Input
              key={key}
              type="number"
              min={0}
              step={1}
              label={t(label)}
              value={prefs[key] ?? 0}
              onChange={(event) => set(key, limitValue(event.target.value))}
            />
          ))}
          <Input
            type="number"
            min={-1}
            step={1}
            label={t("setup.config.breakMetricsLabel")}
            help={t("setup.config.breakMetricsHelp")}
            value={prefs.publicBreakMetrics ?? -1}
            onChange={(event) => {
              const value = Math.floor(Number(event.target.value));
              set("publicBreakMetrics", Number.isFinite(value) && value >= 0 ? value : undefined);
            }}
          />
        </div>
        <p className="text-xs text-fg-muted">{t("setup.config.tabLimitHelp")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox
            label={t("setup.config.breakCategoriesLabel")}
            checked={site.breakCategoriesOnParticipants}
            onChange={(event) => set("publicBreakCategories", event.target.checked || undefined)}
          />
          <Select
            label={t("setup.config.motionsOrderLabel")}
            value={site.motionsOrder}
            onChange={(event) => set("publicMotionsOrder", event.target.value as TournamentPreferences["publicMotionsOrder"])}
          >
            <option value="forward">{t("setup.config.motionsOrderForward")}</option>
            <option value="reverse">{t("setup.config.motionsOrderReverse")}</option>
          </Select>
          <Checkbox
            label={t("setup.config.motionsInResultsLabel")}
            description={t("setup.config.motionsInResultsHelp")}
            checked={site.motionsInResults}
            onChange={(event) => set("showMotionsInResults", event.target.checked || undefined)}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[13px] font-semibold text-fg">{t("setup.config.siteNamesTitle")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={t("setup.config.teamCodeNamesLabel")}
            value={site.teamCodeNames}
            onChange={(event) => set("teamCodeNames", event.target.value as TournamentPreferences["teamCodeNames"])}
            help={t("setup.config.teamCodeNamesHelp")}
          >
            <option value="off">{t("setup.config.codeNamesOff")}</option>
            <option value="all-tooltips">{t("setup.config.codeNamesAllTooltips")}</option>
            <option value="admin-tooltips-code">{t("setup.config.codeNamesAdminCode")}</option>
            <option value="admin-tooltips-real">{t("setup.config.codeNamesAdminReal")}</option>
            <option value="everywhere">{t("setup.config.codeNamesEverywhere")}</option>
          </Select>
          <Select
            label={t("setup.config.participantCodeNamesLabel")}
            value={site.participantCodeNames}
            onChange={(event) => set("participantCodeNames", event.target.value as TournamentPreferences["participantCodeNames"])}
            help={t("setup.config.participantCodeNamesHelp")}
          >
            <option value="off">{t("setup.config.codeNamesOff")}</option>
            <option value="everywhere">{t("setup.config.participantCodeNamesPublic")}</option>
          </Select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox
            label={t("setup.config.showTeamInstitutions")}
            checked={site.showTeamInstitutions}
            onChange={(event) => set("showTeamInstitutions", event.target.checked ? undefined : false)}
          />
          <Checkbox
            label={t("setup.config.showAdjInstitutions")}
            checked={site.showAdjudicatorInstitutions}
            onChange={(event) => set("showAdjudicatorInstitutions", event.target.checked ? undefined : false)}
          />
          <Checkbox
            label={t("setup.config.showEmoji")}
            checked={site.showEmoji}
            onChange={(event) => set("showEmoji", event.target.checked ? undefined : false)}
          />
          <Checkbox
            label={t("setup.config.showSpeakersInDraw")}
            checked={site.showSpeakersInDraw}
            onChange={(event) => set("showSpeakersInDraw", event.target.checked ? undefined : false)}
          />
          <Checkbox
            label={t("setup.config.showSplittingAdjs")}
            description={t("setup.config.showSplittingAdjsHelp")}
            checked={site.showSplittingAdjudicators}
            onChange={(event) => set("showSplittingAdjudicators", event.target.checked || undefined)}
          />
        </div>
        <p className="text-xs text-fg-muted">{t("setup.config.anonymityHelp")}</p>
        <CodeNameTools usesCodeNames={publicUsesTeamCodeNames(site.teamCodeNames)} />
      </section>

      <section className="space-y-3">
        <h3 className="text-[13px] font-semibold text-fg">{t("setup.config.siteHomepageTitle")}</h3>
        <Select
          label={t("setup.config.searchEnginesLabel")}
          value={site.searchEngineIndexing}
          onChange={(event) => set("searchEngineIndexing", event.target.value as TournamentPreferences["searchEngineIndexing"])}
          help={t("setup.config.searchEnginesHelp")}
          wrapperClassName="max-w-md"
        >
          <option value="all">{t("setup.config.searchEnginesAll")}</option>
          <option value="homepage-only">{t("setup.config.searchEnginesHomepage")}</option>
          <option value="none">{t("setup.config.searchEnginesNone")}</option>
        </Select>
        <div className="grid gap-3 sm:grid-cols-2">
          <Textarea
            label={t("setup.config.welcomeMessageLabel")}
            rows={4}
            maxLength={PUBLIC_TEXT_MAX_LENGTH}
            value={prefs.welcomeMessage ?? ""}
            onChange={(event) => set("welcomeMessage", event.target.value || undefined)}
            help={t("setup.config.welcomeMessageHelp")}
          />
          <Textarea
            label={t("setup.config.staffCreditsLabel")}
            rows={4}
            maxLength={PUBLIC_TEXT_MAX_LENGTH}
            value={prefs.tournamentStaff ?? ""}
            onChange={(event) => set("tournamentStaff", event.target.value || undefined)}
            help={t("setup.config.staffCreditsHelp")}
          />
        </div>
      </section>
    </div>
  );
}

/** Fills in missing team emoji and code names (Tabbycat's code-name generators). */
function CodeNameTools({ usesCodeNames }: { usesCodeNames: boolean }) {
  const { t, plural } = useI18n();
  const { teams, saveEntityBatch, isOwnerOrAdmin } = useTournament();
  const [method, setMethod] = useState<CodeNameMethod>("emoji");
  const [status, setStatus] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const missingCodes = teams.filter((team) => !hasCodeName(team)).length;
  const missingEmoji = teams.filter((team) => !team.emoji).length;

  const run = async (kind: "codes" | "emoji") => {
    setBusy(true);
    setStatus(null);
    try {
      const rng = createSeededRng(randomSeed());
      const updated = kind === "codes" ? generateTeamCodeNames(teams, method, rng) : assignTeamEmoji(teams, rng);
      // The audit labels are saved with the change, so they stay in English.
      if (updated.length > 0) await saveEntityBatch({ teamsUpdated: updated }, kind === "codes" ? "code-name generator" : "emoji generator");
      setStatus({ tone: "success", text: plural("setup.config.teamsUpdated", updated.length) });
    } catch (error) {
      // Messages thrown by the tournament context are shown as they are (English).
      setStatus({ tone: "error", text: error instanceof Error ? error.message : t("setup.config.teamsUpdateFailed") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted p-3 text-[13px]">
      <p className="text-fg">
        {t("setup.config.codeNameSummary", { missingCodes, total: teams.length, missingEmoji })}
        {usesCodeNames && missingCodes > 0 && <> {t("setup.config.codeNameMissingWarning")}</>}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label={t("setup.config.codeNameStandardLabel")}
          value={method}
          onChange={(event) => setMethod(event.target.value as CodeNameMethod)}
          disabled={!isOwnerOrAdmin || busy}
        >
          <option value="emoji">{t("setup.config.codeNameEmoji")}</option>
          <option value="last_names">{t("setup.config.codeNameLastNames")}</option>
        </Select>
        <Button type="button" size="sm" variant="secondary" disabled={!isOwnerOrAdmin || busy || missingCodes === 0} onClick={() => void run("codes")}>
          {t("setup.config.generateCodeNames")}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={!isOwnerOrAdmin || busy || missingEmoji === 0} onClick={() => void run("emoji")}>
          {t("setup.config.assignEmoji")}
        </Button>
      </div>
      <div role="status">
        {status?.tone === "success" && <p className="text-fg-muted">{status.text}</p>}
      </div>
      {status?.tone === "error" && <p role="alert" className="text-danger">{status.text}</p>}
    </div>
  );
}
