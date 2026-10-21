"use client";

import { sideLabel, translatedSideName } from "@/lib/sideNames";
import { isPolyFormat, tournamentSides } from "@/lib/debateSides";
import React, { useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useFormatScore } from "@/features/tournament/components/results/useFormatScore";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Edit,
  Eye,
  FileText,
  Inbox,
  Lock,
  Printer,
} from "lucide-react";
import { BallotSubmission, DebateSide, Team, TeamScoreEntry } from "@/types";
import { TabroomTeamName } from "@/features/tournament/components/TabroomTeamName";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { ReleaseActionDialog } from "@/features/tournament/components/ReleaseActionDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, buttonClasses } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Field";
import { EmptyState, ProgressBar } from "@/components/ui/Feedback";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { getPanelistNamesByScore } from "@/lib/adjudicators";
import { checkResultsRelease } from "@/features/tournament/application/stateGuards";
import { INTAKE_STATUS_ORDER } from "@/features/tournament/application/ballotIntake";
import { INTAKE_STATUS_KEYS, INTAKE_STATUS_TONES, useRoundIntake } from "@/features/tournament/components/ballot/useRoundIntake";
import {
  getRoundCompletionBlockers,
  setRoundCompletion,
} from "@/features/tournament/application/roundAdministration";
import { CurrentRoundsBar } from "@/features/tournament/components/CurrentRoundsBar";

const BP_SIDES: readonly DebateSide[] = ["OG", "OO", "CG", "CO"];
const TWO_TEAM_SIDES: readonly DebateSide[] = ["AFF", "NEG"];

/** Team name with its result. BP marks first place as the winner; two-team formats use `win`. */
function TeamResultCell({ team, teamName, score, isBP, poly = false }: { team?: Team; teamName?: string; score?: TeamScoreEntry; isBP: boolean; poly?: boolean }) {
  const { t, plural } = useI18n();
  const formatScore = useFormatScore();
  const won = score ? (isBP ? score.rank === 1 : poly ? score.rank === 1 || score.win === true : Boolean(score.win)) : false;
  // Poly voting ballots record scores only: no rank, no winner.
  const decided = Boolean(score) && (!poly || score?.rank !== undefined || score?.win !== undefined);
  return (
    <TD>
      <div className="flex items-center gap-1 font-medium">
        {score && decided &&
          (won ? (
            <>
              <ArrowUp className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              <span className="sr-only">{t("results.overview.winningTeam")}</span>
            </>
          ) : (
            <>
              <ArrowDown className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
              <span className="sr-only">{t("results.overview.losingTeam")}</span>
            </>
          ))}
        <span><TabroomTeamName team={team} name={teamName} /></span>
      </div>
      {score && (
        <div className="font-mono text-[11px] text-fg-muted">
          {isBP || (poly && score.rank !== undefined)
            ? plural("results.overview.points", score.points)
            : poly
              ? score.win ? t("results.ballot.advances") : "—"
            : score.win
              ? t("results.overview.win")
              : t("results.overview.loss")}{" "}
          · {t("results.overview.speaksValue", { score: formatScore(score.totalSpeakerScore) })}
        </div>
      )}
    </TD>
  );
}

/** One publication/lifecycle control: description on the left, action on the right. */
function ControlRow({
  title,
  status,
  action,
  error,
}: {
  title: string;
  status: React.ReactNode;
  action: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-fg">{title}</p>
        <p className="text-xs text-fg-muted">{status}</p>
        {error && (
          <p role="alert" className="mt-0.5 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export default function ResultsOverviewPage() {
  const {
    tournament,
    activeRound,
    rounds,
    setActiveRound,
    debates,
    ballots,
    adjudicators,
    teams,
    updateRound,
    proceedToNextEliminationRound,
    isOwnerOrAdmin,
  } = useTournament();
  const { t, plural, formatList } = useI18n();

  const isBP = tournament?.format === "bp";
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  // [side, full name] in the tournament's side names (sideNames).
  const poly = isPolyFormat(tournament?.format);
  const sides = (tournament && poly ? tournamentSides(tournament) : isBP ? BP_SIDES : TWO_TEAM_SIDES)
    .map((side) => [side, translatedSideName(t, side, tournament?.preferences)] as const);
  const { summary: intakeSummary } = useRoundIntake(activeRound?.id);
  const roundDebates = activeRound ? debates.filter((d) => d.roundId === activeRound.id) : [];

  // The confirmed version is the debate's result; otherwise show the newest pending version.
  const ballotMap = new Map<string, BallotSubmission>();
  const pendingDebateIds = new Set<string>();
  ballots.forEach((b) => {
    if (b.discarded) return;
    if (!b.confirmed) pendingDebateIds.add(b.debateId);
    const current = ballotMap.get(b.debateId);
    if (!current || (b.confirmed && !current.confirmed) || (b.confirmed === current.confirmed && b.version > current.version)) {
      ballotMap.set(b.debateId, b);
    }
  });
  const doubleEntry = Boolean(tournament?.preferences?.ballotDoubleEntry);
  const needsCheckLabel = doubleEntry ? t("results.overview.status.awaitingCheck") : t("results.overview.status.draft");

  const confirmedCount = roundDebates.filter(
    (d) => d.byeTeamId || ballotMap.get(d.id)?.confirmed
  ).length;
  const allBallotsConfirmed = roundDebates.length > 0 && confirmedCount === roundDebates.length;
  // Hard rules disable publishing; overridable ones (unchecked ballot versions) ask for a reason.
  const releaseBlocker = activeRound
    ? checkResultsRelease(activeRound, { rounds, debates, ballots }).find((violation) => !violation.overridable)
    : undefined;
  const [pendingPublication, setPendingPublication] = useState<boolean | null>(null);
  const [pendingTeamSpeaksPublication, setPendingTeamSpeaksPublication] = useState<boolean | null>(null);
  const [isAdvancingRound, setIsAdvancingRound] = useState(false);
  const [advancementError, setAdvancementError] = useState("");
  const [pendingAdvancement, setPendingAdvancement] = useState(false);
  const [pendingCompletion, setPendingCompletion] = useState<boolean | null>(null);
  const [isSavingCompletion, setIsSavingCompletion] = useState(false);
  const [completionError, setCompletionError] = useState("");
  const completionBlockers = activeRound?.stage === "preliminary"
    ? getRoundCompletionBlockers(activeRound, debates, ballots)
    : [];

  const confirmCompletion = async () => {
    if (!activeRound || pendingCompletion === null) return;
    setIsSavingCompletion(true);
    setCompletionError("");
    try {
      await updateRound(setRoundCompletion(activeRound, pendingCompletion, debates, ballots));
      setPendingCompletion(null);
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : t("results.overview.completionSaveFailed"));
    } finally {
      setIsSavingCompletion(false);
    }
  };

  const handleProceedToNextRound = async () => {
    if (!activeRound) return;
    setIsAdvancingRound(true);
    setAdvancementError("");
    try {
      await proceedToNextEliminationRound(activeRound.id);
      setPendingAdvancement(false);
    } catch (error) {
      setAdvancementError(error instanceof Error ? error.message : t("results.overview.advanceFailed"));
    } finally {
      setIsAdvancingRound(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("results.overview.title")}
        description={t("results.overview.description")}
        actions={
          <Link href={`/${tournament?.slug}/print/ballots`} className={buttonClasses({ variant: "secondary" })}>
            <Printer aria-hidden="true" />
            {t("results.overview.printBallots")}
          </Link>
        }
      />
      <CurrentRoundsBar what="results" />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="group" aria-label={t("results.overview.selectRound")} className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1">
          {rounds.map((r) => {
            const rDebates = debates.filter((d) => d.roundId === r.id);
            const rConfirmed = rDebates.filter((d) => ballotMap.get(d.id)?.confirmed).length;
            const isComplete = rConfirmed === rDebates.length && rDebates.length > 0;
            const isActive = activeRound?.id === r.id;

            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setActiveRound(r)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                  isActive
                    ? "border-fg bg-fg text-background"
                    : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
                  focusRing
                )}
              >
                {r.name}
                {isComplete && (
                  <>
                    <CheckCircle2 className={cn("h-3 w-3", isActive ? "text-background" : "text-success")} aria-hidden="true" />
                    <span className="sr-only">{t("results.overview.allConfirmedSr")}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs font-medium tabular-nums text-fg">
            {t("results.overview.confirmedCount", { confirmed: confirmedCount, total: roundDebates.length })}
          </span>
          <ProgressBar value={confirmedCount} max={roundDebates.length} label={t("results.overview.confirmedBallots")} className="w-36" />
        </div>
      </div>

      {intakeSummary.debates > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <span className="font-medium text-fg">{t("results.overview.paperBallots")}</span>
          <span className="tabular-nums">
            {t("results.overview.sheetsReceived", {
              received: intakeSummary.sheetsReceived,
              expected: intakeSummary.sheetsExpected,
            })}
          </span>
          {INTAKE_STATUS_ORDER.filter((status) => intakeSummary.counts[status] > 0).map((status) => (
            <StatusPill key={status} tone={INTAKE_STATUS_TONES[status]}>
              {t(INTAKE_STATUS_KEYS[status])} <span className="tabular-nums">{intakeSummary.counts[status]}</span>
            </StatusPill>
          ))}
          <Link href={`/${tournament?.slug}/results/intake`} className={buttonClasses({ variant: "ghost", size: "sm" })}>
            <Inbox aria-hidden="true" />
            {t("results.overview.ballotIntake")}
          </Link>
        </div>
      )}

      {roundDebates.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={
            activeRound
              ? t("results.overview.empty.title", { round: activeRound.name })
              : t("results.overview.empty.titleNoRound")
          }
          description={t("results.overview.empty.description")}
          action={
            <Link href={`/${tournament?.slug}/draw`} className={buttonClasses({ variant: "primary" })}>
              {t("results.overview.empty.action")}
              <ArrowRight className="rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          }
        />
      ) : (
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH className="w-28">{t("results.overview.col.venue")}</TH>
                {sides.map(([side, label]) => (
                  <TH key={side}>
                    {label} <span className="text-fg-subtle">({sideLabel(side, tournament?.preferences)})</span>
                  </TH>
                ))}
                <TH>{t("results.overview.col.adjudicators")}</TH>
                <TH className="w-36">{t("results.overview.col.status")}</TH>
                <TH align="right" className="w-32">
                  <span className="sr-only">{t("results.overview.col.actions")}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {roundDebates.map((debate) => {
                const ballot = ballotMap.get(debate.id);
                const isConfirmed = ballot?.confirmed;
                const isDraft = ballot && !ballot.confirmed;
                const panelistNames = getPanelistNamesByScore(debate.adjudicators, adjudicators);

                if (debate.byeTeamId) {
                  const byeTeam = Object.values(debate.teams).find((slot) => slot?.teamId === debate.byeTeamId);
                  return (
                    <TR key={debate.id}>
                      <TD className="font-medium text-fg-muted">{t("results.overview.bye")}</TD>
                      <TD colSpan={sides.length} className="font-medium">
                        <TabroomTeamName
                          team={byeTeam?.teamId ? teamsById.get(byeTeam.teamId) : undefined}
                          name={byeTeam?.teamName}
                          fallback={t("results.overview.byeTeamFallback")}
                        />
                      </TD>
                      <TD className="text-fg-muted">{t("results.overview.noAdjudicator")}</TD>
                      <TD>
                        <StatusPill tone="info">
                          {debate.byeResult === "win" ? t("results.overview.byeWin") : t("results.overview.byeAbsent")}
                        </StatusPill>
                      </TD>
                      <TD align="right" className="text-xs text-fg-muted">{t("results.overview.noBallotRequired")}</TD>
                    </TR>
                  );
                }

                return (
                  <TR key={debate.id}>
                    <TD className="font-medium">{debate.venueName || t("results.overview.unassignedVenue")}</TD>
                    {sides.map(([side]) => (
                      <TeamResultCell
                        key={side}
                        team={debate.teams?.[side]?.teamId ? teamsById.get(debate.teams[side]!.teamId) : undefined}
                        teamName={debate.teams?.[side]?.teamName}
                        score={ballot?.teamScores?.[side]}
                        isBP={isBP}
                        poly={poly}
                      />
                    ))}
                    <TD className="text-xs">
                      <div>
                        <span className="text-fg-muted">{t("results.overview.chairLabel")} </span>
                        {debate.adjudicators?.chairName ? `© ${debate.adjudicators.chairName}` : "—"}
                      </div>
                      <div className="text-fg-muted">
                        {t("results.overview.panellists", { names: panelistNames.length ? formatList(panelistNames) : "—" })}
                      </div>
                    </TD>
                    <TD>
                      <StatusPill tone={isConfirmed ? "success" : isDraft ? "warning" : "neutral"}>
                        {isConfirmed
                          ? t("results.overview.status.confirmed")
                          : isDraft
                            ? needsCheckLabel
                            : t("results.overview.status.unsubmitted")}
                      </StatusPill>
                      {isConfirmed && pendingDebateIds.has(debate.id) && (
                        <span className="mt-1 block text-[11px] font-medium text-warning">
                          {doubleEntry ? t("results.overview.newVersionAwaitingCheck") : t("results.overview.newVersionDraft")}
                        </span>
                      )}
                    </TD>
                    <TD align="right">
                      <Link
                        href={`/${tournament?.slug}/results/${activeRound?.seq}/${debate.id}`}
                        className={buttonClasses({ variant: ballot ? "secondary" : "primary", size: "sm" })}
                      >
                        <Edit aria-hidden="true" />
                        {ballot ? t("results.overview.editBallot") : t("results.overview.enterBallot")}
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
      )}

      {activeRound && isOwnerOrAdmin && (
        <Card>
          <CardHeader
            title={t("results.overview.publication.title")}
            description={t("results.overview.publication.description", { round: activeRound.name })}
          />
          <div className="divide-y divide-border">
            <div className="px-4 py-3">
              <Checkbox
                label={t("results.overview.silent.label")}
                description={t("results.overview.silent.description")}
                checked={Boolean(activeRound.silent)}
                onChange={(event) =>
                  updateRound({
                    ...activeRound,
                    silent: event.target.checked,
                    resultsReleased: false,
                    teamSpeaksReleased: false,
                  })
                }
              />
            </div>

            <ControlRow
              title={t("results.overview.results.title")}
              status={
                activeRound.resultsReleased
                  ? t("results.overview.results.published")
                  : !releaseBlocker
                  ? t("results.overview.results.ready")
                  : t("results.overview.results.blocked")
              }
              action={
                <Button
                  variant={activeRound.resultsReleased ? "secondary" : "primary"}
                  onClick={() => setPendingPublication(!activeRound.resultsReleased)}
                  disabled={!activeRound.resultsReleased && Boolean(releaseBlocker)}
                >
                  {activeRound.resultsReleased ? <Lock aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  {activeRound.resultsReleased ? t("results.overview.results.unpublish") : t("results.overview.results.publish")}
                </Button>
              }
            />

            <ControlRow
              title={t("results.overview.speaks.title")}
              status={
                activeRound.teamSpeaksReleased
                  ? t("results.overview.speaks.published")
                  : !releaseBlocker
                  ? t("results.overview.speaks.ready")
                  : t("results.overview.speaks.blocked")
              }
              action={
                <Button
                  variant="secondary"
                  onClick={() => setPendingTeamSpeaksPublication(!activeRound.teamSpeaksReleased)}
                  disabled={!activeRound.teamSpeaksReleased && Boolean(releaseBlocker)}
                >
                  {activeRound.teamSpeaksReleased ? <Lock aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  {activeRound.teamSpeaksReleased ? t("results.overview.speaks.unpublish") : t("results.overview.speaks.publish")}
                </Button>
              }
            />

            {activeRound.stage === "preliminary" && !activeRound.cancelled && (
              <ControlRow
                title={t("results.overview.completion.title")}
                status={
                  activeRound.completed
                    ? t("results.overview.completion.done")
                    : completionBlockers.length === 0
                    ? t("results.overview.completion.ready")
                    : plural("results.overview.completion.blocked", completionBlockers.length, {
                        details: `${completionBlockers
                          .slice(0, 3)
                          .map((blocker) => blocker.message)
                          .join(" ")}${completionBlockers.length > 3 ? " …" : ""}`,
                      })
                }
                error={pendingCompletion === null ? completionError : undefined}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => setPendingCompletion(!activeRound.completed)}
                    disabled={!activeRound.completed && completionBlockers.length > 0}
                  >
                    <CheckCircle2 aria-hidden="true" />
                    {activeRound.completed ? t("results.overview.completion.reopen") : t("results.overview.completion.complete")}
                  </Button>
                }
              />
            )}

            {activeRound.stage === "elimination" && (
              <ControlRow
                title={t("results.overview.elimination.title")}
                status={
                  activeRound.eliminationAdvanced
                    ? t("results.overview.elimination.done")
                    : t("results.overview.elimination.ready")
                }
                error={advancementError}
                action={
                  activeRound.eliminationAdvanced ? (
                    <StatusPill tone="success">{t("results.overview.elimination.advanced")}</StatusPill>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => setPendingAdvancement(true)}
                      disabled={!allBallotsConfirmed}
                      loading={isAdvancingRound}
                      loadingText={t("results.overview.elimination.advancing")}
                    >
                      <ArrowRight className="rtl:-scale-x-100" aria-hidden="true" />
                      {t("results.overview.elimination.proceed")}
                    </Button>
                  )
                }
              />
            )}
          </div>
        </Card>
      )}
      {pendingPublication !== null && activeRound && (
        <ReleaseActionDialog
          title={pendingPublication ? t("results.overview.results.publishTitle") : t("results.overview.results.unpublishTitle")}
          description={pendingPublication
            ? t("results.overview.results.publishDescription", { round: activeRound.name })
            : t("results.overview.results.unpublishDescription", { round: activeRound.name })}
          confirmLabel={pendingPublication ? t("results.overview.results.publishConfirm") : t("results.overview.results.unpublishConfirm")}
          apply={() => updateRound({ ...activeRound, resultsReleased: pendingPublication })}
          onClose={() => setPendingPublication(null)}
        />
      )}
      {pendingTeamSpeaksPublication !== null && activeRound && (
        <ReleaseActionDialog
          title={pendingTeamSpeaksPublication ? t("results.overview.speaks.publishTitle") : t("results.overview.speaks.unpublishTitle")}
          description={pendingTeamSpeaksPublication
            ? t("results.overview.speaks.publishDescription", { round: activeRound.name })
            : t("results.overview.speaks.unpublishDescription", { round: activeRound.name })}
          confirmLabel={pendingTeamSpeaksPublication ? t("results.overview.speaks.publish") : t("results.overview.speaks.unpublish")}
          apply={() => updateRound({ ...activeRound, teamSpeaksReleased: pendingTeamSpeaksPublication })}
          onClose={() => setPendingTeamSpeaksPublication(null)}
        />
      )}
      {pendingCompletion !== null && activeRound && (
        <ConfirmActionDialog
          title={pendingCompletion
            ? t("results.overview.completion.completeTitle", { round: activeRound.name })
            : t("results.overview.completion.reopenTitle", { round: activeRound.name })}
          description={pendingCompletion
            ? t("results.overview.completion.completeDescription")
            : t("results.overview.completion.reopenDescription")}
          confirmLabel={pendingCompletion ? t("results.overview.completion.completeConfirm") : t("results.overview.completion.reopenConfirm")}
          onConfirm={confirmCompletion}
          onCancel={() => {
            setPendingCompletion(null);
            setCompletionError("");
          }}
          isBusy={isSavingCompletion}
          error={completionError}
        />
      )}
      {pendingAdvancement && activeRound?.stage === "elimination" && (
        <ConfirmActionDialog
          title={t("results.overview.elimination.confirmTitle")}
          description={t("results.overview.elimination.confirmDescription", { round: activeRound.name })}
          confirmLabel={t("results.overview.elimination.proceed")}
          onConfirm={handleProceedToNextRound}
          onCancel={() => setPendingAdvancement(false)}
          isBusy={isAdvancingRound}
          error={advancementError}
        />
      )}
    </div>
  );
}
