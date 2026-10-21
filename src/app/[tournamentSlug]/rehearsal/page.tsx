"use client";

import React, { useId, useMemo, useState } from "react";
import { FlaskConical, MessageSquareHeart, Shuffle } from "lucide-react";
import { useTournament, type RehearsalOutcome } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { useI18n } from "@/components/i18n/I18nProvider";
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
  const { t, plural, rich } = useI18n();
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

  if (loading) return <p className="p-6 text-sm text-fg-muted">{t("setup.common.loading")}</p>;
  if (!tournament || !isOwnerOrAdmin) {
    return <p role="alert" className="p-6 text-sm text-danger">{t("setup.data.rehearsal.adminOnly")}</p>;
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
      setError(runError instanceof Error ? runError.message : t("setup.data.rehearsal.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("setup.data.rehearsal.title")}
        description={t("setup.data.rehearsal.description")}
        meta={demo ? <span className="rounded bg-info-subtle px-2 py-0.5 text-xs font-semibold text-info">{t("setup.data.rehearsal.demoBadge")}</span> : undefined}
      />

      <Alert tone={demo ? "info" : "warning"} title={demo ? t("setup.data.rehearsal.demoTitle") : t("setup.data.rehearsal.liveTitle")}>
        {demo
          ? t("setup.data.rehearsal.demoBody")
          : t("setup.data.rehearsal.liveBody")}
      </Alert>

      <Card>
        <CardHeader title={t("setup.data.rehearsal.cardTitle")} icon={<FlaskConical aria-hidden="true" />} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.round} className="mb-1 block text-xs font-medium text-fg">{t("setup.data.rehearsal.roundLabel")}</label>
            <Select id={ids.round} value={selectedRoundId} onChange={(event) => setRoundId(event.target.value)} disabled={drawnRounds.length === 0}>
              {drawnRounds.length === 0 && <option value="">{t("setup.data.rehearsal.noDrawnRound")}</option>}
              {drawnRounds.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor={ids.seed} className="mb-1 block text-xs font-medium text-fg">{t("setup.data.rehearsal.seedLabel")}</label>
            <Input id={ids.seed} inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value.trim())} aria-describedby={`${ids.seed}-help`} />
            <p id={`${ids.seed}-help`} className="mt-1 text-xs text-fg-muted">{t("setup.data.rehearsal.seedHelp")}</p>
          </div>
          {!demo && (
            <div className="sm:col-span-2">
              <label htmlFor={ids.confirm} className="mb-1 block text-xs font-medium text-fg">
                {rich("setup.data.rehearsal.confirmLabel", { code: (text) => <span className="font-mono">{text}</span> }, { name: expectedConfirmation })}
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
            {t("setup.data.rehearsal.simulateResults")}
          </Button>
          <Button
            onClick={() => void run("feedback")}
            disabled={!selectedRoundId || !confirmed || !seedValid || busy !== null}
            loading={busy === "feedback"}
          >
            <MessageSquareHeart aria-hidden="true" />
            {t("setup.data.rehearsal.simulateFeedback")}
          </Button>
        </div>
      </Card>

      {error && <Alert tone="danger" role="alert">{error}</Alert>}
      {outcome && (
        <Alert tone="success" role="status" title={plural(outcome.kind === "results" ? "setup.data.rehearsal.resultsSimulated" : "setup.data.rehearsal.feedbackSimulated", outcome.result.created)}>
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
