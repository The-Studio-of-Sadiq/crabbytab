"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileCheck2, Lightbulb, Printer, Save, ShieldCheck, Users } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { SideBadge } from "@/components/ui/SideBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Field";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { SpeechRows } from "@/features/tournament/components/ballot/SpeechRows";
import { BallotHistory } from "@/features/tournament/components/ballot/BallotHistory";
import { BallotDiffDialog } from "@/features/tournament/components/ballot/BallotDiffDialog";
import { useFormatScore } from "@/features/tournament/components/results/useFormatScore";
import {
  blankEntry,
  entryFromBallot,
  nextBallotVersion,
  resolveCheckState,
  roundMotions,
  sheetsFromPortalBallots,
} from "@/features/tournament/application/ballotEntry";
import {
  applyScoreCriteria,
  ballotSides,
  buildBallotResult,
  diffBallots,
  effectiveRanks,
  sheetOutcome,
  substantiveSpeakerCount,
  usesSpeakerScores,
  usesVotingBallots,
  validateBallotEntry,
  type BallotDifference,
  type BallotEntry,
  type BallotRules,
} from "@/lib/ballots/result";
import type { AdjudicatorSheet, BallotSubmission, DebateSide, SpeakerScoreEntry } from "@/types";
import { arrangeDebateSides, isSidePermutation, sidesChosenOnBallot } from "@/lib/draw/manualSides";
import { MotionPreferencesFields } from "@/features/tournament/components/ballot/MotionPreferencesFields";
import { normalizeMotionPreferences, validateMotionPreferences } from "@/lib/motions/preferences";
import { motionsEnabled, speakerRanksFor, winnerDeclarationFor } from "@/lib/ballots/ballotRules";
import { sideLabel, translatedSideName } from "@/lib/sideNames";
import { mergeIndividualBallots } from "@/lib/ballots/individualBallots";
import type { MessageKey } from "@/lib/i18n/messages";

const ERROR_SUMMARY_ID = "ballot-entry-errors";
const radioClasses = cn("h-4 w-4 shrink-0 cursor-pointer accent-[rgb(var(--color-accent))]", focusRing);
const BP_RANK_KEYS: MessageKey[] = [
  "results.ballot.bpRank1",
  "results.ballot.bpRank2",
  "results.ballot.bpRank3",
  "results.ballot.bpRank4",
];

function BackToResults({ href }: { href: string }) {
  const { t } = useI18n();
  return (
    <Link href={href} className={buttonClasses({ variant: "ghost", size: "sm", className: "no-print -ms-2.5" })}>
      <ArrowLeft className="rtl:-scale-x-100" aria-hidden="true" />
      {t("results.ballot.back")}
    </Link>
  );
}

export default function BallotEntryPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentSlug = params.tournamentSlug as string;
  const roundSeq = parseInt(params.roundSeq as string, 10);
  const debateId = params.debateId as string;

  const { t, plural } = useI18n();
  const { user } = useAuth();
  const { tournament, debates, rounds, teams, adjudicators, motions, ballots, submitBallot, confirmBallot, discardBallot } =
    useTournament();

  const drawnDebate = debates.find((item) => item.id === debateId);
  // Sides chosen on the ballot (manual-ballot): the person entering the ballot records which team
  // took the first side; everything below works on the debate arranged that way.
  const choosesSides = Boolean(drawnDebate && sidesChosenOnBallot(drawnDebate) && drawnDebate.teams.AFF && drawnDebate.teams.NEG);
  const [affTeamId, setAffTeamId] = useState<string | null>(null);
  const [reloadBlank, setReloadBlank] = useState(false);
  const debate = useMemo(() => {
    if (!drawnDebate || !choosesSides || !affTeamId) return drawnDebate;
    const negTeamId = [drawnDebate.teams.AFF?.teamId, drawnDebate.teams.NEG?.teamId].find((id) => id && id !== affTeamId);
    const assignment = { AFF: affTeamId, NEG: negTeamId };
    return isSidePermutation(drawnDebate, assignment) ? arrangeDebateSides(drawnDebate, assignment) : drawnDebate;
  }, [drawnDebate, choosesSides, affTeamId]);
  const round = rounds.find((item) => item.seq === roundSeq);
  const rules: BallotRules = useMemo(
    () => ({ format: tournament?.format || "bp", preferences: tournament?.preferences, stage: round?.stage }),
    [tournament?.format, tournament?.preferences, round?.stage]
  );
  const preferences = tournament?.preferences;
  const sides = ballotSides(rules.format);
  const voting = usesVotingBallots(rules);
  const isBP = rules.format === "bp";
  // Results-only ballots (speakersInBallots), declared winners and speech ranks change the form.
  const scored = usesSpeakerScores(rules);
  const winnerMode = winnerDeclarationFor(preferences);
  const winnerFromScores = scored && winnerMode === "none";
  const rankCount = scored && !voting && speakerRanksFor(preferences) !== "none"
    ? sides.length * substantiveSpeakerCount(rules)
    : undefined;
  const usingMotions = motionsEnabled(preferences);
  const label = (side: DebateSide, kind: "abbr" | "full" = "abbr") =>
    kind === "full" ? translatedSideName(t, side, preferences) : sideLabel(side, preferences);

  const rosters = useMemo(() => {
    const byId = new Map(teams.map((team) => [team.id, team]));
    return Object.fromEntries(
      sides.map((side) => [side, byId.get(debate?.teams?.[side]?.teamId || "")?.speakers || []])
    ) as Partial<Record<DebateSide, { id: string; name: string }[]>>;
  }, [teams, debate, sides]);
  const teamIds = useMemo(
    () => Object.fromEntries(sides.map((side) => [side, debate?.teams?.[side]?.teamId || ""])),
    [debate, sides]
  );
  const debateBallots = useMemo(() => ballots.filter((ballot) => ballot.debateId === debateId), [ballots, debateId]);
  const confirmedBallot = debateBallots.find((ballot) => ballot.confirmed && !ballot.discarded);
  const checkState = resolveCheckState({
    ballots: debateBallots,
    debateId,
    userId: user?.uid,
    doubleEntry: Boolean(preferences?.ballotDoubleEntry),
    checkMode: preferences?.ballotCheckMode,
  });
  const availableMotions = useMemo(() => roundMotions(motions, round?.id), [motions, round?.id]);

  const blank = useMemo(
    () => (debate ? blankEntry(debate, rosters, adjudicators, rules) : null),
    [debate, rosters, adjudicators, rules]
  );

  const [entry, setEntry] = useState<BallotEntry | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const [activeSheet, setActiveSheet] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [differences, setDifferences] = useState<BallotDifference[] | null>(null);
  const [candidate, setCandidate] = useState<BallotSubmission | null>(null);
  // Confirmations that used to be window.confirm prompts.
  const [pendingSideTeamId, setPendingSideTeamId] = useState<string | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<BallotSubmission | null>(null);
  const initializedFor = useRef<string | null>(null);

  const loadEntry = useCallback((next: BallotEntry) => {
    setEntry(next);
    setInitialSnapshot(JSON.stringify(next));
    setActiveSheet(0);
    setShowErrors(false);
  }, []);

  // Sides chosen on the ballot: start from the sides of the ballot being shown (or already
  // confirmed on the debate); otherwise the user picks them before entering scores.
  useEffect(() => {
    if (!choosesSides || affTeamId || !drawnDebate) return;
    const base =
      checkState.kind === "review" || checkState.kind === "awaiting-other"
        ? checkState.pending
        : checkState.kind === "blind-check" ? undefined : confirmedBallot;
    const fromBallot = base?.teamScores?.AFF?.teamId;
    if (fromBallot) setAffTeamId(fromBallot);
    else if (drawnDebate.sidesConfirmed) setAffTeamId(drawnDebate.teams.AFF?.teamId || null);
  }, [choosesSides, affTeamId, drawnDebate, checkState, confirmedBallot]);
  // A side change re-arranges the rosters, so the entry restarts from a blank ballot.
  useEffect(() => {
    if (!reloadBlank || !blank) return;
    setReloadBlank(false);
    initializedFor.current = debateId;
    loadEntry(blank);
  }, [reloadBlank, blank, debateId, loadEntry]);

  // Initialise once per debate: a blind checker starts blank; otherwise show the entry awaiting a
  // check, else the confirmed result, else a blank ballot.
  useEffect(() => {
    if (!blank || initializedFor.current === debateId) return;
    if (choosesSides && !affTeamId) return;
    initializedFor.current = debateId;
    const base =
      checkState.kind === "blind-check"
        ? undefined
        : checkState.kind === "review" || checkState.kind === "awaiting-other"
          ? checkState.pending
          : confirmedBallot;
    loadEntry(base ? entryFromBallot(base, blank, rules) : blank);
  }, [blank, checkState, confirmedBallot, debateId, loadEntry, rules, choosesSides, affTeamId]);

  const recordsMotionPreferences = preferences?.enableMotionPreferences === true && availableMotions.length > 1;
  const errors = useMemo(
    () =>
      entry
        ? [
            ...validateBallotEntry(entry, { ...rules, rosters, roundMotionIds: availableMotions.map((motion) => motion.id) }),
            ...(recordsMotionPreferences
              ? validateMotionPreferences(entry.motionPreferences, availableMotions.map((motion) => motion.id), entry.vetoes)
                  .map((problem) => problem.message)
              : []),
          ]
        : [],
    [entry, rules, rosters, availableMotions, recordsMotionPreferences]
  );
  const preview = useMemo(() => {
    if (!entry || errors.length > 0) return null;
    try {
      return buildBallotResult(entry, teamIds, debate?.adjudicators?.chairId, rules);
    } catch {
      return null;
    }
  }, [entry, errors, teamIds, debate?.adjudicators?.chairId, rules]);

  const resultsHref = `/${tournamentSlug}/results`;

  if (!debate || !tournament) {
    return (
      <EmptyState
        icon={<FileCheck2 />}
        title={t("results.ballot.notFound")}
        action={
          <Button variant="primary" onClick={() => router.back()}>
            {t("results.ballot.goBack")}
          </Button>
        }
      />
    );
  }

  if (debate.byeTeamId) {
    const byeTeam = Object.values(debate.teams).find((slot) => slot?.teamId === debate.byeTeamId);
    const teamName = byeTeam?.teamName || t("results.ballot.byeTeamFallback");
    return (
      <div className="mx-auto max-w-4xl space-y-6 pb-12">
        <BackToResults href={resultsHref} />
        <PageHeader title={t("results.ballot.title")} description={round?.name} />
        <Alert tone="info" title={t("results.ballot.bye.title")}>
          {debate.byeResult === "win"
            ? t("results.ballot.bye.win", { team: teamName })
            : t("results.ballot.bye.absent", { team: teamName })}
        </Alert>
      </div>
    );
  }

  const requestSide = (teamId: string) => {
    if (affTeamId && entry && JSON.stringify(entry) !== initialSnapshot) {
      setPendingSideTeamId(teamId);
      return;
    }
    setAffTeamId(teamId);
    setReloadBlank(true);
  };

  const sidePicker = choosesSides && drawnDebate ? (
    <fieldset className="space-y-2 rounded-lg border border-info-border bg-info-subtle p-3">
      <legend className="px-1 text-xs font-semibold text-fg">{t("results.ballot.sides.legend")}</legend>
      <p className="text-xs text-fg-muted">{t("results.ballot.sides.help", { side: label("AFF", "full") })}</p>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-6">
        {[drawnDebate.teams.AFF, drawnDebate.teams.NEG].map((slot) => slot?.teamId && (
          <label key={slot.teamId} className="flex items-center gap-2 text-[13px] font-medium text-fg">
            <input
              type="radio"
              name="affirmative-team"
              className={radioClasses}
              checked={affTeamId === slot.teamId}
              onChange={() => requestSide(slot.teamId)}
            />
            {t("results.ballot.sides.option", { team: slot.teamName, side: label("AFF", "full") })}
          </label>
        ))}
      </div>
    </fieldset>
  ) : null;

  const sideChangeDialog = pendingSideTeamId !== null && (
    <ConfirmActionDialog
      title={t("results.ballot.sides.confirmTitle")}
      description={t("results.ballot.sides.confirmDescription")}
      confirmLabel={t("results.ballot.sides.confirmAction")}
      variant="danger"
      onCancel={() => setPendingSideTeamId(null)}
      onConfirm={() => {
        setAffTeamId(pendingSideTeamId);
        setReloadBlank(true);
        setPendingSideTeamId(null);
      }}
    />
  );

  if (!entry) {
    return sidePicker && !affTeamId ? (
      <div className="mx-auto max-w-4xl space-y-6 pb-12">
        <BackToResults href={resultsHref} />
        <PageHeader
          title={t("results.ballot.title")}
          description={[round?.name, debate.venueName].filter(Boolean).join(" · ")}
        />
        {sidePicker}
      </div>
    ) : (
      <p role="status" className="p-8 text-center text-[13px] text-fg-muted">
        {t("results.ballot.loading")}
      </p>
    );
  }

  const dirty = JSON.stringify(entry) !== initialSnapshot;
  const chairId = debate.adjudicators?.chairId;
  // Saved into the ballot record (submitterName / confirmedBy), so it is not translated.
  const userLabel = user?.email || "Tab room";
  const teamName = (side: DebateSide) => debate.teams[side]?.teamName || label(side);

  const updateEntry = (patch: Partial<BallotEntry>) => setEntry((current) => (current ? { ...current, ...patch } : current));

  const updateConsensusSide = (side: DebateSide, speeches: SpeakerScoreEntry[]) =>
    updateEntry({ speakerScores: { ...entry.speakerScores, [side]: speeches } });

  // Speaker order is shared by every voting sheet: changing it on the first sheet applies to all.
  const updateSheetSide = (sheetIndex: number, side: DebateSide, speeches: SpeakerScoreEntry[]) => {
    const sheets = (entry.sheets || []).map((sheet, index) => {
      if (index === sheetIndex) return { ...sheet, speakerScores: { ...sheet.speakerScores, [side]: speeches } };
      if (sheetIndex !== 0) return sheet;
      const synced = (sheet.speakerScores[side] || []).map((speech) => {
        const lead = speeches.find((candidateSpeech) => candidateSpeech.position === speech.position);
        return lead ? { ...speech, speakerId: lead.speakerId, speakerName: lead.speakerName, ghost: lead.ghost } : speech;
      });
      return { ...sheet, speakerScores: { ...sheet.speakerScores, [side]: synced } };
    });
    updateEntry({ sheets });
  };

  const derivedRanks = effectiveRanks(
    Object.fromEntries(sides.map((side) => [side, applyScoreCriteria(entry.speakerScores[side] || [], rules)])),
    entry.ranks,
    rules
  );

  const setWinner = (winner: DebateSide) =>
    updateEntry({ ranks: Object.fromEntries(sides.map((side) => [side, side === winner ? 1 : 2])) });

  const buildSubmission = (confirmed: boolean, extra: Partial<BallotSubmission> = {}): BallotSubmission => {
    const result = buildBallotResult(entry, teamIds, chairId, rules);
    const version = nextBallotVersion(ballots, debate.id);
    const motion = motions.find((item) => item.id === entry.motionId);
    const vetoes = Object.fromEntries(Object.entries(entry.vetoes || {}).filter(([, motionId]) => Boolean(motionId)));
    const motionPreferences = recordsMotionPreferences
      ? normalizeMotionPreferences(entry.motionPreferences, availableMotions.map((item) => item.id))
      : {};
    const now = new Date().toISOString();
    return {
      id: `ballot-${debate.id}-v${version}-${Date.now()}`,
      tournamentId: tournament.id,
      roundId: debate.roundId,
      debateId: debate.id,
      version,
      confirmed,
      discarded: false,
      submitterType: "tabroom",
      submitterId: user?.uid || "local",
      submitterName: userLabel,
      ...(usingMotions && entry.motionId ? { motionId: entry.motionId, motionText: motion?.text || debate.motionText } : {}),
      speakerScores: result.speakerScores,
      teamScores: result.teamScores,
      ...(result.sheets ? { sheets: result.sheets } : {}),
      ...(usingMotions && Object.keys(vetoes).length > 0 ? { vetoes } : {}),
      ...(result.noSpeakerScores ? { noSpeakerScores: true } : {}),
      ...(usingMotions && Object.keys(motionPreferences).length > 0 ? { motionPreferences } : {}),
      ...(entry.forfeitSide ? { forfeitSide: entry.forfeitSide } : {}),
      ...(chairId ? { chairId } : {}),
      timestamp: now,
      ...(confirmed ? { confirmedBy: userLabel, confirmedTimestamp: now } : {}),
      ...extra,
    };
  };

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      if (done) router.push(resultsHref);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("results.ballot.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const requireValid = () => {
    setShowErrors(true);
    return errors.length === 0;
  };

  const save = (confirmed: boolean) => {
    if (!requireValid()) return;
    void run(() => submitBallot(buildSubmission(confirmed)), "done");
  };

  const blindCheck = () => {
    if (checkState.kind !== "blind-check" || !requireValid()) return;
    const pending = checkState.pending;
    const second = buildSubmission(true, { checksVersion: pending.version });
    const found = diffBallots(pending, second, rules.format);
    if (found.length === 0) {
      void run(() => submitBallot(second), "done");
      return;
    }
    setCandidate(second);
    setDifferences(found);
  };

  const portalBallotCount = debateBallots.filter((ballot) => ballot.submitterType === "judge" && !ballot.discarded).length;
  const visibleErrors = showErrors ? errors : [];
  const errorId = visibleErrors.length > 0 ? ERROR_SUMMARY_ID : undefined;
  const motionLabel = (motion: { reference?: string; text: string }) =>
    `${motion.reference ? `${motion.reference}: ` : ""}${motion.text}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <BackToResults href={resultsHref} />

      <PageHeader
        title={t("results.ballot.title")}
        description={round?.name}
        meta={
          <>
            <span className="text-xs text-fg-muted">
              {t("results.ballot.venue", { venue: debate.venueName || "—" })}
            </span>
            <span className="text-xs text-fg-muted">
              {t("results.ballot.chair", { chair: debate.adjudicators?.chairName || t("results.ballot.unassigned") })}
            </span>
            {voting && <Badge tone="info">{t("results.ballot.votingBallots")}</Badge>}
            {confirmedBallot ? (
              <StatusPill tone="success">{t("results.ballot.resultConfirmed", { version: confirmedBallot.version })}</StatusPill>
            ) : (
              <StatusPill tone="warning">{t("results.ballot.noConfirmedResult")}</StatusPill>
            )}
          </>
        }
        actions={
          <Button variant="secondary" className="no-print" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            {t("results.ballot.print")}
          </Button>
        }
      />

      <CheckBanner state={checkState} />

      {message && (
        <Alert tone="danger" role="alert">
          <span className="text-fg">{message}</span>
        </Alert>
      )}

      <Card>
        <CardHeader icon={<FileCheck2 aria-hidden="true" />} title={t("results.ballot.formTitle")} />
        <CardBody>
          <form onSubmit={(event) => event.preventDefault()} className="space-y-6">
            {sidePicker}
            {preferences?.ballotIntroExplanation?.trim() && (
              <Alert tone="info" title={t("results.ballot.instructions")}>
                <span className="whitespace-pre-line text-xs">{preferences.ballotIntroExplanation}</span>
              </Alert>
            )}

            {(usingMotions || (!isBP && preferences?.enableForfeits)) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {usingMotions && (
                  <Select
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <Lightbulb className="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />
                        {t("results.ballot.motion")}
                      </span>
                    }
                    value={entry.motionId || ""}
                    onChange={(event) => updateEntry({ motionId: event.target.value })}
                  >
                    <option value="">{t("results.ballot.selectMotion")}</option>
                    {availableMotions.map((motion) => (
                      <option key={motion.id} value={motion.id}>{motionLabel(motion)}</option>
                    ))}
                  </Select>
                )}
                {!isBP && preferences?.enableForfeits && (
                  <Select
                    label={t("results.ballot.forfeit")}
                    value={entry.forfeitSide || ""}
                    onChange={(event) => updateEntry({ forfeitSide: (event.target.value || undefined) as DebateSide | undefined })}
                  >
                    <option value="">{t("results.ballot.noForfeit")}</option>
                    {sides.map((side) => (
                      <option key={side} value={side}>
                        {t("results.ballot.forfeitOption", { team: teamName(side), side: label(side) })}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            )}

            {usingMotions && preferences?.enableMotionVetoes && availableMotions.length > 1 && (
              <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
                <legend className="px-1 text-xs font-semibold text-fg">{t("results.ballot.vetoes")}</legend>
                {sides.map((side) => (
                  <Select
                    key={side}
                    label={t("results.ballot.vetoedBy", { team: teamName(side) })}
                    value={entry.vetoes?.[side] || ""}
                    onChange={(event) => updateEntry({ vetoes: { ...entry.vetoes, [side]: event.target.value } })}
                  >
                    <option value="">{t("results.ballot.noVeto")}</option>
                    {availableMotions.filter((motion) => motion.id !== entry.motionId).map((motion) => (
                      <option key={motion.id} value={motion.id}>{motionLabel(motion)}</option>
                    ))}
                  </Select>
                ))}
              </fieldset>
            )}

            {recordsMotionPreferences && (
              <MotionPreferencesFields
                sides={sides}
                teamNames={Object.fromEntries(sides.map((side) => [side, debate.teams[side]?.teamName || side]))}
                motions={availableMotions}
                value={entry.motionPreferences || {}}
                onChange={(motionPreferences) => updateEntry({ motionPreferences })}
              />
            )}

            {!entry.forfeitSide && voting && entry.sheets && (
              <VotingSheets
                sheets={entry.sheets}
                activeSheet={activeSheet}
                onSelectSheet={setActiveSheet}
                rules={rules}
                sides={sides}
                rosters={rosters}
                teamNames={Object.fromEntries(sides.map((side) => [side, teamName(side)]))}
                onChangeSide={updateSheetSide}
                scored={scored}
                declaresWinner={!scored || winnerMode !== "none"}
                onDeclareWinner={(sheetIndex, winner) =>
                  updateEntry({ sheets: (entry.sheets || []).map((sheet, index) => (index === sheetIndex ? { ...sheet, declaredWinner: winner } : sheet)) })
                }
                errorId={errorId}
                portalBallotCount={portalBallotCount}
                onFillFromPortal={() => {
                  const result = sheetsFromPortalBallots(entry.sheets || [], debateBallots, debate.id);
                  updateEntry({ sheets: result.sheets });
                  // Individual ballots must agree on speakers, motion and vetoes (Tabbycat's merge check).
                  const merge = mergeIndividualBallots(debate, debateBallots, rules);
                  setMessage(
                    result.filled === 0
                      ? t("results.ballot.portal.none")
                      : merge.errors.length > 0
                        ? t("results.ballot.portal.mergeErrors", { errors: merge.errors.join(" ") })
                        : merge.missingAdjudicatorIds.length > 0
                          ? plural("results.ballot.portal.missing", merge.missingAdjudicatorIds.length)
                          : ""
                  );
                }}
              />
            )}

            {!entry.forfeitSide && !voting && !scored && (
              <Alert tone="info">{t("results.ballot.resultsOnly")}</Alert>
            )}
            {!entry.forfeitSide && !voting && (
              <div className="space-y-4">
                {sides.map((side) => {
                  const headingId = `consensus-${side}-heading`;
                  const name = debate.teams[side]?.teamName || t("results.ballot.unassignedTeam");
                  return (
                    <section key={side} aria-labelledby={headingId} className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
                      <div className="flex flex-col justify-between gap-2 border-b border-border pb-2 sm:flex-row sm:items-center">
                        <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-fg">
                          <SideBadge side={side} preferences={preferences} />
                          {name}
                        </h3>
                        {winnerFromScores ? (
                          isBP ? (
                            <span className="text-xs font-medium text-fg-muted">
                              {derivedRanks[side] !== undefined
                                ? t("results.ballot.rankFromTotals", { rank: derivedRanks[side] })
                                : t("results.ballot.rankFromTotalsUnknown")}
                            </span>
                          ) : derivedRanks[side] === 1 ? (
                            <StatusPill tone="success">{t("results.ballot.winnerHigherTotal")}</StatusPill>
                          ) : null
                        ) : isBP ? (
                          <div className="flex items-center gap-2">
                            <label htmlFor={`rank-${side}`} className="text-xs font-medium text-fg-muted">
                              {t("results.ballot.rank")}
                            </label>
                            <Select
                              id={`rank-${side}`}
                              aria-label={t("results.ballot.rankLabel", { team: name })}
                              value={entry.ranks?.[side] ?? ""}
                              onChange={(event) => updateEntry({ ranks: { ...entry.ranks, [side]: Number(event.target.value) } })}
                              className="h-7 w-auto text-xs font-semibold"
                            >
                              {BP_RANK_KEYS.map((key, index) => (
                                <option key={key} value={index + 1}>{t(key)}</option>
                              ))}
                            </Select>
                          </div>
                        ) : (
                          <label className="flex items-center gap-2 text-xs font-medium text-fg">
                            <input
                              type="radio"
                              name="winner"
                              className={radioClasses}
                              checked={entry.ranks?.[side] === 1}
                              onChange={() => setWinner(side)}
                              aria-label={t("results.ballot.winnerLabel", { team: name })}
                            />
                            {t("results.ballot.winner")}
                          </label>
                        )}
                      </div>
                      {scored && (
                        <SpeechRows
                          idPrefix={`consensus-${side}`}
                          roster={rosters[side] || []}
                          entries={entry.speakerScores[side] || []}
                          rules={rules}
                          rankCount={rankCount}
                          errorId={errorId}
                          onChange={(speeches) => updateConsensusSide(side, speeches)}
                        />
                      )}
                    </section>
                  );
                })}
              </div>
            )}

            {preview && (
              <ResultPreview
                teamScores={preview.teamScores}
                sides={sides}
                teamNames={Object.fromEntries(sides.map((side) => [side, teamName(side)]))}
                sideNames={Object.fromEntries(sides.map((side) => [side, label(side)]))}
                forfeit={entry.forfeitSide}
                scored={!preview.noSpeakerScores}
              />
            )}

            {visibleErrors.length > 0 && (
              <div id={ERROR_SUMMARY_ID} role="alert">
                <Alert tone="danger" title={plural("results.ballot.errorsTitle", visibleErrors.length)}>
                  <ul className="list-disc space-y-0.5 ps-4 text-xs text-fg">
                    {visibleErrors.map((error) => <li key={error}>{error}</li>)}
                  </ul>
                </Alert>
              </div>
            )}

            <div className="no-print flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => router.push(resultsHref)}>
                {t("common.cancel")}
              </Button>
              {checkState.kind === "single" && (
                <>
                  <Button variant="secondary" disabled={busy} onClick={() => save(false)}>
                    <Save aria-hidden="true" />
                    {t("results.ballot.saveDraft")}
                  </Button>
                  <Button variant="primary" disabled={busy} onClick={() => save(true)}>
                    <CheckCircle2 aria-hidden="true" />
                    {t("results.ballot.saveAndConfirm")}
                  </Button>
                </>
              )}
              {checkState.kind === "first-entry" && (
                <Button variant="primary" disabled={busy} onClick={() => save(false)}>
                  <Save aria-hidden="true" />
                  {t("results.ballot.saveForChecking")}
                </Button>
              )}
              {checkState.kind === "review" && (
                dirty ? (
                  <Button variant="primary" disabled={busy} onClick={() => save(false)}>
                    <Save aria-hidden="true" />
                    {t("results.ballot.saveCorrected")}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      className="text-danger"
                      disabled={busy}
                      onClick={() => void run(() => discardBallot(checkState.pending.id), "done")}
                    >
                      {t("results.ballot.discardVersion", { version: checkState.pending.version })}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={busy || errors.length > 0}
                      onClick={() => void run(() => confirmBallot(checkState.pending.id, debate.id), "done")}
                    >
                      <ShieldCheck aria-hidden="true" />
                      {t("results.ballot.confirmVersion", { version: checkState.pending.version })}
                    </Button>
                  </>
                )
              )}
              {checkState.kind === "blind-check" && (
                <Button variant="primary" disabled={busy} onClick={blindCheck}>
                  <ShieldCheck aria-hidden="true" />
                  {t("results.ballot.checkAgainst", { version: checkState.pending.version })}
                </Button>
              )}
              {checkState.kind === "awaiting-other" && (
                <Button variant="primary" disabled={busy || !dirty} onClick={() => save(false)}>
                  <Save aria-hidden="true" />
                  {t("results.ballot.saveNewVersion")}
                </Button>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      <BallotHistory
        ballots={debateBallots}
        hideScores={checkState.kind === "blind-check"}
        preferences={preferences}
        busy={busy}
        canConfirm={(ballot) =>
          checkState.kind === "single" || !user?.uid || ballot.submitterId !== user.uid
        }
        onLoad={(ballot) => blank && loadEntry(entryFromBallot(ballot, blank, rules))}
        onConfirm={(ballot) => void run(() => confirmBallot(ballot.id, debate.id))}
        onDiscard={(ballot) => {
          if (ballot.confirmed) {
            setPendingDiscard(ballot);
            return;
          }
          void run(() => discardBallot(ballot.id));
        }}
      />

      {sideChangeDialog}

      {pendingDiscard && (
        <ConfirmActionDialog
          title={t("results.ballot.discardConfirmed.title", { version: pendingDiscard.version })}
          description={t("results.ballot.discardConfirmed.description")}
          confirmLabel={t("results.ballot.discardConfirmed.action", { version: pendingDiscard.version })}
          variant="danger"
          onCancel={() => setPendingDiscard(null)}
          onConfirm={() => {
            const ballot = pendingDiscard;
            setPendingDiscard(null);
            void run(() => discardBallot(ballot.id));
          }}
        />
      )}

      {differences && candidate && checkState.kind === "blind-check" && (
        <BallotDiffDialog
          differences={differences}
          firstLabel={t("results.ballot.diff.firstEntry", { version: checkState.pending.version })}
          secondLabel={t("results.ballot.diff.yourEntry")}
          busy={busy}
          onClose={() => setDifferences(null)}
          onKeepFirst={() => void run(() => confirmBallot(checkState.pending.id, debate.id), "done")}
          onKeepSecond={() => void run(() => submitBallot(candidate), "done")}
        />
      )}
    </div>
  );
}

function CheckBanner({ state }: { state: ReturnType<typeof resolveCheckState> }) {
  const { t } = useI18n();
  if (state.kind === "single") return null;
  if (state.kind === "first-entry") {
    return (
      <Alert tone="info" title={t("results.ballot.check.doubleEntryTitle")}>
        {t("results.ballot.check.firstEntry")}
      </Alert>
    );
  }
  const who = state.pending.submitterName || t("results.ballot.check.anotherUser");
  const version = state.pending.version;
  const text =
    state.kind === "review"
      ? t("results.ballot.check.review", { version, name: who })
      : state.kind === "blind-check"
        ? t("results.ballot.check.blind", { version })
        : t("results.ballot.check.awaitingOther", { version });
  return (
    <Alert tone="warning" title={t("results.ballot.check.doubleEntryTitle")}>
      {text}
    </Alert>
  );
}

function VotingSheets(props: {
  sheets: AdjudicatorSheet[];
  activeSheet: number;
  onSelectSheet: (index: number) => void;
  rules: BallotRules;
  sides: DebateSide[];
  rosters: Partial<Record<DebateSide, { id: string; name: string }[]>>;
  teamNames: Record<string, string>;
  onChangeSide: (sheetIndex: number, side: DebateSide, speeches: SpeakerScoreEntry[]) => void;
  portalBallotCount: number;
  onFillFromPortal: () => void;
  scored: boolean;
  declaresWinner: boolean;
  onDeclareWinner: (sheetIndex: number, winner: DebateSide) => void;
  errorId?: string;
}) {
  const { t } = useI18n();
  const { sheets, activeSheet, onSelectSheet, rules, sides, rosters, teamNames, onChangeSide, scored, declaresWinner } = props;
  const label = (side: DebateSide) => sideLabel(side, rules.preferences);
  if (sheets.length === 0) {
    return <Alert tone="warning">{t("results.ballot.sheets.noChair")}</Alert>;
  }
  const sheet = sheets[Math.min(activeSheet, sheets.length - 1)];
  const sheetIndex = sheets.indexOf(sheet);
  const tabsId = "adjudicator-sheets";
  return (
    <section className="space-y-3" aria-label={t("results.ballot.sheets.label")}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Tabs
          id={tabsId}
          ariaLabel={t("results.ballot.sheets.label")}
          value={String(sheetIndex)}
          onValueChange={(value) => onSelectSheet(Number(value))}
          className="min-w-0 flex-1"
          items={sheets.map((item, index) => {
            const outcome = sheetOutcome(item, rules);
            const winner = outcome.winner && Number.isFinite(outcome.totals[outcome.winner]) ? outcome.winner : undefined;
            return {
              value: String(index),
              icon: <Users aria-hidden="true" />,
              label: (
                <>
                  {item.adjudicatorName}
                  {index === 0 && (
                    <span className="text-[11px] font-medium uppercase text-fg-muted">{t("role.chair")}</span>
                  )}
                  {winner && (
                    <span className="text-[11px] font-medium text-success">
                      {t("results.ballot.sheets.tabWinner", { side: label(winner) })}
                    </span>
                  )}
                </>
              ),
            };
          })}
        />
        {props.portalBallotCount > 0 && (
          <Button size="sm" variant="ghost" onClick={props.onFillFromPortal}>
            {t("results.ballot.sheets.fillFromPortal", { count: props.portalBallotCount })}
          </Button>
        )}
      </div>
      <TabPanel id={tabsId} value={String(sheetIndex)} className="space-y-3">
        {sheetIndex > 0 && scored && (
          <p className="text-xs text-fg-muted">{t("results.ballot.sheets.sharedOrder")}</p>
        )}
        {declaresWinner && (
          <fieldset className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-3">
            <legend className="px-1 text-xs font-semibold text-fg">
              {sheet.adjudicatorName
                ? t("results.ballot.sheets.votedFor", { name: sheet.adjudicatorName })
                : t("results.ballot.sheets.votedForUnnamed")}
            </legend>
            {sides.map((side) => (
              <label key={side} className="flex items-center gap-2 text-[13px] font-medium text-fg">
                <input
                  type="radio"
                  className={radioClasses}
                  name={`declared-winner-${sheet.adjudicatorId}`}
                  checked={sheet.declaredWinner === side}
                  onChange={() => props.onDeclareWinner(sheetIndex, side)}
                />
                {t("results.ballot.teamWithSide", { team: teamNames[side], side: label(side) })}
              </label>
            ))}
          </fieldset>
        )}
        {scored && sides.map((side) => {
          const headingId = `sheet-${sheet.adjudicatorId}-${side}-heading`;
          return (
            <section key={side} aria-labelledby={headingId} className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
              <h3 id={headingId} className="flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold text-fg">
                <SideBadge side={side} preferences={rules.preferences} />
                {teamNames[side]}
              </h3>
              <SpeechRows
                idPrefix={`sheet-${sheet.adjudicatorId}-${side}`}
                roster={rosters[side] || []}
                entries={sheet.speakerScores[side] || []}
                rules={rules}
                lockSpeakers={sheetIndex > 0}
                errorId={props.errorId}
                onChange={(speeches) => onChangeSide(sheetIndex, side, speeches)}
              />
            </section>
          );
        })}
      </TabPanel>
    </section>
  );
}

function ResultPreview(props: {
  teamScores: BallotSubmission["teamScores"];
  sides: DebateSide[];
  teamNames: Record<string, string>;
  sideNames: Record<string, string>;
  forfeit?: DebateSide;
  scored: boolean;
}) {
  const { t, plural } = useI18n();
  const formatScore = useFormatScore();
  const ordered = [...props.sides].sort((left, right) => (props.teamScores[left]?.rank ?? 9) - (props.teamScores[right]?.rank ?? 9));
  return (
    <Alert tone="success" title={t("results.ballot.preview.title")}>
      {props.forfeit ? (
        <p className="text-fg">
          {t("results.ballot.preview.forfeit", {
            forfeiter: props.teamNames[props.forfeit],
            winner: props.teamNames[ordered[0]],
          })}
        </p>
      ) : (
        <ol className="space-y-0.5 text-fg">
          {ordered.map((side) => {
            const score = props.teamScores[side];
            const stats = [
              plural("results.ballot.preview.points", score.points),
              ...(props.scored ? [t("results.ballot.preview.total", { total: formatScore(score.totalSpeakerScore) })] : []),
              ...(score.margin !== undefined
                ? [t("results.ballot.preview.margin", { margin: `${score.margin > 0 ? "+" : ""}${formatScore(score.margin)}` })]
                : []),
              ...(score.votes !== undefined ? [plural("results.ballot.preview.votes", score.votes)] : []),
            ];
            return (
              <li key={side}>
                <span className="font-medium">{t("results.ballot.teamWithSide", { team: props.teamNames[side], side: props.sideNames[side] })}</span>
                {" — "}
                {stats.join(" · ")}
              </li>
            );
          })}
        </ol>
      )}
    </Alert>
  );
}
