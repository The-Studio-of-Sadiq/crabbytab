"use client";

import React from "react";
import type { Speaker, SpeakerScoreEntry } from "@/types";
import {
  applyScoreCriteria,
  isReplyEntry,
  markGhostSpeeches,
  substantiveSpeakerCount,
  teamSpeakerTotal,
  type BallotRules,
} from "@/lib/ballots/result";
import {
  criteriaForSpeech,
  replyScoreStep,
  requireSubstantiveForReply,
  scoreCriteriaFor,
} from "@/lib/ballots/ballotRules";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useFormatScore } from "@/features/tournament/components/results/useFormatScore";
import { Input, Select } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

interface SpeechRowsProps {
  idPrefix: string;
  roster: Speaker[];
  entries: SpeakerScoreEntry[];
  rules: BallotRules;
  onChange: (entries: SpeakerScoreEntry[]) => void;
  /** Voting sheets after the first share its speaker order, so only scores are editable. */
  lockSpeakers?: boolean;
  readOnly?: boolean;
  /** Speech ranks are entered (consensus ballots with speakerRanks); ranks run from 1 to this. */
  rankCount?: number;
  /**
   * Id of the ballot's error summary, passed while validation errors are shown. Inputs that are
   * empty or outside their allowed range are then marked invalid and described by that summary.
   * This is an accessibility hint only; the ballot validator decides what is valid.
   */
  errorId?: string;
}

function scoreBounds(rules: BallotRules, reply: boolean) {
  const preferences = rules.preferences || {};
  const step = preferences.stepSpeakerScore ?? 1;
  return reply
    ? { min: preferences.minReplyScore ?? 34, max: preferences.maxReplyScore ?? 42, step: replyScoreStep(preferences) }
    : { min: preferences.minSpeakerScore ?? 68, max: preferences.maxSpeakerScore ?? 84, step };
}

function outOfRange(value: number | undefined, min: number | undefined, max: number | undefined): boolean {
  if (value === undefined || !Number.isFinite(value)) return true;
  return (min !== undefined && value < min) || (max !== undefined && value > max);
}

const numberInput = "h-7 text-center font-mono text-xs font-semibold";

/**
 * One team's speeches on one scoresheet: who spoke in each position (iron-person speeches are
 * allowed and flagged as ghosts), each score, and the reply.
 */
export function SpeechRows({ idPrefix, roster, entries, rules, onChange, lockSpeakers, readOnly, rankCount, errorId }: SpeechRowsProps) {
  const { t } = useI18n();
  const formatScore = useFormatScore();
  const criteria = scoreCriteriaFor(rules.preferences);
  const substantive = substantiveSpeakerCount(rules);
  const speeches = entries.filter((entry) => !isReplyEntry(entry, rules));
  const reply = entries.find((entry) => isReplyEntry(entry, rules));
  const marked = markGhostSpeeches(entries, rules);

  // Marks a control invalid (and points it at the error summary) while errors are shown.
  const invalidProps = (invalid: boolean) =>
    errorId && invalid ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};

  const update = (position: number, patch: Partial<SpeakerScoreEntry>) => {
    const next = entries.map((entry) => (entry.position === position ? { ...entry, ...patch } : entry));
    onChange(markGhostSpeeches(next, rules));
  };
  const chooseSpeaker = (position: number, speakerId: string) => {
    const speaker = roster.find((candidate) => candidate.id === speakerId);
    update(position, { speakerId, speakerName: speaker?.name || "", ghost: false });
  };
  const toggleGhost = (position: number) => {
    const entry = entries.find((candidate) => candidate.position === position);
    if (!entry) return;
    // Make this speech the counted one; markGhostSpeeches flags the other duplicates.
    const next = entries.map((candidate) =>
      candidate.speakerId === entry.speakerId && !isReplyEntry(candidate, rules)
        ? { ...candidate, ghost: candidate.position !== position }
        : candidate
    );
    onChange(markGhostSpeeches(next, rules));
  };

  // The last substantive speaker never replies; unless the tournament lets anyone on the team
  // reply, the reply speaker must have given a counted substantive speech (Tabbycat).
  const lastSpeakerId = speeches.find((entry) => entry.position === substantive)?.speakerId;
  const replyCandidates = requireSubstantiveForReply(rules.preferences)
    ? speeches
        .filter((entry) => entry.position < substantive && entry.speakerId && entry.speakerId !== lastSpeakerId && !entry.ghost)
        .map((entry) => roster.find((speaker) => speaker.id === entry.speakerId))
        .filter((speaker, index, all): speaker is Speaker => Boolean(speaker) && all.indexOf(speaker) === index)
    : roster.filter((speaker) => speaker.id !== lastSpeakerId);

  const criteriaInputs = (entry: SpeakerScoreEntry, isReply: boolean, label: string) => (
    <span className="flex flex-wrap items-center gap-2">
      {criteriaForSpeech(criteria, isReply).map((criterion) => {
        const value = entry.criteria?.[criterion.id];
        return (
          <span key={criterion.id} className="flex items-center gap-1 text-[11px] font-medium text-fg-muted">
            <span aria-hidden="true">
              {criterion.name}
              {criterion.weight !== 1 && <span className="text-fg-subtle"> ×{criterion.weight}</span>}
            </span>
            <Input
              id={`${idPrefix}-${entry.position}-${criterion.id}`}
              type="number"
              inputMode="decimal"
              aria-label={t(
                criterion.required ? "results.ballot.speech.criterionLabel" : "results.ballot.speech.criterionLabelOptional",
                { speech: label, criterion: criterion.name }
              )}
              min={criterion.minScore}
              max={criterion.maxScore}
              step={criterion.step}
              value={Number.isFinite(value) ? value : ""}
              disabled={readOnly}
              onChange={(event) => {
                const nextCriteria = { ...(entry.criteria || {}) };
                if (event.target.value === "") delete nextCriteria[criterion.id];
                else nextCriteria[criterion.id] = Number(event.target.value);
                const [scored] = applyScoreCriteria([{ ...entry, criteria: nextCriteria }], rules);
                update(entry.position, { criteria: nextCriteria, score: scored.score });
              }}
              className={cn(numberInput, "w-14 px-1")}
              {...invalidProps(
                criterion.required
                  ? outOfRange(value, criterion.minScore, criterion.maxScore)
                  : value !== undefined && outOfRange(value, criterion.minScore, criterion.maxScore)
              )}
            />
          </span>
        );
      })}
      <span className="font-mono text-xs font-semibold text-fg">
        <span className="sr-only">{t("results.ballot.speech.criteriaTotal", { speech: label })} </span>
        <span aria-hidden="true">= </span>
        {formatScore(entry.score)}
      </span>
    </span>
  );

  const rankInput = (entry: SpeakerScoreEntry) => (
    <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
      <span aria-hidden="true">{t("results.ballot.speech.rank")}</span>
      <Input
        id={`${idPrefix}-${entry.position}-rank`}
        type="number"
        inputMode="numeric"
        aria-label={t("results.ballot.speech.rankLabel", { position: entry.position })}
        min={1}
        max={rankCount}
        step={1}
        value={entry.rank ?? ""}
        disabled={readOnly}
        onChange={(event) => update(entry.position, { rank: event.target.value === "" ? undefined : Number(event.target.value) })}
        className={cn(numberInput, "w-12 px-1")}
        {...invalidProps(outOfRange(entry.rank, 1, rankCount))}
      />
    </span>
  );

  const scoreInput = (entry: SpeakerScoreEntry, isReply: boolean, label: string) => {
    if (criteriaForSpeech(criteria, isReply).length > 0) return criteriaInputs(entry, isReply, label);
    const bounds = scoreBounds(rules, isReply);
    return (
      <Input
        id={`${idPrefix}-${entry.position}-score`}
        type="number"
        inputMode="decimal"
        aria-label={label}
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={Number.isFinite(entry.score) ? entry.score : ""}
        disabled={readOnly}
        onChange={(event) =>
          update(entry.position, { score: event.target.value === "" ? Number.NaN : Number(event.target.value) })
        }
        className={cn(numberInput, "w-20 px-2")}
        {...invalidProps(outOfRange(entry.score, bounds.min, bounds.max))}
      />
    );
  };

  const speechLabel = (entry: SpeakerScoreEntry) =>
    entry.speakerName
      ? t("results.ballot.speech.scoreLabelNamed", { position: entry.position, name: entry.speakerName })
      : t("results.ballot.speech.scoreLabel", { position: entry.position });

  return (
    <div className="space-y-2">
      {speeches.map((entry) => {
        const isGhost = Boolean(marked.find((candidate) => candidate.position === entry.position)?.ghost);
        const isDuplicate = speeches.filter((candidate) => candidate.speakerId === entry.speakerId).length > 1;
        return (
          <div key={entry.position} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2">
            <span className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wide text-fg-muted" aria-hidden="true">
              {t("results.ballot.speech.position", { position: entry.position })}
            </span>
            <Select
              aria-label={t("results.ballot.speech.speakerLabel", { position: entry.position })}
              value={entry.speakerId}
              disabled={readOnly || lockSpeakers}
              onChange={(event) => chooseSpeaker(entry.position, event.target.value)}
              className="h-7 min-w-[8rem] flex-1 text-xs"
              {...invalidProps(!entry.speakerId)}
            >
              <option value="">{t("results.ballot.speech.chooseSpeaker")}</option>
              {roster.map((speaker) => (
                <option key={speaker.id} value={speaker.id}>{speaker.name}</option>
              ))}
            </Select>
            {isDuplicate && (
              <button
                type="button"
                disabled={readOnly || lockSpeakers}
                onClick={() => toggleGhost(entry.position)}
                title={t("results.ballot.speech.ghostHelp")}
                aria-label={t(isGhost ? "results.ballot.speech.ghostButton" : "results.ballot.speech.countedButton", {
                  position: entry.position,
                })}
                className={cn(
                  "inline-flex h-6 items-center rounded-sm border px-1.5 text-[11px] font-medium uppercase disabled:opacity-50",
                  isGhost ? "border-warning-border bg-warning-subtle text-warning" : "border-border bg-muted text-fg-muted",
                  focusRing
                )}
              >
                {isGhost ? t("results.ballot.speech.ghost") : t("results.ballot.speech.counted")}
              </button>
            )}
            {scoreInput(entry, false, speechLabel(entry))}
            {rankCount ? rankInput(entry) : null}
          </div>
        );
      })}
      {reply && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/30 bg-accent-subtle p-2">
          <span className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wide text-accent-text" aria-hidden="true">
            {t("results.ballot.speech.reply")}
          </span>
          <Select
            aria-label={t("results.ballot.speech.replySpeakerLabel")}
            value={reply.speakerId}
            disabled={readOnly || lockSpeakers}
            onChange={(event) => {
              const speaker = roster.find((candidate) => candidate.id === event.target.value);
              update(reply.position, { speakerId: event.target.value, speakerName: speaker?.name || "" });
            }}
            className="h-7 min-w-[8rem] flex-1 text-xs"
          >
            <option value="">{t("results.ballot.speech.chooseReplySpeaker")}</option>
            {replyCandidates.map((speaker) => (
              <option key={speaker.id} value={speaker.id}>{speaker.name}</option>
            ))}
          </Select>
          {scoreInput(reply, true, t("results.ballot.speech.replyScoreLabel"))}
        </div>
      )}
      <p className="text-end text-xs font-medium text-fg-muted">
        {t("results.ballot.speech.teamTotal")}{" "}
        <span className="font-mono font-semibold text-fg">
          {formatScore(teamSpeakerTotal(marked.filter((entry) => Number.isFinite(entry.score)), rules))}
        </span>
      </p>
    </div>
  );
}
