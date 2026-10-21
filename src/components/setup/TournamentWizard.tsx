"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Checkbox, Input, Select, type InputProps } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/components/ui/cn";
import type { MessageKey } from "@/lib/i18n";
import { getLocalStore } from "@/lib/offline/localStore";
import type { Tournament, TournamentFormat, TournamentPreferences } from "@/types";
import { DEFAULT_POLY_TEAMS_IN_DEBATE, isPolyFormat, isTwoTeamFormat, isValidPolyTeamCount, validatePolyTeamsInDebate } from "@/lib/debateSides";
import {
  BreakDraft,
  FORMAT_PRESETS,
  PUBLIC_INFORMATION_PREFERENCES,
  ROUND_ROBIN_PREFERENCES,
  participantDataEntryPreferences,
  type ParticipantDataEntry,
  PrelimDrawRule,
  RULES_PRESETS,
  getRulesPreset,
  buildBreakCategories,
  buildRounds,
  eliminationRoundCount,
  getFormatPreset,
  slugify,
  validateBreakSize,
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
  /** Teams per room for the poly format (N teams per room); other formats use their own count. */
  teamsInDebate: number;
  /** A Tabbycat rules preset applied on top of the format ("" = none). */
  rulesPresetId: string;
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
  /** Tabbycat's "Public Information Options" preset at creation. */
  publicInformation: boolean;
  /** Tabbycat's participant data entry choice at creation (its PrivateURLs / PublicForms presets). */
  participantDataEntry: ParticipantDataEntry;
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
    teamsInDebate: DEFAULT_POLY_TEAMS_IN_DEBATE,
    rulesPresetId: "",
    substantiveSpeakers: preset.substantiveSpeakers,
    replyScoresEnabled: preset.replyScoresEnabled,
    ...preset.scores,
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
    publicInformation: false,
    participantDataEntry: "default",
  };
}

const STEPS = ["basics", "format", "scoring", "rounds", "breaks", "public", "review"] as const;
type StepId = (typeof STEPS)[number];

const STEP_LABELS = {
  basics: "setup.wizard.stepBasics",
  format: "setup.wizard.stepFormat",
  scoring: "setup.wizard.stepScoring",
  rounds: "setup.wizard.stepRounds",
  breaks: "setup.wizard.stepBreaks",
  public: "setup.wizard.stepPublic",
  review: "setup.wizard.stepReview",
} as const satisfies Record<StepId, MessageKey>;

const FORMAT_MESSAGES = {
  bp: { label: "setup.wizard.formatBp", blurb: "setup.wizard.formatBpBlurb" },
  uadc: { label: "setup.wizard.formatUadc", blurb: "setup.wizard.formatUadcBlurb" },
  australs: { label: "setup.wizard.formatAustrals", blurb: "setup.wizard.formatAustralsBlurb" },
  wsdc: { label: "setup.wizard.formatWsdc", blurb: "setup.wizard.formatWsdcBlurb" },
  custom_2team: { label: "setup.wizard.formatCustom2Team", blurb: "setup.wizard.formatCustom2TeamBlurb" },
  poly: { label: "setup.wizard.formatPoly", blurb: "setup.wizard.formatPolyBlurb" },
} as const satisfies Record<TournamentFormat, { label: MessageKey; blurb: MessageKey }>;

const DRAW_RULE_LABELS = {
  power_paired: "setup.wizard.drawPowerPaired",
  random: "setup.wizard.drawRandom",
  round_robin: "setup.wizard.drawRoundRobin",
} as const satisfies Record<PrelimDrawRule, MessageKey>;

const SIDE_RULE_LABELS = {
  balanced: "setup.wizard.sideBalanced",
  random: "setup.wizard.sideRandom",
  preallocated: "setup.wizard.sidePreallocated",
  manual_ballot: "setup.wizard.sideManualBallot",
} as const satisfies Record<TournamentPreferences["sideAllocationRule"], MessageKey>;

/* -------------------------------------------------------------------------- */
/* Small UI helpers                                                           */
/* -------------------------------------------------------------------------- */

/** A labelled number field; an empty box is kept as NaN so validation can reject it. */
function NumberInput({
  value,
  onChange,
  ...props
}: Omit<InputProps, "type" | "value" | "onChange"> & { value: number; onChange: (n: number) => void }) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Wizard                                                                     */
/* -------------------------------------------------------------------------- */

export function TournamentWizard() {
  const router = useRouter();
  const { user, isGlobalAdmin, loading: authLoading } = useAuth();
  const { t, plural, formatList } = useI18n();

  const [s, setS] = useState<WizardState>(initialState);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (p: Partial<WizardState>) => setS((prev) => ({ ...prev, ...p }));

  const preset = getFormatPreset(s.format);
  const poly = isPolyFormat(s.format);
  const teamsInDebate = poly ? s.teamsInDebate : preset.teamsInDebate;
  // Tabbycat draws other team counts only at random (or by hand).
  const drawRule: PrelimDrawRule = poly ? "random" : s.drawRule;

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
        // An invalid count is reported by the format step; the preview treats it as poly.
        teamsInDebate: poly && !isValidPolyTeamCount(teamsInDebate) ? DEFAULT_POLY_TEAMS_IN_DEBATE : teamsInDebate,
        drawRule,
        firstPrelimDrawType: getRulesPreset(s.rulesPresetId)?.firstPrelimDrawType,
      }),
    [s.prelimRounds, maxBreakSize, teamsInDebate, drawRule, poly, s.rulesPresetId]
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
    // Clamp existing break sizes to what the new format can run (poly breaks need only 1 team).
    const minimumBreak = isPolyFormat(format) ? 1 : p.teamsInDebate;
    const breaks = s.breaks.map((b) =>
      b.breakSize < minimumBreak ? { ...b, breakSize: minimumBreak } : b
    );
    patch({
      format,
      rulesPresetId: "",
      substantiveSpeakers: p.substantiveSpeakers,
      replyScoresEnabled: p.replyScoresEnabled,
      ...p.scores,
      breaks,
      // Sides chosen on the ballot are two-team only.
      ...(!isTwoTeamFormat(format) && s.sideAllocationRule === "manual_ballot" ? { sideAllocationRule: "balanced" as const } : {}),
      ...(isPolyFormat(format) ? { drawRule: "random" as const, teamsInDebate: p.teamsInDebate } : {}),
    });
  };

  const handleRulesPresetChange = (id: string) => {
    const rules = getRulesPreset(id);
    if (!rules) {
      patch({ rulesPresetId: "" });
      return;
    }
    const polyTeams = rules.preferences.teamsInDebate ?? DEFAULT_POLY_TEAMS_IN_DEBATE;
    const teams = rules.format === "bp" ? 4 : isPolyFormat(rules.format) ? 1 : 2;
    patch({
      format: rules.format,
      ...(isPolyFormat(rules.format) ? { teamsInDebate: polyTeams, drawRule: "random" as const } : {}),
      rulesPresetId: rules.id,
      substantiveSpeakers: rules.substantiveSpeakers,
      replyScoresEnabled: rules.replyScoresEnabled,
      ...rules.scores,
      sideAllocationRule: rules.preferences.sideAllocationRule ?? s.sideAllocationRule,
      // The preset's feedback range (Karl Popper: up to 6), which the wizard would otherwise overwrite.
      feedbackMinScore: rules.preferences.feedbackMinScore ?? s.feedbackMinScore,
      feedbackMaxScore: rules.preferences.feedbackMaxScore ?? s.feedbackMaxScore,
      breaks: s.breaks.map((b) => (b.breakSize < teams ? { ...b, breakSize: teams } : b)),
    });
  };
  const rulesPreset = getRulesPreset(s.rulesPresetId);

  const updateBreak = (key: string, p: Partial<BreakDraft>) =>
    patch({ breaks: s.breaks.map((b) => (b.key === key ? { ...b, ...p } : b)) });

  const addBreak = () =>
    patch({
      breaks: [
        ...s.breaks,
        {
          key: newBreakKey(),
          name: "",
          breakSize: poly ? 4 : Math.max(4, teamsInDebate),
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
        if (s.name.trim().length < 3) return t("setup.wizard.errName");
        return validateSlug(s.slug);
      }
      case 1: {
        // validatePolyTeamsInDebate returns an English sentence from lib code; it is shown verbatim.
        return poly ? validatePolyTeamsInDebate(s.teamsInDebate) : "";
      }
      case 2: {
        if (!Number.isInteger(s.substantiveSpeakers) || s.substantiveSpeakers < 1 || s.substantiveSpeakers > 6)
          return t("setup.wizard.errSpeakers");
        if (!(s.stepSpeakerScore > 0)) return t("setup.wizard.errStepPositive");
        if (!(s.minSpeakerScore < s.maxSpeakerScore))
          return t("setup.wizard.errSpeakerRange");
        if (s.stepSpeakerScore > s.maxSpeakerScore - s.minSpeakerScore)
          return t("setup.wizard.errStepTooLarge");
        if (s.replyScoresEnabled && !(s.minReplyScore < s.maxReplyScore))
          return t("setup.wizard.errReplyRange");
        return "";
      }
      case 3: {
        if (!Number.isInteger(s.prelimRounds) || s.prelimRounds < 1 || s.prelimRounds > 20)
          return t("setup.wizard.errPrelimRounds");
        return "";
      }
      case 4: {
        const names = new Set<string>();
        for (const b of s.breaks) {
          const n = b.name.trim().toLowerCase();
          if (!n) return t("setup.wizard.errBreakNameMissing");
          if (names.has(n)) return t("setup.wizard.errBreakNameDuplicate", { name: b.name.trim() });
          names.add(n);
          const breakSizeError = validateBreakSize(b.breakSize, teamsInDebate);
          // validateBreakSize returns an English sentence from lib code; it is shown verbatim.
          if (breakSizeError) return t("setup.wizard.errBreakSize", { name: b.name.trim(), problem: breakSizeError });
          if (!Number.isInteger(b.reserveSize) || b.reserveSize < 0)
            return t("setup.wizard.errReserveSize", { name: b.name.trim() });
        }
        return "";
      }
      case 5: {
        if (s.feedbackEnabled && !(s.feedbackMinScore < s.feedbackMaxScore))
          return t("setup.wizard.errFeedbackRange");
        return "";
      }
      default:
        return "";
    }
  };

  const checkSlugAvailable = async (): Promise<string> => {
    // Local-only copies would be silently overwritten, so block those too.
    try {
      if (await getLocalStore().read(`crabbytab_t_${s.slug}_meta`)) {
        return t("setup.wizard.errSlugTaken", { slug: s.slug });
      }
    } catch (error) {
      // Device storage unavailable: creating will report it.
      console.warn("Could not check this device for the slug:", error);
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
    if (!isGlobalAdmin) {
      setError(t("setup.wizard.errAdminOnly"));
      return;
    }

    // Re-validate every step so a skipped-over problem can't slip through.
    for (const i of [0, 1, 2, 3, 4, 5]) {
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

    const ownerId = user?.uid || "local";

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
        // Tabbycat's default for every format (scoring__teamscore_includes_ghosts); a preset may override it.
        teamScoreIncludesGhosts: true,
        // Tabbycat's disable_ballot_confirms is off by default: private-URL ballots wait for the tab
        // room. Stored explicitly, so tournaments created earlier keep their old default.
        privateBallotConfirmation: "tab_room",
        // Tabbycat's default motion_vetoes_enabled (on); presets that set it override this. Stored
        // explicitly, so tournaments created earlier keep vetoes off.
        enableMotionVetoes: true,
        // The rules preset's bundle first, so anything edited in the wizard wins.
        ...(rulesPreset?.preferences ?? {}),
        // Tabbycat's RoundRobinTwoTeam / RoundRobinBP presets: pairings come from the schedule.
        ...(drawRule === "round_robin" ? ROUND_ROBIN_PREFERENCES : {}),
        teamsInDebate,
        substantiveSpeakers: s.substantiveSpeakers,
        replyScoresEnabled: s.replyScoresEnabled,
        minSpeakerScore: s.minSpeakerScore,
        maxSpeakerScore: s.maxSpeakerScore,
        stepSpeakerScore: s.stepSpeakerScore,
        minReplyScore: s.minReplyScore,
        maxReplyScore: s.maxReplyScore,
        drawRule,
        sideAllocationRule: s.sideAllocationRule,
        ballotDoubleEntry: s.ballotDoubleEntry,
        publicDraw: s.publicDraw,
        publicResults: s.publicResults,
        publicStandings: s.publicStandings,
        publicMotions: s.publicMotions,
        feedbackEnabled: s.feedbackEnabled,
        feedbackMinScore: s.feedbackMinScore,
        feedbackMaxScore: s.feedbackMaxScore,
        // The preset's other switches are the public checkboxes above (ticked with it, editable after).
        ...(s.publicInformation
          ? {
              ...(s.publicDraw ? { publicDrawMode: PUBLIC_INFORMATION_PREFERENCES.publicDrawMode } : {}),
              publicBreakCategories: PUBLIC_INFORMATION_PREFERENCES.publicBreakCategories,
            }
          : {}),
        ...participantDataEntryPreferences(s.participantDataEntry),
      },
      createdAt: now,
      updatedAt: now,
    };

    const rounds = buildRounds({
      tournamentId: id,
      prelimRounds: s.prelimRounds,
      maxBreakSize,
      teamsInDebate,
      drawRule,
      firstPrelimDrawType: rulesPreset?.firstPrelimDrawType,
    });
    const breakCategories = buildBreakCategories(id, s.breaks);

    try {
      // The device is the source of truth until the director explicitly uploads.
      const prefix = `crabbytab_t_${s.slug}`;
      // Meta last in the list, all in one transaction: the tournament exists only once all are saved.
      await getLocalStore().writeAll([
        [`${prefix}_rounds`, JSON.stringify(rounds)],
        [`${prefix}_breaks`, JSON.stringify(breakCategories)],
        [`${prefix}_meta`, JSON.stringify(tournament)],
      ]);

      router.push(`/${s.slug}`);
    } catch (e: unknown) {
      console.error("Error creating tournament:", e);
      setError(e instanceof Error ? e.message : t("setup.wizard.errCreateFailed"));
      setBusy(false);
    }
  };

  /* ------------------------------- render ------------------------------- */

  const isLast = step === STEPS.length - 1;

  if (authLoading) {
    return (
      <p role="status" className="text-[13px] text-fg-muted">
        {t("setup.wizard.checkingAccess")}
      </p>
    );
  }

  if (!isGlobalAdmin) {
    return (
      <Alert tone="warning" role="alert" title={t("setup.wizard.adminOnlyTitle")}>
        {t("setup.wizard.adminOnlyBody")}
      </Alert>
    );
  }

  const prelimPreview = previewRounds.filter((r) => r.stage !== "elimination");
  const eliminationPreview = previewRounds.filter((r) => r.stage === "elimination");
  const speakerSummaryValues = {
    count: s.substantiveSpeakers,
    min: s.minSpeakerScore,
    max: s.maxSpeakerScore,
    step: s.stepSpeakerScore,
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("setup.wizard.title")} description={t("setup.wizard.intro")} />

      {/* Step indicator: the current step carries aria-current and bold text; done steps a check and hidden text. */}
      <nav aria-label={t("setup.wizard.stepsLabel")}>
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((id, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <li
                key={id}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
                  current
                    ? "border-accent bg-accent-subtle font-semibold text-accent-text"
                    : done
                      ? "border-border bg-surface text-fg"
                      : "border-border bg-surface text-fg-muted"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full text-[10px]",
                    current ? "bg-accent text-accent-fg" : done ? "bg-success-subtle text-success" : "bg-muted"
                  )}
                >
                  {done ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span>
                  {t(STEP_LABELS[id])}
                  {done && <span className="sr-only"> {t("setup.wizard.stepCompleted")}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      <Card>
        <CardHeader
          title={t(STEP_LABELS[STEPS[step]])}
          description={t("setup.wizard.stepProgress", { current: step + 1, total: STEPS.length })}
        />
        <CardBody className="space-y-5">
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}

          {/* Step 0 - Basics */}
          {step === 0 && (
            <>
              <Input
                label={t("setup.wizard.nameLabel")}
                placeholder={t("setup.wizard.namePlaceholder")}
                value={s.name}
                onChange={(e) => handleNameChange(e.target.value)}
                autoFocus
              />
              <Input
                label={t("setup.wizard.shortNameLabel")}
                help={t("setup.wizard.shortNameHelp")}
                maxLength={15}
                placeholder={t("setup.wizard.shortNamePlaceholder")}
                value={s.shortName}
                onChange={(e) => patch({ shortName: e.target.value })}
              />
              <Input
                label={t("setup.wizard.slugLabel")}
                help={t("setup.wizard.slugHelp")}
                className="font-mono"
                dir="ltr"
                leadingIcon={<span className="font-mono text-xs">/</span>}
                placeholder={t("setup.wizard.slugPlaceholder")}
                value={s.slug}
                onChange={(e) =>
                  patch({
                    slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40),
                    slugTouched: true,
                  })
                }
              />
            </>
          )}

          {/* Step 1 - Format */}
          {step === 1 && (
            <>
              <fieldset className="space-y-3">
                <legend className="mb-3 text-[13px] text-fg-muted">
                  <span className="block text-xs font-medium text-fg">{t("setup.wizard.formatLegend")}</span>
                  {t("setup.wizard.formatIntro")}
                </legend>
                {FORMAT_PRESETS.map((f) => {
                  const selected = s.format === f.id;
                  const messages = FORMAT_MESSAGES[f.id];
                  return (
                    <label
                      key={f.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                        selected ? "border-accent bg-accent-subtle" : "border-border hover:bg-muted"
                      )}
                    >
                      <input
                        type="radio"
                        name="format"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--color-accent))] focus-visible:outline-none"
                        checked={selected}
                        onChange={() => handleFormatChange(f.id)}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-fg">{t(messages.label)}</span>
                        <span className="block text-xs text-fg-muted">{t(messages.blurb)}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              {poly && (
                <NumberInput
                  label={t("setup.wizard.teamsPerRoomLabel")}
                  help={t("setup.wizard.teamsPerRoomHelp")}
                  value={s.teamsInDebate}
                  onChange={(n) => patch({ teamsInDebate: n })}
                  min={1}
                  step={1}
                />
              )}
              <Select
                label={t("setup.wizard.rulesPresetLabel")}
                help={t("setup.wizard.rulesPresetHelp")}
                value={s.rulesPresetId}
                onChange={(e) => handleRulesPresetChange(e.target.value)}
              >
                <option value="">{t("setup.wizard.rulesPresetNone")}</option>
                {RULES_PRESETS.map((rules) => (
                  <option key={rules.id} value={rules.id}>
                    {rules.label}
                  </option>
                ))}
              </Select>
              {/* Preset names, blurbs and unsupported-feature notes are Tabbycat reference data from lib code. */}
              {rulesPreset && (
                <div className="space-y-1 rounded-md border border-border bg-muted p-3 text-xs text-fg-muted">
                  <p className="text-fg">{rulesPreset.blurb}</p>
                  {rulesPreset.unsupported.length > 0 && (
                    <p>{t("setup.wizard.rulesPresetUnsupported", { items: rulesPreset.unsupported.join("; ") })}</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Step 2 - Scoring */}
          {step === 2 && (
            <>
              <NumberInput
                label={t("setup.wizard.speakersLabel")}
                value={s.substantiveSpeakers}
                onChange={(n) => patch({ substantiveSpeakers: n })}
                min={1}
                max={6}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <NumberInput
                  label={t("setup.wizard.minSpeakerScore")}
                  value={s.minSpeakerScore}
                  onChange={(n) => patch({ minSpeakerScore: n })}
                />
                <NumberInput
                  label={t("setup.wizard.maxSpeakerScore")}
                  value={s.maxSpeakerScore}
                  onChange={(n) => patch({ maxSpeakerScore: n })}
                />
                <NumberInput
                  label={t("setup.wizard.scoreStep")}
                  help={t("setup.wizard.scoreStepHelp")}
                  value={s.stepSpeakerScore}
                  onChange={(n) => patch({ stepSpeakerScore: n })}
                  step={0.5}
                />
              </div>
              <Checkbox
                label={t("setup.wizard.replyScored")}
                description={t("setup.wizard.replyScoredHelp")}
                checked={s.replyScoresEnabled}
                onChange={(e) => patch({ replyScoresEnabled: e.target.checked })}
              />
              {s.replyScoresEnabled && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <NumberInput
                    label={t("setup.wizard.minReplyScore")}
                    value={s.minReplyScore}
                    onChange={(n) => patch({ minReplyScore: n })}
                  />
                  <NumberInput
                    label={t("setup.wizard.maxReplyScore")}
                    value={s.maxReplyScore}
                    onChange={(n) => patch({ maxReplyScore: n })}
                  />
                </div>
              )}
            </>
          )}

          {/* Step 3 - Rounds */}
          {step === 3 && (
            <>
              <NumberInput
                label={t("setup.wizard.prelimRoundsLabel")}
                value={s.prelimRounds}
                onChange={(n) => patch({ prelimRounds: n })}
                min={1}
                max={20}
              />
              {poly ? (
                <p className="text-[13px] text-fg-muted">{t("setup.wizard.polyDrawNote")}</p>
              ) : (
              <Select
                label={t("setup.wizard.drawMethodLabel")}
                help={t("setup.wizard.drawMethodHelp")}
                value={s.drawRule}
                onChange={(e) => patch({ drawRule: e.target.value as PrelimDrawRule })}
              >
                <option value="power_paired">{t("setup.wizard.drawPowerPaired")}</option>
                <option value="random">{t("setup.wizard.drawRandom")}</option>
                <option value="round_robin">{t("setup.wizard.drawRoundRobin")}</option>
              </Select>
              )}
              {!poly && (
              <Select
                label={t("setup.wizard.sideAllocationLabel")}
                value={s.sideAllocationRule}
                onChange={(e) =>
                  patch({ sideAllocationRule: e.target.value as TournamentPreferences["sideAllocationRule"] })
                }
              >
                <option value="balanced">{t("setup.wizard.sideBalancedOption")}</option>
                <option value="random">{t("setup.wizard.sideRandomOption")}</option>
                {s.format !== "bp" && (
                  <option value="manual_ballot">{t("setup.wizard.sideManualBallotOption")}</option>
                )}
              </Select>
              )}
              <Checkbox
                label={t("setup.wizard.doubleEntryLabel")}
                description={t("setup.wizard.doubleEntryHelp")}
                checked={s.ballotDoubleEntry}
                onChange={(e) => patch({ ballotDoubleEntry: e.target.checked })}
              />
            </>
          )}

          {/* Step 4 - Breaks */}
          {step === 4 && (
            <>
              <p className="text-[13px] text-fg-muted">{t("setup.wizard.breaksIntro")}</p>
              <div className="space-y-3">
                {s.breaks.map((b, index) => (
                  <fieldset key={b.key} className="space-y-3 rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-medium text-fg-muted">
                      {t("setup.wizard.breakCategoryLegend", { number: index + 1 })}
                    </legend>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <Input
                        label={t("setup.wizard.breakNameLabel")}
                        placeholder={t("setup.wizard.breakNamePlaceholder")}
                        value={b.name}
                        onChange={(e) => updateBreak(b.key, { name: e.target.value })}
                      />
                      <NumberInput
                        label={t("setup.wizard.breakSizeLabel")}
                        value={b.breakSize}
                        onChange={(n) => updateBreak(b.key, { breakSize: n })}
                        min={poly ? 1 : teamsInDebate}
                        step={teamsInDebate === 4 ? 2 : 1}
                      />
                      <NumberInput
                        label={t("setup.wizard.reserveSizeLabel")}
                        value={b.reserveSize}
                        onChange={(n) => updateBreak(b.key, { reserveSize: n })}
                        min={0}
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Checkbox
                        label={t("setup.wizard.generalBreakLabel")}
                        checked={b.isGeneral}
                        onChange={(e) => updateBreak(b.key, { isGeneral: e.target.checked })}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeBreak(b.key)}
                        aria-label={t("setup.wizard.removeBreak", { number: index + 1 })}
                        className="text-danger hover:text-danger"
                      >
                        <Trash2 aria-hidden="true" />
                        {t("setup.common.remove")}
                      </Button>
                    </div>
                  </fieldset>
                ))}
                {s.breaks.length === 0 && <p className="text-xs text-fg-muted">{t("setup.wizard.noBreaks")}</p>}
              </div>
              <Button size="sm" onClick={addBreak}>
                <Plus aria-hidden="true" />
                {t("setup.wizard.addBreak")}
              </Button>
            </>
          )}

          {/* Step 5 - Public & feedback */}
          {step === 5 && (
            <>
              <fieldset className="space-y-3">
                <legend className="mb-3 text-[13px] font-semibold text-fg">{t("setup.wizard.publicHeading")}</legend>
                <Checkbox
                  label={t("setup.wizard.publicDraw")}
                  checked={s.publicDraw}
                  onChange={(e) => patch({ publicDraw: e.target.checked })}
                />
                <Checkbox
                  label={t("setup.wizard.publicMotions")}
                  checked={s.publicMotions}
                  onChange={(e) => patch({ publicMotions: e.target.checked })}
                />
                <Checkbox
                  label={t("setup.wizard.publicResults")}
                  checked={s.publicResults}
                  onChange={(e) => patch({ publicResults: e.target.checked })}
                />
                <Checkbox
                  label={t("setup.wizard.publicStandings")}
                  checked={s.publicStandings}
                  onChange={(e) => patch({ publicStandings: e.target.checked })}
                />
                <Checkbox
                  label={t("setup.wizard.publicInformation")}
                  description={t("setup.wizard.publicInformationHelp")}
                  checked={s.publicInformation}
                  onChange={(e) => patch(
                    e.target.checked
                      ? { publicInformation: true, publicDraw: true, publicMotions: true, publicResults: true, publicStandings: true }
                      : { publicInformation: false }
                  )}
                />
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="mb-3 text-[13px] font-semibold text-fg">{t("setup.wizard.dataEntryHeading")}</legend>
                <Select
                  label={t("setup.wizard.dataEntryLabel")}
                  help={t("setup.wizard.dataEntryHelp")}
                  value={s.participantDataEntry}
                  onChange={(e) => patch({ participantDataEntry: e.target.value as ParticipantDataEntry })}
                  wrapperClassName="max-w-md"
                >
                  <option value="default">{t("setup.wizard.dataEntryDefault")}</option>
                  <option value="private_urls">{t("setup.wizard.dataEntryPrivateUrls")}</option>
                  <option value="public_forms">{t("setup.wizard.dataEntryPublicForms")}</option>
                  <option value="tab_staff">{t("setup.wizard.dataEntryTabStaff")}</option>
                </Select>
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="mb-3 text-[13px] font-semibold text-fg">{t("setup.wizard.feedbackHeading")}</legend>
                <Checkbox
                  label={t("setup.wizard.feedbackEnabled")}
                  checked={s.feedbackEnabled}
                  onChange={(e) => patch({ feedbackEnabled: e.target.checked })}
                />
                {s.feedbackEnabled && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <NumberInput
                      label={t("setup.wizard.feedbackMinScore")}
                      value={s.feedbackMinScore}
                      onChange={(n) => patch({ feedbackMinScore: n })}
                    />
                    <NumberInput
                      label={t("setup.wizard.feedbackMaxScore")}
                      value={s.feedbackMaxScore}
                      onChange={(n) => patch({ feedbackMaxScore: n })}
                    />
                  </div>
                )}
              </fieldset>
            </>
          )}

          {/* Step 6 - Review */}
          {step === 6 && (
            <div className="space-y-5 text-[13px]">
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr] sm:gap-y-2">
                <dt className="text-fg-muted">{t("setup.wizard.reviewName")}</dt>
                <dd className="mb-2 font-medium text-fg sm:mb-0">{s.name.trim()}</dd>
                <dt className="text-fg-muted">{t("setup.wizard.reviewAddress")}</dt>
                <dd className="mb-2 break-all font-mono text-fg sm:mb-0" dir="ltr">
                  /{s.slug}
                </dd>
                <dt className="text-fg-muted">{t("setup.wizard.reviewFormat")}</dt>
                <dd className="mb-2 text-fg sm:mb-0">{t(FORMAT_MESSAGES[s.format].label)}</dd>
                <dt className="text-fg-muted">{t("setup.wizard.reviewSpeakers")}</dt>
                <dd className="mb-2 text-fg sm:mb-0">
                  {s.replyScoresEnabled
                    ? t("setup.wizard.speakersSummaryReply", {
                        ...speakerSummaryValues,
                        replyMin: s.minReplyScore,
                        replyMax: s.maxReplyScore,
                      })
                    : t("setup.wizard.speakersSummary", speakerSummaryValues)}
                </dd>
                <dt className="text-fg-muted">{t("setup.wizard.reviewDraw")}</dt>
                <dd className="mb-2 text-fg sm:mb-0">
                  {t("setup.wizard.drawSummary", {
                    draw: t(DRAW_RULE_LABELS[drawRule]),
                    sides: t(SIDE_RULE_LABELS[s.sideAllocationRule]),
                  })}
                </dd>
                <dt className="text-fg-muted">{t("setup.wizard.reviewBreaks")}</dt>
                <dd className="text-fg">
                  {s.breaks.length === 0
                    ? t("setup.common.none")
                    : formatList(
                        s.breaks.map((b) =>
                          t("setup.wizard.breakSummaryItem", { name: b.name.trim(), size: b.breakSize })
                        )
                      )}
                </dd>
              </dl>

              <div className="space-y-3">
                <h3 className="text-[13px] font-semibold text-fg">
                  {plural("setup.wizard.roundsHeading", previewRounds.length)}
                </h3>
                {[
                  { key: "prelim", title: t("setup.wizard.roundsPrelim"), rounds: prelimPreview },
                  { key: "elimination", title: t("setup.wizard.roundsElimination"), rounds: eliminationPreview },
                ]
                  .filter((group) => group.rounds.length > 0)
                  .map((group) => (
                    <div key={group.key} className="space-y-1.5">
                      <h4 className="text-xs font-medium text-fg-muted">{group.title}</h4>
                      <ul className="flex flex-wrap gap-1.5">
                        {group.rounds.map((r) => (
                          <li
                            key={r.id}
                            className={cn(
                              "rounded-md border px-2 py-1 text-xs",
                              group.key === "elimination"
                                ? "border-accent/30 bg-accent-subtle text-accent-text"
                                : "border-border bg-muted text-fg"
                            )}
                          >
                            {r.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                {maxBreakSize > 0 && eliminationRoundCount(maxBreakSize, teamsInDebate) === 0 && (
                  <Alert tone="warning">{t("setup.wizard.noEliminationRounds")}</Alert>
                )}
              </div>

              <Alert tone="info">{t("setup.wizard.savedOnDevice")}</Alert>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button onClick={step === 0 ? () => router.push("/tournaments") : goBack} disabled={busy}>
              <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
              {step === 0 ? t("setup.common.cancel") : t("setup.common.back")}
            </Button>

            {isLast ? (
              <Button variant="primary" onClick={handleCreate} loading={busy} loadingText={t("setup.wizard.creating")}>
                {t("setup.wizard.create")}
              </Button>
            ) : (
              <Button variant="primary" onClick={goNext} loading={busy}>
                {t("setup.common.next")}
                <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
