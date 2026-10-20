"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  ScoreAggregation,
  ScoreCriterion,
  ScoreCriterionSpeechType,
  SideNames,
  SpeakerRanksMode,
  SpeakersInBallots,
  TournamentFormat,
  TournamentPreferences,
  WinnerDeclaration,
} from "@/types";
import {
  maximumMarginFor,
  motionsEnabled,
  replyScoreStep,
  requireSubstantiveForReply,
  scoreAggregationFor,
  scoreCriteriaFor,
  speakerRanksFor,
  speakersInBallotsFor,
  validateScoreCriteria,
  winnerDeclarationFor,
} from "@/lib/ballots/ballotRules";
import { SIDE_NAME_OPTIONS, SIDE_NAME_SETS, sideNamesFor } from "@/lib/sideNames";
import type { MessageKey } from "@/lib/i18n/messages";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Checkbox, Input, Select } from "@/components/ui/Field";
import { Button, IconButton } from "@/components/ui/Button";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";

/**
 * Settings for how ballots record results (Tabbycat's winners_in_ballots, speakers_in_ballots,
 * speaker_ranks, score_aggregation_function, maximum_margin, reply_score_step,
 * require_substantive_for_reply, side_names, enable_motions and score criteria).
 */
interface ResultsRulesSettingsProps {
  prefs: TournamentPreferences;
  onChange: (patch: Partial<TournamentPreferences>) => void;
  format: TournamentFormat;
  /** Ballots exist: settings that change a ballot's shape are fixed. */
  shapeLocked: boolean;
}

const WINNER_OPTIONS: [WinnerDeclaration, MessageKey][] = [
  ["none", "results.rules.winner.none"],
  ["high-points", "results.rules.winner.highPoints"],
  ["tied-points", "results.rules.winner.tiedPoints"],
  ["low-points", "results.rules.winner.lowPoints"],
];

const SPEAKERS_OPTIONS: [SpeakersInBallots, MessageKey][] = [
  ["always", "results.rules.speakers.always"],
  ["prelim", "results.rules.speakers.prelim"],
  ["never", "results.rules.speakers.never"],
];

const RANK_OPTIONS: [SpeakerRanksMode, MessageKey][] = [
  ["none", "results.rules.ranks.none"],
  ["any", "results.rules.ranks.any"],
  ["high-points", "results.rules.ranks.highPoints"],
];

const SPEECH_TYPES: [ScoreCriterionSpeechType, MessageKey][] = [
  ["all", "results.rules.criteria.speechType.all"],
  ["substantive", "results.rules.criteria.speechType.substantive"],
  ["reply", "results.rules.criteria.speechType.reply"],
];

type NumberField = "weight" | "minScore" | "maxScore" | "step";

const NUMBER_FIELD_LABELS: Record<NumberField, MessageKey> = {
  weight: "results.rules.criteria.weightLabel",
  minScore: "results.rules.criteria.minLabel",
  maxScore: "results.rules.criteria.maxLabel",
  step: "results.rules.criteria.stepLabel",
};

const box = "rounded-lg border border-border bg-muted/40 p-3";

export function ResultsRulesSettings({ prefs, onChange, format, shapeLocked }: ResultsRulesSettingsProps) {
  const { t } = useI18n();
  const twoTeam = format !== "bp";
  const criteria = scoreCriteriaFor(prefs);
  const criteriaErrors = validateScoreCriteria(criteria);
  const lockedNote = t("results.rules.locked");

  const setCriteria = (next: ScoreCriterion[]) =>
    onChange({ scoreCriteria: next.map((criterion, index) => ({ ...criterion, seq: index + 1 })) });
  const updateCriterion = (id: string, patch: Partial<ScoreCriterion>) =>
    setCriteria(criteria.map((criterion) => (criterion.id === id ? { ...criterion, ...patch } : criterion)));

  return (
    <div className="space-y-4">
      <div className={box}>
        <Select
          label={t("results.rules.winner.label")}
          help={twoTeam ? t("results.rules.winner.helpTwoTeam") : t("results.rules.winner.helpBp")}
          value={winnerDeclarationFor(prefs)}
          onChange={(e) => {
            const mode = e.target.value as WinnerDeclaration;
            // allowLowPointWins is kept in step for older clients and saved data.
            onChange({ winnersInBallots: mode, allowLowPointWins: mode === "low-points" });
          }}
        >
          {WINNER_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
        </Select>
      </div>

      <div className={box}>
        <Select
          label={t("results.rules.speakers.label")}
          help={shapeLocked ? lockedNote : t("results.rules.speakers.help")}
          value={speakersInBallotsFor(prefs)}
          disabled={shapeLocked}
          onChange={(e) => onChange({ speakersInBallots: e.target.value as SpeakersInBallots })}
        >
          {SPEAKERS_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
        </Select>
      </div>

      <div className={box}>
        <Select
          label={t("results.rules.ranks.label")}
          help={t("results.rules.ranks.help")}
          value={speakerRanksFor(prefs)}
          onChange={(e) => onChange({ speakerRanks: e.target.value as SpeakerRanksMode })}
        >
          {RANK_OPTIONS.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
        </Select>
      </div>

      {twoTeam && (
        <div className={box}>
          <Select
            label={t("results.rules.aggregation.label")}
            help={t("results.rules.aggregation.help")}
            value={scoreAggregationFor(prefs)}
            onChange={(e) => onChange({ scoreAggregation: e.target.value as ScoreAggregation })}
          >
            <option value="mean">{t("results.rules.aggregation.mean")}</option>
            <option value="median">{t("results.rules.aggregation.median")}</option>
          </Select>
        </div>
      )}

      {twoTeam && (
        <div className={box}>
          <Input
            label={t("results.rules.maxMargin.label")}
            help={t("results.rules.maxMargin.help")}
            type="number"
            min={0}
            step="any"
            value={maximumMarginFor(prefs) || 0}
            onChange={(e) => onChange({ maximumMargin: Math.max(0, Number(e.target.value) || 0) })}
            className="font-mono"
          />
        </div>
      )}

      {twoTeam && prefs.replyScoresEnabled && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={box}>
            <Input
              label={t("results.rules.replyStep.label")}
              help={t("results.rules.replyStep.help")}
              type="number"
              min={0.01}
              step="any"
              value={replyScoreStep(prefs)}
              onChange={(e) => {
                const value = Number(e.target.value);
                onChange({ stepReplyScore: Number.isFinite(value) && value > 0 ? value : undefined });
              }}
              className="font-mono"
            />
          </div>
          <div className={box}>
            <Checkbox
              label={t("results.rules.replySubstantive.label")}
              description={t("results.rules.replySubstantive.help")}
              checked={requireSubstantiveForReply(prefs)}
              onChange={(e) => onChange({ requireSubstantiveForReply: e.target.checked })}
            />
          </div>
        </div>
      )}

      {twoTeam && (
        <div className={box}>
          <Select
            label={t("results.rules.sideNames.label")}
            help={t("results.rules.sideNames.help")}
            value={sideNamesFor(prefs)}
            onChange={(e) => onChange({ sideNames: e.target.value as SideNames })}
          >
            {SIDE_NAME_OPTIONS.map((value) => <option key={value} value={value}>{SIDE_NAME_SETS[value].label}</option>)}
          </Select>
        </div>
      )}

      <div className={box}>
        <Checkbox
          label={t("results.rules.motions.label")}
          description={t("results.rules.motions.help")}
          checked={motionsEnabled(prefs)}
          onChange={(e) => onChange({ enableMotions: e.target.checked })}
        />
      </div>

      <fieldset className={`${box} space-y-3`} disabled={shapeLocked}>
        <legend className="px-1 text-xs font-medium text-fg">{t("results.rules.criteria.legend")}</legend>
        <p className="text-xs text-fg-muted">{shapeLocked ? lockedNote : t("results.rules.criteria.help")}</p>
        {criteria.length > 0 && (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>{t("results.rules.criteria.name")}</TH>
                  <TH>{t("results.rules.criteria.speeches")}</TH>
                  <TH>{t("results.rules.criteria.weight")}</TH>
                  <TH>{t("results.rules.criteria.min")}</TH>
                  <TH>{t("results.rules.criteria.max")}</TH>
                  <TH>{t("results.rules.criteria.step")}</TH>
                  <TH align="center">{t("results.rules.criteria.required")}</TH>
                  <TH><span className="sr-only">{t("results.rules.criteria.remove")}</span></TH>
                </TR>
              </THead>
              <TBody>
                {criteria.map((criterion) => {
                  const name = criterion.name || t("results.rules.criteria.unnamed");
                  const number = (field: NumberField) => (
                    <Input
                      type="number"
                      step="any"
                      aria-label={t(NUMBER_FIELD_LABELS[field], { name })}
                      value={Number.isFinite(criterion[field]) ? criterion[field] : ""}
                      onChange={(e) => updateCriterion(criterion.id, { [field]: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
                      className="h-7 w-16 px-1.5 font-mono text-xs"
                    />
                  );
                  return (
                    <TR key={criterion.id}>
                      <TD>
                        <Input
                          aria-label={t("results.rules.criteria.nameLabel")}
                          value={criterion.name}
                          maxLength={20}
                          onChange={(e) => updateCriterion(criterion.id, { name: e.target.value })}
                          className="h-7 w-28 px-1.5 text-xs"
                        />
                      </TD>
                      <TD>
                        <Select
                          aria-label={t("results.rules.criteria.speechesLabel", { name })}
                          value={criterion.speechType}
                          onChange={(e) => updateCriterion(criterion.id, { speechType: e.target.value as ScoreCriterionSpeechType })}
                          className="h-7 w-auto text-xs"
                        >
                          {SPEECH_TYPES.map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
                        </Select>
                      </TD>
                      <TD>{number("weight")}</TD>
                      <TD>{number("minScore")}</TD>
                      <TD>{number("maxScore")}</TD>
                      <TD>{number("step")}</TD>
                      <TD align="center">
                        <input
                          type="checkbox"
                          aria-label={t("results.rules.criteria.requiredLabel", { name })}
                          checked={criterion.required}
                          onChange={(e) => updateCriterion(criterion.id, { required: e.target.checked })}
                          className="h-4 w-4 cursor-pointer accent-[rgb(var(--color-accent))]"
                        />
                      </TD>
                      <TD>
                        <IconButton
                          size="sm"
                          label={t("results.rules.criteria.removeLabel", { name })}
                          icon={<Trash2 aria-hidden="true" />}
                          onClick={() => setCriteria(criteria.filter((item) => item.id !== criterion.id))}
                          className="text-danger hover:text-danger"
                        />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableContainer>
        )}
        {criteriaErrors.length > 0 && (
          <ul role="alert" className="list-disc space-y-0.5 ps-5 text-xs text-danger">
            {criteriaErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setCriteria([
              ...criteria,
              {
                id: `criterion-${Date.now().toString(36)}`,
                name: "",
                seq: criteria.length + 1,
                speechType: "all",
                weight: 1,
                minScore: prefs.minSpeakerScore ?? 0,
                maxScore: prefs.maxSpeakerScore ?? 100,
                step: prefs.stepSpeakerScore ?? 1,
                required: true,
              },
            ])
          }
        >
          <Plus aria-hidden="true" />
          {t("results.rules.criteria.add")}
        </Button>
      </fieldset>
    </div>
  );
}
