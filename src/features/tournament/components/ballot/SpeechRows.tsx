"use client";

import React from "react";
import type { Speaker, SpeakerScoreEntry } from "@/types";
import {
  isReplyEntry,
  markGhostSpeeches,
  substantiveSpeakerCount,
  teamSpeakerTotal,
  type BallotRules,
} from "@/lib/ballots/result";

interface SpeechRowsProps {
  idPrefix: string;
  roster: Speaker[];
  entries: SpeakerScoreEntry[];
  rules: BallotRules;
  onChange: (entries: SpeakerScoreEntry[]) => void;
  /** Voting sheets after the first share its speaker order, so only scores are editable. */
  lockSpeakers?: boolean;
  readOnly?: boolean;
}

function scoreBounds(rules: BallotRules, reply: boolean) {
  const preferences = rules.preferences || {};
  const step = preferences.stepSpeakerScore ?? 1;
  return reply
    ? { min: preferences.minReplyScore ?? 34, max: preferences.maxReplyScore ?? 42, step: step / 2 }
    : { min: preferences.minSpeakerScore ?? 68, max: preferences.maxSpeakerScore ?? 84, step };
}

/**
 * One team's speeches on one scoresheet: who spoke in each position (iron-person speeches are
 * allowed and flagged as ghosts), each score, and the reply.
 */
export function SpeechRows({ idPrefix, roster, entries, rules, onChange, lockSpeakers, readOnly }: SpeechRowsProps) {
  const substantive = substantiveSpeakerCount(rules);
  const speeches = entries.filter((entry) => !isReplyEntry(entry, rules));
  const reply = entries.find((entry) => isReplyEntry(entry, rules));
  const marked = markGhostSpeeches(entries, rules);

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

  const replyCandidates = speeches
    .filter((entry) => entry.position < substantive && entry.speakerId)
    .map((entry) => roster.find((speaker) => speaker.id === entry.speakerId))
    .filter((speaker, index, all): speaker is Speaker => Boolean(speaker) && all.indexOf(speaker) === index);

  const scoreInput = (entry: SpeakerScoreEntry, isReply: boolean, label: string) => {
    const bounds = scoreBounds(rules, isReply);
    return (
      <input
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
        className="w-20 rounded border border-gray-300 px-2 py-1 text-center font-mono text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
      />
    );
  };

  return (
    <div className="space-y-2">
      {speeches.map((entry) => {
        const isGhost = Boolean(marked.find((candidate) => candidate.position === entry.position)?.ghost);
        const isDuplicate = speeches.filter((candidate) => candidate.speakerId === entry.speakerId).length > 1;
        return (
          <div key={entry.position} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white p-2">
            <span className="w-16 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Speaker {entry.position}
            </span>
            <select
              aria-label={`Speaker in position ${entry.position}`}
              value={entry.speakerId}
              disabled={readOnly || lockSpeakers}
              onChange={(event) => chooseSpeaker(entry.position, event.target.value)}
              className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-semibold disabled:bg-gray-100"
            >
              <option value="">— Choose speaker —</option>
              {roster.map((speaker) => (
                <option key={speaker.id} value={speaker.id}>{speaker.name}</option>
              ))}
            </select>
            {isDuplicate && (
              <button
                type="button"
                disabled={readOnly || lockSpeakers}
                onClick={() => toggleGhost(entry.position)}
                title="Iron-person speech: ghost speeches do not count in the speaker tab"
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  isGhost ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-600"
                }`}
              >
                {isGhost ? "Ghost" : "Counted"}
              </button>
            )}
            {scoreInput(entry, false, `Score for speaker ${entry.position}`)}
          </div>
        );
      })}
      {reply && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-indigo-200 bg-indigo-50/60 p-2">
          <span className="w-16 text-[10px] font-bold uppercase tracking-wider text-indigo-700">Reply</span>
          <select
            aria-label="Reply speaker"
            value={reply.speakerId}
            disabled={readOnly || lockSpeakers}
            onChange={(event) => {
              const speaker = roster.find((candidate) => candidate.id === event.target.value);
              update(reply.position, { speakerId: event.target.value, speakerName: speaker?.name || "" });
            }}
            className="min-w-0 flex-1 rounded border border-indigo-200 bg-white px-2 py-1 text-xs font-semibold disabled:bg-gray-100"
          >
            <option value="">— Choose reply speaker —</option>
            {replyCandidates.map((speaker) => (
              <option key={speaker.id} value={speaker.id}>{speaker.name}</option>
            ))}
          </select>
          {scoreInput(reply, true, "Reply score")}
        </div>
      )}
      <div className="text-right text-xs font-semibold text-gray-700">
        Team total: <span className="font-mono font-bold text-gray-900">{teamSpeakerTotal(marked.filter((entry) => Number.isFinite(entry.score)), rules)}</span>
      </div>
    </div>
  );
}
