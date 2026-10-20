"use client";

import React, { useId, useMemo, useState } from "react";
import { FlaskConical, MessageSquareHeart, Shuffle } from "lucide-react";
import { useTournament, type RehearsalOutcome } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { randomSeed } from "@/lib/draw/rng";
import { isDemoTournament } from "@/lib/rehearsal/demoTournament";

/**
 * Rehearsal tools (Tabbycat's generateresults / generatefeedback): fill a round with random but
 * valid confirmed ballots or feedback, to practise running a tournament. Every ballot goes through
 * the normal ballot command and round rules; nothing runs automatically. On a tournament that is
 * not a demo tournament each run needs the tournament's short name typed as confirmation, and
 * every run is recorded in the audit log.
 */
export default function RehearsalPage() {
  const { tournament, rounds, isOwnerOrAdmin, loading, simulateRoundResults, simulateRoundFeedback } = useTournament();
  const ids = { round: useId(), seed: useId(), confirm: useId() };
  const drawnRounds = useMemo(
    () => rounds.filter((round) => !round.cancelled && round.drawStatus !== "none").sort((left, right) => left.seq - right.seq),
    [rounds]
  );
  const [roundId, setRoundId] = useState("");
  const [seed, setSeed] = useState(() => String(randomSeed()));
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState<"results" | "feedback" | null>(null);
  const [outcome, setOutcome] = useState<{ kind: "results" | "feedback"; result: RehearsalOutcome } | null>(null);
  const [error, setError] = useState("");

  if (loading) return <p className="p-6 text-sm text-fg-muted">Loading…</p>;
  if (!tournament || !isOwnerOrAdmin) {
    return <p role="alert" className="p-6 text-sm text-danger">Only tournament administrators can use the rehearsal tools.</p>;
  }

  const demo = isDemoTournament(tournament);
  const expectedConfirmation = tournament.shortName || tournament.name;
  const confirmed = demo || confirmation.trim() === expectedConfirmation;
  const selectedRoundId = roundId || drawnRounds[drawnRounds.length - 1]?.id || "";
  const seedNumber = Number(seed);
  const seedValid = /^\d{1,10}$/.test(seed) && seedNumber <= 4294967295;

  const run = async (kind: "results" | "feedback") => {
    if (!selectedRoundId || !confirmed || !seedValid) return;
    setBusy(kind);
    setError("");
    setOutcome(null);
    try {
      const result = kind === "results"
        ? await simulateRoundResults(selectedRoundId, seedNumber)
        : await simulateRoundFeedback(selectedRoundId, seedNumber);
      setOutcome({ kind, result });
      setConfirmation("");
    } catch (runError) {
      // Rule violations (e.g. a completed round) and cancelled overrides arrive here; nothing was saved.
      setError(runError instanceof Error ? runError.message : "The simulation failed. Nothing was saved.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Rehearsal tools"
        description="Fill a round with random but valid results or feedback to rehearse running the tournament."
        meta={demo ? <span className="rounded bg-info-subtle px-2 py-0.5 text-xs font-semibold text-info">Demo tournament</span> : undefined}
      />

      <Alert tone={demo ? "info" : "warning"} title={demo ? "Rehearsal data" : "This is not a demo tournament"}>
        {demo
          ? "Simulated ballots and feedback are confirmed like real ones and marked “Simulated (rehearsal)”."
          : "Simulated ballots are confirmed and count in the standings like real ones. Use these tools only for a rehearsal, never during the event. Each run is recorded in the audit log."}
      </Alert>

      <Card>
        <CardHeader title="Round and seed" icon={<FlaskConical aria-hidden="true" />} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.round} className="mb-1 block text-xs font-medium text-fg">Round (with a draw)</label>
            <Select id={ids.round} value={selectedRoundId} onChange={(event) => setRoundId(event.target.value)} disabled={drawnRounds.length === 0}>
              {drawnRounds.length === 0 && <option value="">No round has a draw yet</option>}
              {drawnRounds.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor={ids.seed} className="mb-1 block text-xs font-medium text-fg">Seed</label>
            <Input id={ids.seed} inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value.trim())} aria-describedby={`${ids.seed}-help`} />
            <p id={`${ids.seed}-help`} className="mt-1 text-xs text-fg-muted">The same seed on the same draw gives the same results.</p>
          </div>
          {!demo && (
            <div className="sm:col-span-2">
              <label htmlFor={ids.confirm} className="mb-1 block text-xs font-medium text-fg">
                Type <span className="font-mono">{expectedConfirmation}</span> to confirm this is a rehearsal
              </label>
              <Input id={ids.confirm} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
            </div>
          )}
        </CardBody>
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
          <Button
            variant="primary"
            onClick={() => void run("results")}
            disabled={!selectedRoundId || !confirmed || !seedValid || busy !== null}
            loading={busy === "results"}
          >
            <Shuffle aria-hidden="true" />
            Simulate results
          </Button>
          <Button
            onClick={() => void run("feedback")}
            disabled={!selectedRoundId || !confirmed || !seedValid || busy !== null}
            loading={busy === "feedback"}
          >
            <MessageSquareHeart aria-hidden="true" />
            Simulate feedback
          </Button>
        </div>
      </Card>

      {error && <Alert tone="danger" role="alert">{error}</Alert>}
      {outcome && (
        <Alert tone="success" role="status" title={`${outcome.result.created} ${outcome.kind === "results" ? "ballot(s)" : "feedback submission(s)"} simulated`}>
          {outcome.result.skipped.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {outcome.result.skipped.map((item, index) => (
                <li key={`${item.debateId}-${index}`}>{item.debateId ? `${item.debateId}: ` : ""}{item.reason}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </div>
  );
}
