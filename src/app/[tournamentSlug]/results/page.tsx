"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Edit,
  Eye,
  FileText,
  Lock,
  Printer,
} from "lucide-react";
import { BallotSubmission, DebateSide, TeamScoreEntry } from "@/types";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
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
import {
  getRoundCompletionBlockers,
  setRoundCompletion,
} from "@/features/tournament/application/roundAdministration";

const BP_SIDES: readonly [DebateSide, string][] = [
  ["OG", "Opening Gov"],
  ["OO", "Opening Opp"],
  ["CG", "Closing Gov"],
  ["CO", "Closing Opp"],
];
const TWO_TEAM_SIDES: readonly [DebateSide, string][] = [
  ["AFF", "Affirmative"],
  ["NEG", "Negative"],
];

/** Team name with its result. BP marks first place as the winner; two-team formats use `win`. */
function TeamResultCell({ teamName, score, isBP }: { teamName?: string; score?: TeamScoreEntry; isBP: boolean }) {
  const won = score ? (isBP ? score.rank === 1 : Boolean(score.win)) : false;
  return (
    <TD>
      <div className="flex items-center gap-1 font-medium">
        {score &&
          (won ? (
            <ArrowUp className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Winning team" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 shrink-0 text-danger" aria-label="Losing team" />
          ))}
        <span>{teamName || "—"}</span>
      </div>
      {score && (
        <div className="font-mono text-[11px] text-fg-muted">
          {isBP ? `${score.points} pts` : score.win ? "WIN" : "LOSS"} · {score.totalSpeakerScore} spks
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
    updateRound,
    proceedToNextEliminationRound,
  } = useTournament();

  const isBP = tournament?.format === "bp";
  const sides = isBP ? BP_SIDES : TWO_TEAM_SIDES;
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
  const needsCheckLabel = tournament?.preferences?.ballotDoubleEntry ? "Awaiting check" : "Draft";

  const confirmedCount = roundDebates.filter(
    (d) => d.byeTeamId || ballotMap.get(d.id)?.confirmed
  ).length;
  const allBallotsConfirmed = roundDebates.length > 0 && confirmedCount === roundDebates.length;
  const [pendingPublication, setPendingPublication] = useState<boolean | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publicationError, setPublicationError] = useState("");
  const [pendingTeamSpeaksPublication, setPendingTeamSpeaksPublication] = useState<boolean | null>(null);
  const [isPublishingTeamSpeaks, setIsPublishingTeamSpeaks] = useState(false);
  const [teamSpeaksPublicationError, setTeamSpeaksPublicationError] = useState("");
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
      setCompletionError(error instanceof Error ? error.message : "The round status could not be saved. Please try again.");
    } finally {
      setIsSavingCompletion(false);
    }
  };

  const confirmPublication = async () => {
    if (!activeRound || pendingPublication === null) return;
    setIsPublishing(true);
    setPublicationError("");
    try {
      await updateRound({ ...activeRound, resultsReleased: pendingPublication });
      setPendingPublication(null);
    } catch {
      setPublicationError("The round publication could not be saved. Please try again.");
    } finally {
      setIsPublishing(false);
    }
  };

  const confirmTeamSpeaksPublication = async () => {
    if (!activeRound || pendingTeamSpeaksPublication === null) return;
    setIsPublishingTeamSpeaks(true);
    setTeamSpeaksPublicationError("");
    try {
      await updateRound({ ...activeRound, teamSpeaksReleased: pendingTeamSpeaksPublication });
      setPendingTeamSpeaksPublication(null);
    } catch {
      setTeamSpeaksPublicationError("Team-speaks publication could not be saved. Please try again.");
    } finally {
      setIsPublishingTeamSpeaks(false);
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
      setAdvancementError(error instanceof Error ? error.message : "Could not advance this elimination round.");
    } finally {
      setIsAdvancingRound(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Results & ballot entry"
        description="Enter and verify speaker scores, team rankings, and paperless e-ballots."
        actions={
          <Link href={`/${tournament?.slug}/print/ballots`} className={buttonClasses({ variant: "secondary" })}>
            <Printer aria-hidden="true" />
            Print ballot sheets
          </Link>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="group" aria-label="Select round" className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1">
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
                    <span className="sr-only">(all ballots confirmed)</span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs font-medium tabular-nums text-fg">
            {confirmedCount} of {roundDebates.length} confirmed
          </span>
          <ProgressBar value={confirmedCount} max={roundDebates.length} label="Confirmed ballots" className="w-36" />
        </div>
      </div>

      {roundDebates.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={`No debates in ${activeRound?.name ?? "this round"}`}
          description="Generate the draw before entering ballots and results for this round."
          action={
            <Link href={`/${tournament?.slug}/draw`} className={buttonClasses({ variant: "primary" })}>
              Go to draw generation
              <ArrowRight aria-hidden="true" />
            </Link>
          }
        />
      ) : (
        <TableContainer>
          <Table>
            <THead>
              <TR>
                <TH className="w-28">Venue</TH>
                {sides.map(([side, label]) => (
                  <TH key={side}>
                    {label} <span className="text-fg-subtle">({side})</span>
                  </TH>
                ))}
                <TH>Adjudicators</TH>
                <TH className="w-36">Status</TH>
                <TH align="right" className="w-32">
                  <span className="sr-only">Actions</span>
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
                      <TD className="font-medium text-fg-muted">Bye</TD>
                      <TD colSpan={sides.length} className="font-medium">
                        {byeTeam?.teamName || "Team"}
                      </TD>
                      <TD className="text-fg-muted">No adjudicator</TD>
                      <TD>
                        <StatusPill tone="info">Bye · {debate.byeResult === "win" ? "Win" : "Absent"}</StatusPill>
                      </TD>
                      <TD align="right" className="text-xs text-fg-muted">No ballot required</TD>
                    </TR>
                  );
                }

                return (
                  <TR key={debate.id}>
                    <TD className="font-medium">{debate.venueName || "Unassigned"}</TD>
                    {sides.map(([side]) => (
                      <TeamResultCell
                        key={side}
                        teamName={debate.teams?.[side]?.teamName}
                        score={ballot?.teamScores?.[side]}
                        isBP={isBP}
                      />
                    ))}
                    <TD className="text-xs">
                      <div>
                        <span className="text-fg-muted">Chair: </span>
                        {debate.adjudicators?.chairName ? `© ${debate.adjudicators.chairName}` : "—"}
                      </div>
                      <div className="text-fg-muted">Panellists: {panelistNames.join(", ") || "—"}</div>
                    </TD>
                    <TD>
                      <StatusPill tone={isConfirmed ? "success" : isDraft ? "warning" : "neutral"}>
                        {isConfirmed ? "Confirmed" : isDraft ? needsCheckLabel : "Unsubmitted"}
                      </StatusPill>
                      {isConfirmed && pendingDebateIds.has(debate.id) && (
                        <span className="mt-1 block text-[11px] font-medium text-warning">
                          New version {needsCheckLabel.toLowerCase()}
                        </span>
                      )}
                    </TD>
                    <TD align="right">
                      <Link
                        href={`/${tournament?.slug}/results/${activeRound?.seq}/${debate.id}`}
                        className={buttonClasses({ variant: ballot ? "secondary" : "primary", size: "sm" })}
                      >
                        <Edit aria-hidden="true" />
                        {ballot ? "Edit ballot" : "Enter ballot"}
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
      )}

      {activeRound && (
        <Card>
          <CardHeader title="Round publication" description={`Public visibility and lifecycle for ${activeRound.name}.`} />
          <div className="divide-y divide-border">
            <div className="px-4 py-3">
              <Checkbox
                label="Silent round"
                description="Hide this round's results and team outcomes from the public tab."
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
              title="Round results"
              status={
                activeRound.resultsReleased
                  ? "Round results are published."
                  : allBallotsConfirmed
                  ? "Ballots are saved; publish when ready."
                  : "Confirm every ballot or record a bye before publishing."
              }
              error={publicationError}
              action={
                <Button
                  variant={activeRound.resultsReleased ? "secondary" : "primary"}
                  onClick={() => setPendingPublication(!activeRound.resultsReleased)}
                  disabled={!activeRound.resultsReleased && !allBallotsConfirmed}
                >
                  {activeRound.resultsReleased ? <Lock aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  {activeRound.resultsReleased ? "Unpublish round results" : "Publish round results"}
                </Button>
              }
            />

            <ControlRow
              title="Team speaks"
              status={
                activeRound.teamSpeaksReleased
                  ? "Team scores are published for this round."
                  : allBallotsConfirmed
                  ? "Publish team scores separately when ready."
                  : "Confirm every ballot or record a bye before publishing team scores."
              }
              error={teamSpeaksPublicationError}
              action={
                <Button
                  variant="secondary"
                  onClick={() => setPendingTeamSpeaksPublication(!activeRound.teamSpeaksReleased)}
                  disabled={!activeRound.teamSpeaksReleased && !allBallotsConfirmed}
                >
                  {activeRound.teamSpeaksReleased ? <Lock aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  {activeRound.teamSpeaksReleased ? "Unpublish team speaks" : "Publish team speaks"}
                </Button>
              }
            />

            {activeRound.stage === "preliminary" && !activeRound.cancelled && (
              <ControlRow
                title="Round completion"
                status={
                  activeRound.completed
                    ? "This round is marked complete."
                    : completionBlockers.length === 0
                    ? "Every debate has a confirmed ballot; the round can be completed."
                    : `${completionBlockers.length} debate${completionBlockers.length === 1 ? "" : "s"} still blocking completion: ${completionBlockers
                        .slice(0, 3)
                        .map((blocker) => blocker.message)
                        .join(" ")}${completionBlockers.length > 3 ? " …" : ""}`
                }
                error={pendingCompletion === null ? completionError : undefined}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => setPendingCompletion(!activeRound.completed)}
                    disabled={!activeRound.completed && completionBlockers.length > 0}
                  >
                    <CheckCircle2 aria-hidden="true" />
                    {activeRound.completed ? "Reopen round" : "Complete round"}
                  </Button>
                }
              />
            )}

            {activeRound.stage === "elimination" && (
              <ControlRow
                title="Elimination"
                status={
                  activeRound.eliminationAdvanced
                    ? "This round is complete; losing teams have been eliminated."
                    : "Advance once every ballot in this round is confirmed."
                }
                error={advancementError}
                action={
                  activeRound.eliminationAdvanced ? (
                    <StatusPill tone="success">Advanced</StatusPill>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() => setPendingAdvancement(true)}
                      disabled={!allBallotsConfirmed}
                      loading={isAdvancingRound}
                      loadingText="Advancing..."
                    >
                      <ArrowRight aria-hidden="true" />
                      Proceed to next round
                    </Button>
                  )
                }
              />
            )}
          </div>
        </Card>
      )}
      {pendingPublication !== null && activeRound && (
        <ConfirmActionDialog
          title={pendingPublication ? "Publish round results?" : "Unpublish round results?"}
          description={pendingPublication
            ? `Publishing ${activeRound.name} makes its team outcomes visible on the public tab. Team scores are controlled separately.`
            : `Unpublishing ${activeRound.name} immediately hides its outcomes from the public tab.`}
          confirmLabel={pendingPublication ? "Yes, publish results" : "Yes, unpublish results"}
          onConfirm={confirmPublication}
          onCancel={() => setPendingPublication(null)}
          isBusy={isPublishing}
          error={publicationError}
        />
      )}
      {pendingTeamSpeaksPublication !== null && activeRound && (
        <ConfirmActionDialog
          title={pendingTeamSpeaksPublication ? "Publish team speaks?" : "Unpublish team speaks?"}
          description={pendingTeamSpeaksPublication
            ? `Publishing team speaks for ${activeRound.name} makes team score values available on the public tab.`
            : `Unpublishing team speaks for ${activeRound.name} hides its team score values from the public tab.`}
          confirmLabel={pendingTeamSpeaksPublication ? "Yes, publish team speaks" : "Yes, unpublish team speaks"}
          onConfirm={confirmTeamSpeaksPublication}
          onCancel={() => setPendingTeamSpeaksPublication(null)}
          isBusy={isPublishingTeamSpeaks}
          error={teamSpeaksPublicationError}
        />
      )}
      {pendingCompletion !== null && activeRound && (
        <ConfirmActionDialog
          title={pendingCompletion ? `Complete ${activeRound.name}?` : `Reopen ${activeRound.name}?`}
          description={pendingCompletion
            ? "Completed rounds count towards break liveness in adjudicator allocation. You can reopen the round later."
            : "Reopening marks the round as in progress again so ballots can be corrected before completing it."}
          confirmLabel={pendingCompletion ? "Yes, complete round" : "Yes, reopen round"}
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
          title="Proceed with elimination results?"
          description={`Advancing ${activeRound.name} marks every non-advancing team eliminated and activates the next pre-created elimination round.`}
          confirmLabel="Proceed to next round"
          onConfirm={handleProceedToNextRound}
          onCancel={() => setPendingAdvancement(false)}
          isBusy={isAdvancingRound}
          error={advancementError}
        />
      )}
    </div>
  );
}
