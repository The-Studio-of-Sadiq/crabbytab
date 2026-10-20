"use client";

import { formatScore } from "@/lib/scoreDisplay";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileCheck2, Lightbulb, Printer, Save, ShieldCheck, Users } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useAuth } from "@/contexts/AuthContext";
import { SideBadge } from "@/components/ui/SideBadge";
import { SpeechRows } from "@/features/tournament/components/ballot/SpeechRows";
import { BallotHistory } from "@/features/tournament/components/ballot/BallotHistory";
import { BallotDiffDialog } from "@/features/tournament/components/ballot/BallotDiffDialog";
import {
  blankEntry,
  entryFromBallot,
  nextBallotVersion,
  resolveCheckState,
  roundMotions,
  sheetsFromPortalBallots,
} from "@/features/tournament/application/ballotEntry";
import {
  ballotSides,
  buildBallotResult,
  diffBallots,
  sheetOutcome,
  usesVotingBallots,
  validateBallotEntry,
  type BallotDifference,
  type BallotEntry,
  type BallotRules,
} from "@/lib/ballots/result";
import type { AdjudicatorSheet, BallotSubmission, DebateSide, SpeakerScoreEntry } from "@/types";
import { arrangeDebateSides, isSidePermutation, sidesChosenOnBallot } from "@/lib/draw/manualSides";

export default function BallotEntryPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentSlug = params.tournamentSlug as string;
  const roundSeq = parseInt(params.roundSeq as string, 10);
  const debateId = params.debateId as string;

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

  const errors = useMemo(
    () =>
      entry
        ? validateBallotEntry(entry, { ...rules, rosters, roundMotionIds: availableMotions.map((motion) => motion.id) })
        : [],
    [entry, rules, rosters, availableMotions]
  );
  const preview = useMemo(() => {
    if (!entry || errors.length > 0) return null;
    try {
      return buildBallotResult(entry, teamIds, debate?.adjudicators?.chairId, rules);
    } catch {
      return null;
    }
  }, [entry, errors, teamIds, debate?.adjudicators?.chairId, rules]);

  if (!debate || !tournament) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500">Debate not found.</p>
        <button onClick={() => router.back()} className="mt-4 rounded bg-blue-600 px-4 py-2 text-xs font-semibold text-white">
          Go Back
        </button>
      </div>
    );
  }

  if (debate.byeTeamId) {
    const byeTeam = Object.values(debate.teams).find((slot) => slot?.teamId === debate.byeTeamId);
    return (
      <div className="mx-auto max-w-4xl space-y-6 pb-12">
        <button onClick={() => router.push(`/${tournamentSlug}/results`)} className="inline-flex items-center space-x-1 text-xs font-semibold text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Results Overview</span>
        </button>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-6">
          <h2 className="text-lg font-bold text-gray-900">Bye — no ballot required</h2>
          <p className="mt-2 text-sm text-gray-700">
            {byeTeam?.teamName || "Team"}: {debate.byeResult === "win" ? "full win awarded with prior average speaker scores." : "absent; no standings result is added."}
          </p>
        </div>
      </div>
    );
  }

  const sidePicker = choosesSides && drawnDebate ? (
    <fieldset className="space-y-2 rounded border border-blue-200 bg-blue-50/60 p-3">
      <legend className="px-1 text-xs font-bold text-gray-800">Sides (chosen at the debate)</legend>
      <p className="text-[11px] text-gray-600">This round&apos;s sides were not fixed by the draw. Record which team was Affirmative.</p>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-6">
        {[drawnDebate.teams.AFF, drawnDebate.teams.NEG].map((slot) => slot?.teamId && (
          <label key={slot.teamId} className="flex items-center gap-2 text-xs font-semibold text-gray-800">
            <input
              type="radio"
              name="affirmative-team"
              checked={affTeamId === slot.teamId}
              onChange={() => {
                if (affTeamId && entry && JSON.stringify(entry) !== initialSnapshot &&
                  !window.confirm("Changing the sides clears the scores entered so far. Continue?")) return;
                setAffTeamId(slot.teamId);
                setReloadBlank(true);
              }}
            />
            {slot.teamName} was Affirmative
          </label>
        ))}
      </div>
    </fieldset>
  ) : null;

  if (!entry) {
    return sidePicker && !affTeamId ? (
      <div className="mx-auto max-w-4xl space-y-4 pb-12">
        <button onClick={() => router.push(`/${tournamentSlug}/results`)} className="inline-flex items-center space-x-1 text-xs font-semibold text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Results Overview</span>
        </button>
        <h2 className="text-lg font-bold text-gray-900">Debate Ballot Entry &bull; {debate.venueName}</h2>
        {sidePicker}
      </div>
    ) : <div className="p-8 text-center text-sm text-gray-500">Loading ballot…</div>;
  }

  const dirty = JSON.stringify(entry) !== initialSnapshot;
  const chairId = debate.adjudicators?.chairId;
  const userLabel = user?.email || "Tab room";

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

  const setWinner = (winner: DebateSide) =>
    updateEntry({ ranks: Object.fromEntries(sides.map((side) => [side, side === winner ? 1 : 2])) });

  const buildSubmission = (confirmed: boolean, extra: Partial<BallotSubmission> = {}): BallotSubmission => {
    const result = buildBallotResult(entry, teamIds, chairId, rules);
    const version = nextBallotVersion(ballots, debate.id);
    const motion = motions.find((item) => item.id === entry.motionId);
    const vetoes = Object.fromEntries(Object.entries(entry.vetoes || {}).filter(([, motionId]) => Boolean(motionId)));
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
      ...(entry.motionId ? { motionId: entry.motionId, motionText: motion?.text || debate.motionText } : {}),
      speakerScores: result.speakerScores,
      teamScores: result.teamScores,
      ...(result.sheets ? { sheets: result.sheets } : {}),
      ...(Object.keys(vetoes).length > 0 ? { vetoes } : {}),
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
      if (done) router.push(`/${tournamentSlug}/results`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the ballot.");
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

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div className="no-print flex items-center justify-between border-b border-[#d0d7de] pb-3">
        <button onClick={() => router.push(`/${tournamentSlug}/results`)} className="inline-flex items-center space-x-1 text-xs font-semibold text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Results Overview</span>
        </button>
        <span className="text-xs font-semibold text-gray-500">{round?.name} &bull; {debate.venueName}</span>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={() => window.print()} className="no-print inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
          <Printer className="h-4 w-4" />
          Print Ballot
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#d0d7de] bg-white shadow-xs">
        <div className="border-b border-[#d0d7de] bg-[#f6f8fa] p-4">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <h2 className="flex items-center space-x-2 text-lg font-bold text-gray-900">
                <FileCheck2 className="h-5 w-5 text-blue-600" />
                <span>Debate Ballot Entry</span>
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Venue: <span className="font-bold text-gray-800">{debate.venueName}</span> &bull; Chair:{" "}
                <span className="font-bold text-gray-800">{debate.adjudicators?.chairName || "Unassigned"}</span>
                {voting && <> &bull; <span className="font-semibold">Voting ballots</span></>}
              </p>
            </div>
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${confirmedBallot ? "border border-emerald-300 bg-emerald-100 text-emerald-800" : "border border-amber-300 bg-amber-100 text-amber-800"}`}>
              {confirmedBallot ? `Result confirmed (v${confirmedBallot.version})` : "No confirmed result"}
            </span>
          </div>
        </div>

        <CheckBanner state={checkState} />

        {message && (
          <div role="alert" className="m-4 flex items-center space-x-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        <form onSubmit={(event) => event.preventDefault()} className="space-y-6 p-5">
          {sidePicker}
          {preferences?.ballotIntroExplanation?.trim() && (
            <div className="space-y-1 rounded-md border border-blue-200 bg-blue-50/80 p-3.5 text-xs leading-relaxed text-blue-900">
              <div className="font-bold text-blue-950">Ballot instructions</div>
              <div className="whitespace-pre-line text-[11px]">{preferences.ballotIntroExplanation}</div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-bold text-gray-700">
              <span className="mb-1 flex items-center gap-1.5"><Lightbulb className="h-3.5 w-3.5 text-amber-500" />Motion debated</span>
              <select value={entry.motionId || ""} onChange={(event) => updateEntry({ motionId: event.target.value })} className="w-full rounded border border-gray-300 px-3 py-2 text-xs font-medium">
                <option value="">— Select motion —</option>
                {availableMotions.map((motion) => (
                  <option key={motion.id} value={motion.id}>{motion.reference ? `${motion.reference}: ` : ""}{motion.text}</option>
                ))}
              </select>
            </label>
            {!isBP && preferences?.enableForfeits && (
              <label className="block text-xs font-bold text-gray-700">
                <span className="mb-1 block">Forfeit</span>
                <select
                  value={entry.forfeitSide || ""}
                  onChange={(event) => updateEntry({ forfeitSide: (event.target.value || undefined) as DebateSide | undefined })}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-xs font-medium"
                >
                  <option value="">No forfeit — debate took place</option>
                  {sides.map((side) => (
                    <option key={side} value={side}>{debate.teams[side]?.teamName || side} ({side}) forfeited</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {preferences?.enableMotionVetoes && availableMotions.length > 1 && (
            <fieldset className="grid gap-3 rounded border border-gray-200 p-3 sm:grid-cols-2">
              <legend className="px-1 text-xs font-bold text-gray-700">Motion vetoes</legend>
              {sides.map((side) => (
                <label key={side} className="text-xs font-semibold text-gray-700">
                  <span className="mb-1 block">{debate.teams[side]?.teamName || side} vetoed</span>
                  <select
                    value={entry.vetoes?.[side] || ""}
                    onChange={(event) => updateEntry({ vetoes: { ...entry.vetoes, [side]: event.target.value } })}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
                  >
                    <option value="">No veto recorded</option>
                    {availableMotions.filter((motion) => motion.id !== entry.motionId).map((motion) => (
                      <option key={motion.id} value={motion.id}>{motion.reference ? `${motion.reference}: ` : ""}{motion.text}</option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
          )}

          {!entry.forfeitSide && voting && entry.sheets && (
            <VotingSheets
              sheets={entry.sheets}
              activeSheet={activeSheet}
              onSelectSheet={setActiveSheet}
              rules={rules}
              sides={sides}
              rosters={rosters}
              teamNames={Object.fromEntries(sides.map((side) => [side, debate.teams[side]?.teamName || side]))}
              onChangeSide={updateSheetSide}
              portalBallotCount={portalBallotCount}
              onFillFromPortal={() => {
                const result = sheetsFromPortalBallots(entry.sheets || [], debateBallots, debate.id);
                updateEntry({ sheets: result.sheets });
                setMessage(result.filled > 0 ? "" : "No adjudicator has submitted a ballot through their private URL yet.");
              }}
            />
          )}

          {!entry.forfeitSide && !voting && (
            <div className="space-y-5">
              {sides.map((side) => (
                <div key={side} className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                  <div className="flex flex-col justify-between gap-2 border-b border-gray-200 pb-2 sm:flex-row sm:items-center">
                    <div className="flex items-center space-x-2">
                      <SideBadge side={side} />
                      <span className="text-sm font-bold text-gray-900">{debate.teams[side]?.teamName || "Unassigned team"}</span>
                    </div>
                    {isBP ? (
                      <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                        Rank
                        <select
                          value={entry.ranks?.[side] ?? ""}
                          onChange={(event) => updateEntry({ ranks: { ...entry.ranks, [side]: Number(event.target.value) } })}
                          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-gray-900"
                        >
                          <option value={1}>1st (3 pts)</option>
                          <option value={2}>2nd (2 pts)</option>
                          <option value={3}>3rd (1 pt)</option>
                          <option value={4}>4th (0 pts)</option>
                        </select>
                      </label>
                    ) : (
                      <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                        <input type="radio" name="winner" checked={entry.ranks?.[side] === 1} onChange={() => setWinner(side)} />
                        Winner
                      </label>
                    )}
                  </div>
                  <SpeechRows
                    idPrefix={`consensus-${side}`}
                    roster={rosters[side] || []}
                    entries={entry.speakerScores[side] || []}
                    rules={rules}
                    onChange={(speeches) => updateConsensusSide(side, speeches)}
                  />
                </div>
              ))}
            </div>
          )}

          {preview && <ResultPreview teamScores={preview.teamScores} sides={sides} teamNames={Object.fromEntries(sides.map((side) => [side, debate.teams[side]?.teamName || side]))} forfeit={entry.forfeitSide} />}

          {visibleErrors.length > 0 && (
            <ul role="alert" className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {visibleErrors.map((error) => <li key={error}>• {error}</li>)}
            </ul>
          )}

          <div className="no-print flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 pt-3">
            <button type="button" onClick={() => router.push(`/${tournamentSlug}/results`)} className="rounded bg-gray-100 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200">
              Cancel
            </button>
            {checkState.kind === "single" && (
              <>
                <button type="button" disabled={busy} onClick={() => save(false)} className="inline-flex items-center gap-1.5 rounded border border-blue-600 px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                  <Save className="h-3.5 w-3.5" />Save draft
                </button>
                <button type="button" disabled={busy} onClick={() => save(true)} className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                  <CheckCircle2 className="h-3.5 w-3.5" />Save and confirm
                </button>
              </>
            )}
            {checkState.kind === "first-entry" && (
              <button type="button" disabled={busy} onClick={() => save(false)} className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                <Save className="h-3.5 w-3.5" />Save for checking
              </button>
            )}
            {checkState.kind === "review" && (
              dirty ? (
                <button type="button" disabled={busy} onClick={() => save(false)} className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                  <Save className="h-3.5 w-3.5" />Save corrected version (needs another check)
                </button>
              ) : (
                <>
                  <button type="button" disabled={busy} onClick={() => void run(() => discardBallot(checkState.pending.id), "done")} className="rounded border border-red-300 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
                    Discard v{checkState.pending.version}
                  </button>
                  <button type="button" disabled={busy || errors.length > 0} onClick={() => void run(() => confirmBallot(checkState.pending.id, debate.id), "done")} className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                    <ShieldCheck className="h-3.5 w-3.5" />Confirm v{checkState.pending.version}
                  </button>
                </>
              )
            )}
            {checkState.kind === "blind-check" && (
              <button type="button" disabled={busy} onClick={blindCheck} className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                <ShieldCheck className="h-3.5 w-3.5" />Check against v{checkState.pending.version}
              </button>
            )}
            {checkState.kind === "awaiting-other" && (
              <button type="button" disabled={busy || !dirty} onClick={() => save(false)} className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                <Save className="h-3.5 w-3.5" />Save as new version
              </button>
            )}
          </div>
        </form>
      </div>

      <BallotHistory
        ballots={debateBallots}
        hideScores={checkState.kind === "blind-check"}
        busy={busy}
        canConfirm={(ballot) =>
          checkState.kind === "single" || !user?.uid || ballot.submitterId !== user.uid
        }
        onLoad={(ballot) => blank && loadEntry(entryFromBallot(ballot, blank, rules))}
        onConfirm={(ballot) => void run(() => confirmBallot(ballot.id, debate.id))}
        onDiscard={(ballot) => {
          if (ballot.confirmed && !window.confirm(`Discard the confirmed result (v${ballot.version})? The debate will have no result until another version is confirmed.`)) return;
          void run(() => discardBallot(ballot.id));
        }}
      />

      {differences && candidate && checkState.kind === "blind-check" && (
        <BallotDiffDialog
          differences={differences}
          firstLabel={`First entry (v${checkState.pending.version})`}
          secondLabel="Your entry"
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
  if (state.kind === "single" || state.kind === "first-entry") {
    return state.kind === "first-entry" ? (
      <p className="mx-4 mt-4 rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        Double entry is on: a different person must check this ballot before it counts.
      </p>
    ) : null;
  }
  const who = state.pending.submitterName || "another user";
  const text =
    state.kind === "review"
      ? `Version ${state.pending.version}, entered by ${who}, is waiting for your check. Compare it with the paper ballot, then confirm or discard it.`
      : state.kind === "blind-check"
        ? `Blind check: enter the paper ballot again without looking at version ${state.pending.version}. Both entries are compared when you submit.`
        : `You entered version ${state.pending.version}. A different person must check it before it counts.`;
  return (
    <p className="mx-4 mt-4 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      {text}
    </p>
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
}) {
  const { sheets, activeSheet, onSelectSheet, rules, sides, rosters, teamNames, onChangeSide } = props;
  if (sheets.length === 0) {
    return <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Allocate a chair before entering voting ballots.</p>;
  }
  const sheet = sheets[Math.min(activeSheet, sheets.length - 1)];
  const sheetIndex = sheets.indexOf(sheet);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Adjudicator scoresheets" className="flex flex-wrap gap-1">
          {sheets.map((item, index) => {
            const outcome = sheetOutcome(item, rules);
            return (
              <button
                key={item.adjudicatorId}
                type="button"
                role="tab"
                aria-selected={index === sheetIndex}
                onClick={() => onSelectSheet(index)}
                className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-semibold ${index === sheetIndex ? "border-blue-600 bg-blue-50 text-blue-800" : "border-gray-300 bg-white text-gray-700"}`}
              >
                <Users className="h-3.5 w-3.5" />
                {item.adjudicatorName}
                {index === 0 && <span className="text-[10px] font-bold uppercase text-gray-500">chair</span>}
                {outcome.winner && Number.isFinite(outcome.totals[outcome.winner]) && (
                  <span className="text-[10px] font-bold text-emerald-700">→ {outcome.winner}</span>
                )}
              </button>
            );
          })}
        </div>
        {props.portalBallotCount > 0 && (
          <button type="button" onClick={props.onFillFromPortal} className="text-xs font-semibold text-blue-700 hover:underline">
            Fill from private-URL ballots ({props.portalBallotCount})
          </button>
        )}
      </div>
      {sheetIndex > 0 && (
        <p className="text-[11px] text-gray-500">Speaker order is set on the chair&apos;s sheet and shared by every scoresheet.</p>
      )}
      {sides.map((side) => (
        <div key={side} className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <div className="flex items-center space-x-2 border-b border-gray-200 pb-2">
            <SideBadge side={side} />
            <span className="text-sm font-bold text-gray-900">{teamNames[side]}</span>
          </div>
          <SpeechRows
            idPrefix={`sheet-${sheet.adjudicatorId}-${side}`}
            roster={rosters[side] || []}
            entries={sheet.speakerScores[side] || []}
            rules={rules}
            lockSpeakers={sheetIndex > 0}
            onChange={(speeches) => onChangeSide(sheetIndex, side, speeches)}
          />
        </div>
      ))}
    </section>
  );
}

function ResultPreview(props: {
  teamScores: BallotSubmission["teamScores"];
  sides: DebateSide[];
  teamNames: Record<string, string>;
  forfeit?: DebateSide;
}) {
  const ordered = [...props.sides].sort((left, right) => (props.teamScores[left]?.rank ?? 9) - (props.teamScores[right]?.rank ?? 9));
  return (
    <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
      <div className="mb-1 font-bold">Result to be recorded</div>
      {props.forfeit ? (
        <p>{props.teamNames[props.forfeit]} forfeited; {props.teamNames[ordered[0]]} receives the win. No speaker scores are recorded.</p>
      ) : (
        <ol className="space-y-0.5">
          {ordered.map((side) => {
            const score = props.teamScores[side];
            return (
              <li key={side}>
                <span className="font-semibold">{props.teamNames[side]}</span> ({side}) — {score.points} pt{score.points === 1 ? "" : "s"}, total {formatScore(score.totalSpeakerScore)}
                {score.margin !== undefined && `, margin ${score.margin > 0 ? "+" : ""}${formatScore(score.margin)}`}
                {score.votes !== undefined && `, ${score.votes} vote${score.votes === 1 ? "" : "s"}`}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
