"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import type { Tournament, TournamentFormat, TournamentPreferences } from "@/types";
import {
  BreakDraft,
  FORMAT_PRESETS,
  PrelimDrawRule,
  SCORE_DEFAULTS,
  buildBreakCategories,
  buildRounds,
  eliminationRoundCount,
  getFormatPreset,
  isPowerOfTwo,
  slugify,
  validateSlug,
} from "@/lib/setup/presets";

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

interface WizardState {
  name: string;
  shortName: string;
  slug: string;
  slugTouched: boolean;
  format: TournamentFormat;
  substantiveSpeakers: number;
  replyScoresEnabled: boolean;
  minSpeakerScore: number;
  maxSpeakerScore: number;
  stepSpeakerScore: number;
  minReplyScore: number;
  maxReplyScore: number;
  prelimRounds: number;
  drawRule: PrelimDrawRule;
  sideAllocationRule: TournamentPreferences["sideAllocationRule"];
  breaks: BreakDraft[];
  ballotDoubleEntry: boolean;
  publicDraw: boolean;
  publicResults: boolean;
  publicStandings: boolean;
  publicMotions: boolean;
  feedbackEnabled: boolean;
  feedbackMinScore: number;
  feedbackMaxScore: number;
}

let breakKeyCounter = 0;
const newBreakKey = () => `brk-${++breakKeyCounter}`;

function initialState(): WizardState {
  const preset = getFormatPreset("bp");
  return {
    name: "",
    shortName: "",
    slug: "",
    slugTouched: false,
    format: "bp",
    substantiveSpeakers: preset.substantiveSpeakers,
    replyScoresEnabled: preset.replyScoresEnabled,
    ...SCORE_DEFAULTS,
    prelimRounds: 5,
    drawRule: "power_paired",
    sideAllocationRule: "balanced",
    breaks: [{ key: newBreakKey(), name: "Open", breakSize: 8, reserveSize: 2, isGeneral: true }],
    ballotDoubleEntry: false,
    publicDraw: true,
    publicResults: true,
    publicStandings: true,
    publicMotions: true,
    feedbackEnabled: true,
    feedbackMinScore: 1,
    feedbackMaxScore: 10,
  };
}

const STEPS = [
  "Basics",
  "Format",
  "Scoring",
  "Rounds",
  "Breaks",
  "Public & feedback",
  "Review",
] as const;

const BREAK_SIZE_OPTIONS = [2, 4, 8, 16, 32, 64];

/* -------------------------------------------------------------------------- */
/* Small UI helpers                                                           */
/* -------------------------------------------------------------------------- */

const inputCls =
  "w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      className={inputCls}
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
    />
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start space-x-3 cursor-pointer">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Wizard                                                                     */
/* -------------------------------------------------------------------------- */

export function TournamentWizard() {
  const router = useRouter();

  const [s, setS] = useState<WizardState>(initialState);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));

  const preset = getFormatPreset(s.format);
  const teamsInDebate = preset.teamsInDebate;

  const maxBreakSize = useMemo(
    () => s.breaks.reduce((m, b) => Math.max(m, b.breakSize), 0),
    [s.breaks]
  );

  const previewRounds = useMemo(
    () =>
      buildRounds({
        tournamentId: "preview",
        prelimRounds: Number.isInteger(s.prelimRounds) && s.prelimRounds > 0 ? s.prelimRounds : 0,
        maxBreakSize,
        teamsInDebate,
        drawRule: s.drawRule,
      }),
    [s.prelimRounds, maxBreakSize, teamsInDebate, s.drawRule]
  );

  /* ------------------------------ handlers ------------------------------ */

  const handleNameChange = (name: string) => {
    patch({
      name,
      slug: s.slugTouched ? s.slug : slugify(name),
    });
  };

  const handleFormatChange = (format: TournamentFormat) => {
    const p = getFormatPreset(format);
    // Clamp existing break sizes to what the new format can run.
    const breaks = s.breaks.map((b) =>
      b.breakSize < p.teamsInDebate ? { ...b, breakSize: p.teamsInDebate } : b
    );
    patch({
      format,
      substantiveSpeakers: p.substantiveSpeakers,
      replyScoresEnabled: p.replyScoresEnabled,
      breaks,
    });
  };

  const updateBreak = (key: string, p: Partial<BreakDraft>) =>
    patch({ breaks: s.breaks.map((b) => (b.key === key ? { ...b, ...p } : b)) });

  const addBreak = () =>
    patch({
      breaks: [
        ...s.breaks,
        {
          key: newBreakKey(),
          name: "",
          breakSize: Math.max(4, teamsInDebate),
          reserveSize: 1,
          isGeneral: false,
        },
      ],
    });

  const removeBreak = (key: string) =>
    patch({ breaks: s.breaks.filter((b) => b.key !== key) });

  /* ----------------------------- validation ----------------------------- */

  /** Returns "" when the step is valid. `slugAvailable` is checked separately. */
  const validateStep = (index: number): string => {
    switch (index) {
      case 0: {
        if (s.name.trim().length < 3) return "Give the tournament a name (at least 3 characters).";
        return validateSlug(s.slug);
      }
      case 2: {
        if (!Number.isInteger(s.substantiveSpeakers) || s.substantiveSpeakers < 1 || s.substantiveSpeakers > 6)
          return "Speakers per team must be a whole number from 1 to 6.";
        if (!(s.stepSpeakerScore > 0)) return "The score step must be greater than 0.";
        if (!(s.minSpeakerScore < s.maxSpeakerScore))
          return "The minimum speaker score must be lower than the maximum.";
        if (s.stepSpeakerScore > s.maxSpeakerScore - s.minSpeakerScore)
          return "The score step can't be larger than the score range.";
        if (s.replyScoresEnabled && !(s.minReplyScore < s.maxReplyScore))
          return "The minimum reply score must be lower than the maximum.";
        return "";
      }
      case 3: {
        if (!Number.isInteger(s.prelimRounds) || s.prelimRounds < 1 || s.prelimRounds > 20)
          return "Preliminary rounds must be a whole number from 1 to 20.";
        return "";
      }
      case 4: {
        const names = new Set<string>();
        for (const b of s.breaks) {
          const n = b.name.trim().toLowerCase();
          if (!n) return "Every break category needs a name.";
          if (names.has(n)) return `There are two break categories called "${b.name.trim()}".`;
          names.add(n);
          if (!isPowerOfTwo(b.breakSize) || b.breakSize < teamsInDebate)
            return `Break size for "${b.name.trim()}" must be a power of two and at least ${teamsInDebate}.`;
          if (!Number.isInteger(b.reserveSize) || b.reserveSize < 0)
            return `Reserve size for "${b.name.trim()}" must be 0 or more.`;
        }
        return "";
      }
      case 5: {
        if (s.feedbackEnabled && !(s.feedbackMinScore < s.feedbackMaxScore))
          return "The minimum feedback score must be lower than the maximum.";
        return "";
      }
      default:
        return "";
    }
  };

  const checkSlugAvailable = async (): Promise<string> => {
    // Local-only copies would be silently overwritten, so block those too.
    try {
      if (localStorage.getItem(`crabbytab_t_${s.slug}_meta`)) {
        return `"${s.slug}" already exists on this device. Choose a different slug.`;
      }
    } catch {
      // localStorage unavailable: nothing to check
    }
    return "";
  };

  /* ----------------------------- navigation ----------------------------- */

  const goNext = async () => {
    setError("");
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    if (step === 0) {
      setBusy(true);
      const taken = await checkSlugAvailable();
      setBusy(false);
      if (taken) {
        setError(taken);
        return;
      }
    }
    setStep((n) => Math.min(n + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setError("");
    setStep((n) => Math.max(n - 1, 0));
  };

  /* ------------------------------- create ------------------------------- */

  const handleCreate = async () => {
    setError("");

    // Re-validate every step so a skipped-over problem can't slip through.
    for (const i of [0, 2, 3, 4, 5]) {
      const problem = validateStep(i);
      if (problem) {
        setStep(i);
        setError(problem);
        return;
      }
    }

    setBusy(true);
    const id = `tourn-${s.slug}`;
    const now = new Date().toISOString();

    const ownerId = "director";

    const tournament: Tournament = {
      id,
      name: s.name.trim(),
      nameLower: s.name.trim().toLowerCase(),
      shortName: (s.shortName.trim() || s.name.trim()).slice(0, 15),
      slug: s.slug,
      format: s.format,
      active: true,
      ownerId,
      admins: { [ownerId]: true },
      preferences: {
        teamsInDebate,
        substantiveSpeakers: s.substantiveSpeakers,
        replyScoresEnabled: s.replyScoresEnabled,
        minSpeakerScore: s.minSpeakerScore,
        maxSpeakerScore: s.maxSpeakerScore,
        stepSpeakerScore: s.stepSpeakerScore,
        minReplyScore: s.minReplyScore,
        maxReplyScore: s.maxReplyScore,
        drawRule: s.drawRule,
        sideAllocationRule: s.sideAllocationRule,
        ballotDoubleEntry: s.ballotDoubleEntry,
        publicDraw: s.publicDraw,
        publicResults: s.publicResults,
        publicStandings: s.publicStandings,
        publicMotions: s.publicMotions,
        feedbackEnabled: s.feedbackEnabled,
        feedbackMinScore: s.feedbackMinScore,
        feedbackMaxScore: s.feedbackMaxScore,
      },
      createdAt: now,
      updatedAt: now,
    };

    const rounds = buildRounds({
      tournamentId: id,
      prelimRounds: s.prelimRounds,
      maxBreakSize,
      teamsInDebate,
      drawRule: s.drawRule,
    });
    const breakCategories = buildBreakCategories(id, s.breaks);

    try {
      // The device is the source of truth until the director explicitly uploads.
      const prefix = `crabbytab_t_${s.slug}`;
      localStorage.setItem(`${prefix}_meta`, JSON.stringify(tournament));
      localStorage.setItem(`${prefix}_rounds`, JSON.stringify(rounds));
      localStorage.setItem(`${prefix}_breaks`, JSON.stringify(breakCategories));

      router.push(`/${s.slug}`);
    } catch (e: unknown) {
      console.error("Error creating tournament:", e);
      setError(e instanceof Error ? e.message : "Failed to create the tournament. Please try again.");
      setBusy(false);
    }
  };

  /* ------------------------------- render ------------------------------- */

  const isLast = step === STEPS.length - 1;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Create a tournament</h1>
      <p className="text-sm text-gray-600 mt-1 mb-6">
        Answer a few questions and CrabbyTab will set up the rounds and break categories for you.
      </p>

      {/* Stepper */}
      <ol className="flex flex-wrap gap-2 mb-6">
        {STEPS.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li
              key={label}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
                current
                  ? "bg-blue-600 text-white border-blue-600"
                  : done
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-white text-gray-500 border-[#d0d7de]"
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                  current ? "bg-white/25" : done ? "bg-emerald-200" : "bg-gray-100"
                }`}
              >
                {done ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>

      <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs p-6 space-y-5">
        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2.5">
            {error}
          </div>
        )}

        {/* Step 0 - Basics */}
        {step === 0 && (
          <>
            <Field label="Tournament name">
              <input
                type="text"
                className={inputCls}
                placeholder="e.g. Australasian Debating Championship 2026"
                value={s.name}
                onChange={(e) => handleNameChange(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Short name" hint="Shown in tight spaces. Up to 15 characters. Optional.">
              <input
                type="text"
                className={inputCls}
                maxLength={15}
                placeholder="e.g. Australs 26"
                value={s.shortName}
                onChange={(e) => patch({ shortName: e.target.value })}
              />
            </Field>
            <Field
              label="URL slug"
              hint="Participants will visit this address to see the draw and results. It can't be changed later."
            >
              <div className="flex items-center">
                <span className="bg-gray-100 border border-r-0 border-gray-300 rounded-l px-3 py-2 text-xs text-gray-500 font-mono">
                  /
                </span>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-r px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="australs2026"
                  value={s.slug}
                  onChange={(e) =>
                    patch({
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40),
                      slugTouched: true,
                    })
                  }
                />
              </div>
            </Field>
          </>
        )}

        {/* Step 1 - Format */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Pick the debating format. This sets sensible defaults for the next steps, which you can still change.
            </p>
            {FORMAT_PRESETS.map((f) => (
              <label
                key={f.id}
                className={`flex items-start space-x-3 p-3 border rounded cursor-pointer ${
                  s.format === f.id ? "border-blue-500 bg-blue-50" : "border-[#d0d7de] hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="format"
                  className="mt-1"
                  checked={s.format === f.id}
                  onChange={() => handleFormatChange(f.id)}
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-900">{f.label}</span>
                  <span className="block text-xs text-gray-600">{f.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {/* Step 2 - Scoring */}
        {step === 2 && (
          <>
            <Field label="Substantive speakers per team">
              <NumberInput
                value={s.substantiveSpeakers}
                onChange={(n) => patch({ substantiveSpeakers: n })}
                min={1}
                max={6}
              />
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Minimum speaker score">
                <NumberInput value={s.minSpeakerScore} onChange={(n) => patch({ minSpeakerScore: n })} />
              </Field>
              <Field label="Maximum speaker score">
                <NumberInput value={s.maxSpeakerScore} onChange={(n) => patch({ maxSpeakerScore: n })} />
              </Field>
              <Field label="Score step" hint="e.g. 1 or 0.5">
                <NumberInput value={s.stepSpeakerScore} onChange={(n) => patch({ stepSpeakerScore: n })} step={0.5} />
              </Field>
            </div>
            <Toggle
              checked={s.replyScoresEnabled}
              onChange={(v) => patch({ replyScoresEnabled: v })}
              label="Reply speeches are scored"
              hint="Used by Asian Parliamentary, Australs and World Schools."
            />
            {s.replyScoresEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Minimum reply score">
                  <NumberInput value={s.minReplyScore} onChange={(n) => patch({ minReplyScore: n })} />
                </Field>
                <Field label="Maximum reply score">
                  <NumberInput value={s.maxReplyScore} onChange={(n) => patch({ maxReplyScore: n })} />
                </Field>
              </div>
            )}
          </>
        )}

        {/* Step 3 - Rounds */}
        {step === 3 && (
          <>
            <Field label="Number of preliminary rounds">
              <NumberInput value={s.prelimRounds} onChange={(n) => patch({ prelimRounds: n })} min={1} max={20} />
            </Field>
            <Field
              label="Draw method"
              hint="With power pairing, Round 1 is random (there are no standings yet) and later rounds pair teams by standing."
            >
              <select
                className={inputCls}
                value={s.drawRule}
                onChange={(e) => patch({ drawRule: e.target.value as PrelimDrawRule })}
              >
                <option value="power_paired">Power-paired (Swiss)</option>
                <option value="random">Random</option>
                <option value="round_robin">Round robin</option>
              </select>
            </Field>
            <Field label="Side allocation">
              <select
                className={inputCls}
                value={s.sideAllocationRule}
                onChange={(e) =>
                  patch({ sideAllocationRule: e.target.value as TournamentPreferences["sideAllocationRule"] })
                }
              >
                <option value="balanced">Balanced (equalise sides over the tournament)</option>
                <option value="random">Random</option>
              </select>
            </Field>
            <Toggle
              checked={s.ballotDoubleEntry}
              onChange={(v) => patch({ ballotDoubleEntry: v })}
              label="Require double entry of ballots"
              hint="Two people enter each result and they must match before it is confirmed."
            />
          </>
        )}

        {/* Step 4 - Breaks */}
        {step === 4 && (
          <>
            <p className="text-sm text-gray-700">
              Break categories decide who advances to elimination rounds. Elimination rounds are created
              automatically from the largest break size.
            </p>
            <div className="space-y-3">
              {s.breaks.map((b) => (
                <div key={b.key} className="border border-[#d0d7de] rounded p-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Name">
                      <input
                        type="text"
                        className={inputCls}
                        placeholder="e.g. Open, ESL, Novice"
                        value={b.name}
                        onChange={(e) => updateBreak(b.key, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Teams that break">
                      <select
                        className={inputCls}
                        value={b.breakSize}
                        onChange={(e) => updateBreak(b.key, { breakSize: Number(e.target.value) })}
                      >
                        {BREAK_SIZE_OPTIONS.filter((n) => n >= teamsInDebate).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Reserve size">
                      <NumberInput
                        value={b.reserveSize}
                        onChange={(n) => updateBreak(b.key, { reserveSize: n })}
                        min={0}
                      />
                    </Field>
                  </div>
                  <div className="flex items-center justify-between">
                    <Toggle
                      checked={b.isGeneral}
                      onChange={(v) => updateBreak(b.key, { isGeneral: v })}
                      label="General (open) break"
                    />
                    <button
                      type="button"
                      onClick={() => removeBreak(b.key)}
                      className="inline-flex items-center space-x-1 text-xs text-red-600 hover:text-red-800"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              ))}
              {s.breaks.length === 0 && (
                <p className="text-xs text-gray-500">
                  No break categories. The tournament will have preliminary rounds only.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={addBreak}
              className="inline-flex items-center space-x-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900"
            >
              <Plus className="w-4 h-4" />
              <span>Add break category</span>
            </button>
          </>
        )}

        {/* Step 5 - Public & feedback */}
        {step === 5 && (
          <>
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-3">What the public can see</h3>
              <div className="space-y-3">
                <Toggle checked={s.publicDraw} onChange={(v) => patch({ publicDraw: v })} label="Draw" />
                <Toggle checked={s.publicMotions} onChange={(v) => patch({ publicMotions: v })} label="Motions" />
                <Toggle checked={s.publicResults} onChange={(v) => patch({ publicResults: v })} label="Results" />
                <Toggle checked={s.publicStandings} onChange={(v) => patch({ publicStandings: v })} label="Standings" />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-3">Adjudicator feedback</h3>
              <Toggle
                checked={s.feedbackEnabled}
                onChange={(v) => patch({ feedbackEnabled: v })}
                label="Collect feedback on adjudicators"
              />
              {s.feedbackEnabled && (
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <Field label="Minimum feedback score">
                    <NumberInput value={s.feedbackMinScore} onChange={(n) => patch({ feedbackMinScore: n })} />
                  </Field>
                  <Field label="Maximum feedback score">
                    <NumberInput value={s.feedbackMaxScore} onChange={(n) => patch({ feedbackMaxScore: n })} />
                  </Field>
                </div>
              )}
            </div>
          </>
        )}

        {/* Step 6 - Review */}
        {step === 6 && (
          <div className="space-y-5 text-sm">
            <dl className="grid grid-cols-3 gap-y-2">
              <dt className="text-gray-500">Name</dt>
              <dd className="col-span-2 font-medium">{s.name.trim()}</dd>
              <dt className="text-gray-500">Address</dt>
              <dd className="col-span-2 font-mono">/{s.slug}</dd>
              <dt className="text-gray-500">Format</dt>
              <dd className="col-span-2">{preset.label}</dd>
              <dt className="text-gray-500">Speakers</dt>
              <dd className="col-span-2">
                {s.substantiveSpeakers} per team
                {s.replyScoresEnabled ? " + reply" : ""}, scored {s.minSpeakerScore} to {s.maxSpeakerScore} in
                steps of {s.stepSpeakerScore}
                {s.replyScoresEnabled ? ` (reply ${s.minReplyScore} to ${s.maxReplyScore})` : ""}
              </dd>
              <dt className="text-gray-500">Draw</dt>
              <dd className="col-span-2">
                {s.drawRule.replace("_", " ")}, {s.sideAllocationRule} sides
              </dd>
              <dt className="text-gray-500">Breaks</dt>
              <dd className="col-span-2">
                {s.breaks.length === 0
                  ? "None"
                  : s.breaks.map((b) => `${b.name.trim()} (${b.breakSize})`).join(", ")}
              </dd>
            </dl>

            <div>
              <h3 className="text-sm font-bold text-gray-900 mb-2">
                Rounds that will be created ({previewRounds.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {previewRounds.map((r) => (
                  <span
                    key={r.id}
                    className={`px-2 py-1 rounded text-xs border ${
                      r.stage === "elimination"
                        ? "bg-amber-50 border-amber-200 text-amber-900"
                        : "bg-gray-50 border-[#d0d7de] text-gray-700"
                    }`}
                  >
                    {r.name}
                  </span>
                ))}
              </div>
              {maxBreakSize > 0 && eliminationRoundCount(maxBreakSize, teamsInDebate) === 0 && (
                <p className="text-xs text-amber-700 mt-2">
                  The largest break size is too small for this format, so no elimination rounds will be created.
                </p>
              )}
            </div>

            <p className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded p-2.5">
              This tournament is saved on this device. Upload it to Firestore only when you choose to.
            </p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={step === 0 ? () => router.push("/tournaments") : goBack}
            disabled={busy}
            className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{step === 0 ? "Cancel" : "Back"}</span>
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy}
              className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs disabled:opacity-50"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{busy ? "Creating..." : "Create tournament"}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={busy}
              className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs disabled:opacity-50"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Next</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
