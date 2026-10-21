"use client";

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Camera, CameraOff, Edit, Inbox, Printer, ScanLine } from "lucide-react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, buttonClasses } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { Alert, EmptyState, ProgressBar } from "@/components/ui/Feedback";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { useBarcodeCamera } from "@/lib/checkins/useBarcodeCamera";
import {
  buildBallotSheetIndex,
  INTAKE_STATUS_ORDER,
  resolveIntakeScan,
  type DebateIntakeStatus,
  type IntakeScanOutcome,
} from "@/features/tournament/application/ballotIntake";
import { INTAKE_STATUS_KEYS, INTAKE_STATUS_TONES, useRoundIntake } from "@/features/tournament/components/ballot/useRoundIntake";

type ScanFeedback = {
  tone: "success" | "info" | "warning" | "danger";
  message: string;
  /** Wrong-round scans offer to switch to the sheet's round. */
  switchToRoundId?: string;
};

const OUTCOME_TONES: Record<IntakeScanOutcome["kind"], ScanFeedback["tone"]> = {
  accepted: "success",
  duplicate: "info",
  wrong_round: "warning",
  invalid: "danger",
  unknown: "danger",
  blocked: "danger",
};

const SCAN_TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

export default function BallotIntakePage() {
  const { tournament, rounds, activeRound, setActiveRound, debates, adjudicators, ballotIntake, recordBallotIntake } =
    useTournament();
  const { t, formatDateTime, formatList } = useI18n();
  const formatTime = (iso: string | undefined) => (iso ? formatDateTime(iso, SCAN_TIME_FORMAT) || "—" : "—");
  const { rows, summary, perAdjudicator } = useRoundIntake(activeRound?.id);
  const [scanValue, setScanValue] = useState("");
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [recent, setRecent] = useState<Array<{ key: number; at: string; tone: ScanFeedback["tone"]; message: string }>>([]);
  const [filter, setFilter] = useState<DebateIntakeStatus | "all">("all");
  const [busy, setBusy] = useState(false);
  const scannerRef = useRef<HTMLInputElement>(null);
  const scanCounter = useRef(0);

  const index = useMemo(() => buildBallotSheetIndex(debates, adjudicators), [debates, adjudicators]);
  const debatesById = useMemo(() => new Map(debates.map((debate) => [debate.id, debate])), [debates]);
  const visibleRows = filter === "all" ? rows : rows.filter((row) => row.status === filter);

  const report = (next: ScanFeedback) => {
    setFeedback(next);
    scanCounter.current += 1;
    setRecent((current) => [
      { key: scanCounter.current, at: new Date().toISOString(), tone: next.tone, message: next.message },
      ...current,
    ].slice(0, 8));
  };

  const receive = async (raw: string) => {
    if (!activeRound || busy) return;
    setBusy(true);
    try {
      const outcome = resolveIntakeScan({ input: raw, roundId: activeRound.id, index, intake: ballotIntake, rounds, debates });
      if (outcome.kind === "accepted") {
        const added = await recordBallotIntake(outcome.sheet);
        report(added
          ? { tone: "success", message: outcome.message }
          : { tone: "info", message: t("results.intake.alreadyReceived") });
      } else {
        report({
          tone: OUTCOME_TONES[outcome.kind],
          message: outcome.message,
          ...(outcome.kind === "wrong_round" ? { switchToRoundId: outcome.sheet.roundId } : {}),
        });
      }
    } catch (error) {
      report({
        tone: "danger",
        message: error instanceof Error ? error.message : t("results.intake.recordFailed"),
      });
    } finally {
      setBusy(false);
      setScanValue("");
      scannerRef.current?.focus();
    }
  };

  const camera = useBarcodeCamera({
    onDetected: (value) => void receive(value),
    onError: (message) => report({ tone: "danger", message }),
  });

  const switchRound = feedback?.switchToRoundId ? rounds.find((round) => round.id === feedback.switchToRoundId) : undefined;
  const filterOptions: Array<DebateIntakeStatus | "all"> = ["all", ...INTAKE_STATUS_ORDER];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("results.intake.title")}
        description={t("results.intake.description")}
        actions={
          <>
            <Link href={`/${tournament?.slug}/results`} className={buttonClasses({ variant: "ghost" })}>
              <ArrowLeft className="rtl:-scale-x-100" aria-hidden="true" />
              {t("results.intake.backToResults")}
            </Link>
            <Link href={`/${tournament?.slug}/print/ballots`} className={buttonClasses({ variant: "secondary" })}>
              <Printer aria-hidden="true" />
              {t("results.overview.printBallots")}
            </Link>
          </>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <Select
          label={t("results.intake.roundLabel")}
          value={activeRound?.id || ""}
          onChange={(event) => setActiveRound(rounds.find((round) => round.id === event.target.value) || null)}
          wrapperClassName="w-full max-w-xs"
        >
          {rounds.length === 0 && <option value="">{t("results.intake.noRounds")}</option>}
          {rounds.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
        </Select>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs font-medium tabular-nums text-fg">
            {t("results.overview.sheetsReceived", { received: summary.sheetsReceived, expected: summary.sheetsExpected })}
          </span>
          <ProgressBar value={summary.sheetsReceived} max={summary.sheetsExpected} label={t("results.intake.sheetsProgress")} className="w-36" />
        </div>
      </div>

      <Card>
        <CardHeader
          icon={<ScanLine />}
          title={t("results.intake.receive.title")}
          description={perAdjudicator ? t("results.intake.receive.perAdjudicator") : t("results.intake.receive.perDebate")}
        />
        <CardBody className="space-y-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void receive(scanValue);
            }}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <Input
              ref={scannerRef}
              label={t("results.intake.receive.idLabel")}
              help={t("results.intake.receive.idHelp")}
              autoComplete="off"
              autoFocus
              value={scanValue}
              onChange={(event) => setScanValue(event.target.value)}
              disabled={!activeRound}
              wrapperClassName="flex-1"
              className="font-mono uppercase"
            />
            <div className="flex gap-2 sm:mb-[22px]">
              <Button type="submit" variant="primary" loading={busy} disabled={!activeRound || !scanValue.trim()}>
                <Inbox aria-hidden="true" />
                {t("results.intake.receive.submit")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => camera.setActive((current) => !current)}
                disabled={!activeRound}
                aria-pressed={camera.active}
              >
                {camera.active ? <CameraOff aria-hidden="true" /> : <Camera aria-hidden="true" />}
                {camera.active ? t("results.intake.receive.stopCamera") : t("results.intake.receive.useCamera")}
              </Button>
            </div>
          </form>
          {camera.active && (
            <video
              ref={camera.videoRef}
              aria-label={t("results.intake.receive.cameraPreview")}
              muted
              playsInline
              className="max-h-64 w-full rounded-lg border border-border bg-muted object-contain"
            />
          )}
          <div aria-live="polite">
            {feedback && (
              <Alert tone={feedback.tone} role={feedback.tone === "danger" ? "alert" : "status"}>
                <span className="text-fg">{feedback.message}</span>
                {switchRound && (
                  <Button size="sm" variant="secondary" className="ms-2" onClick={() => {
                    setActiveRound(switchRound);
                    setFeedback(null);
                  }}>
                    {t("results.intake.switchRound", { round: switchRound.name })}
                  </Button>
                )}
              </Alert>
            )}
          </div>
          {recent.length > 1 && (
            <details className="text-xs text-fg-muted">
              <summary className={cn("cursor-pointer select-none rounded-sm", focusRing)}>{t("results.intake.recent")}</summary>
              <ul className="mt-2 space-y-1">
                {recent.map((item) => (
                  <li key={item.key} className="flex gap-2">
                    <span className="font-mono tabular-nums">{formatTime(item.at)}</span>
                    <span className="sr-only">{item.tone === "success"
                        ? t("results.intake.recentReceived")
                        : item.tone === "info"
                          ? t("results.intake.recentNote")
                          : t("results.intake.recentProblem")}</span>
                    <span className={item.tone === "danger" ? "text-danger" : item.tone === "warning" ? "text-warning" : undefined}>
                      {item.message}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardBody>
      </Card>

      {!activeRound ? (
        <EmptyState
          icon={<Inbox />}
          title={t("results.intake.noRound.title")}
          description={t("results.intake.noRound.description")}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={t("results.overview.empty.title", { round: activeRound.name })}
          description={t("results.intake.empty.description")}
        />
      ) : (
        <section className="space-y-3" aria-labelledby="intake-board-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="intake-board-heading" className="text-[15px] font-semibold text-fg">{t("results.intake.board.title")}</h2>
            <div role="group" aria-label={t("results.intake.board.filter")} className="flex flex-wrap gap-1">
              {filterOptions.map((option) => {
                const count = option === "all" ? summary.debates : summary.counts[option];
                const selected = filter === option;
                if (option !== "all" && count === 0 && !selected) return null;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setFilter(option)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                      selected
                        ? "border-fg bg-fg text-background"
                        : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
                      focusRing
                    )}
                  >
                    {option === "all" ? t("results.intake.board.all") : t(INTAKE_STATUS_KEYS[option])}
                    <span className="tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH className="w-32">{t("results.intake.col.room")}</TH>
                  <TH>{t("results.intake.col.teams")}</TH>
                  <TH>{t("results.intake.col.paper")}</TH>
                  <TH className="w-40">{t("results.overview.col.status")}</TH>
                  <TH align="right" className="w-20">{t("results.intake.col.lastScan")}</TH>
                  <TH align="right" className="w-32"><span className="sr-only">{t("results.overview.col.actions")}</span></TH>
                </TR>
              </THead>
              <TBody>
                {visibleRows.length === 0 && (
                  <TableEmpty colSpan={6}>{t("results.intake.board.emptyFilter")}</TableEmpty>
                )}
                {visibleRows.map((row) => {
                  const debate = debatesById.get(row.debateId);
                  const teams = Object.values(debate?.teams || {})
                    .map((slot) => slot?.teamName)
                    .filter(Boolean)
                    .join(t("results.intake.versus"));
                  const hasBallot = row.pendingVersions.length > 0 || row.confirmedVersion !== undefined;
                  return (
                    <TR key={row.debateId}>
                      <TD className="font-medium">{debate?.venueName || t("results.intake.roomFallback", { rank: debate?.roomRank ?? "" })}</TD>
                      <TD className="text-xs">{teams || "—"}</TD>
                      <TD className="text-xs">
                        <span className="tabular-nums">{row.receivedSheets.length}/{row.expectedSheets.length}</span>
                        {row.missingSheets.length > 0 && row.expectedSheets.length > 1 && (
                          <span className="block text-fg-muted">
                            {t("results.intake.missingSheets", {
                              names: formatList(row.missingSheets.map((sheet) => sheet.adjudicatorName || t("results.intake.sheetFallback"))),
                            })}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <StatusPill tone={INTAKE_STATUS_TONES[row.status]}>{t(INTAKE_STATUS_KEYS[row.status])}</StatusPill>
                        {row.disputeReason && <span className="mt-1 block text-[11px] text-danger">{row.disputeReason}</span>}
                        {row.status === "confirmed" && row.pendingVersions.length > 0 && (
                          <span className="mt-1 block text-[11px] text-warning">{t("results.intake.newVersionPending")}</span>
                        )}
                      </TD>
                      <TD numeric>{formatTime(row.lastReceivedAt)}</TD>
                      <TD align="right">
                        <Link
                          href={`/${tournament?.slug}/results/${activeRound.seq}/${row.debateId}`}
                          className={buttonClasses({ variant: "secondary", size: "sm" })}
                        >
                          <Edit aria-hidden="true" />
                          {hasBallot ? t("results.intake.openBallot") : t("results.overview.enterBallot")}
                        </Link>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableContainer>
        </section>
      )}
    </div>
  );
}
