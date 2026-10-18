"use client";

import React from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClasses } from "@/components/ui/Button";
import { Badge, StatusPill, type Tone } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ProgressBar } from "@/components/ui/Feedback";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { describeRoundStatus } from "@/components/layout/roundStatus";
import type { Debate } from "@/types";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarPlus,
  FileCheck2,
  MapPin,
  Shuffle,
  Trophy,
  Users,
  Users2,
} from "lucide-react";

function debateStatus(debate: Debate): { tone: Tone; label: string } {
  if (debate.byeTeamId) return { tone: "info", label: `Bye · ${debate.byeResult === "win" ? "Win" : "Absent"}` };
  if (debate.resultStatus === "confirmed") return { tone: "success", label: "Confirmed" };
  if (debate.resultStatus === "draft") return { tone: "warning", label: "Draft" };
  return { tone: "neutral", label: "No result" };
}

function StatTile({
  href,
  label,
  value,
  detail,
  icon,
}: {
  href: string;
  label: string;
  value: number;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong",
        focusRing
      )}
    >
      <div className="flex items-center justify-between text-xs font-medium text-fg-muted">
        <span>{label}</span>
        <span className="text-fg-subtle [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</div>
      <p className="mt-0.5 text-xs text-fg-muted">{detail}</p>
    </Link>
  );
}

export default function TournamentDashboardPage() {
  const {
    tournament,
    activeRound,
    rounds,
    teams,
    adjudicators,
    venues,
    debates,
    ballots,
    motions,
    isOwnerOrAdmin,
  } = useTournament();

  const roundDebates = activeRound ? debates.filter((d) => d.roundId === activeRound.id) : [];
  const confirmedBallots = activeRound
    ? ballots.filter((b) => b.roundId === activeRound.id && b.confirmed)
    : [];
  const completedRoundDebates = roundDebates.filter(
    (debate) => debate.byeTeamId || confirmedBallots.some((ballot) => ballot.debateId === debate.id)
  ).length;
  const roundMotion = activeRound
    ? motions.find((m) => m.rounds && m.rounds.includes(activeRound.id))
    : null;

  const isBP = tournament?.format === "bp";
  const base = `/${tournament?.slug}`;
  const roundStatus = activeRound ? describeRoundStatus(activeRound) : null;
  const sides = isBP
    ? ([
        ["OG", "Opening Gov"],
        ["OO", "Opening Opp"],
        ["CG", "Closing Gov"],
        ["CO", "Closing Opp"],
      ] as const)
    : ([
        ["AFF", "Affirmative"],
        ["NEG", "Negative"],
      ] as const);

  const workflow = [
    { t: "Availability", h: `${base}/checkins` },
    { t: "Generate draw", h: `${base}/draw` },
    { t: "Allocate", h: `${base}/allocation` },
    { t: "Display", h: `${base}/display` },
    { t: "Motions", h: `${base}/imports/motions` },
    { t: "Results", h: `${base}/results` },
    { t: "Standings", h: `${base}/standings` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={tournament?.name || "Tournament Dashboard"}
        description={isBP ? "British Parliamentary · 4 teams per room" : "Asian/Australs · 2 teams per room"}
        actions={
          <Link href={`${base}/public`} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary" })}>
            Public index
            <ArrowUpRight aria-hidden="true" />
          </Link>
        }
      />

      <nav aria-label="Round workflow">
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {workflow.map((step, index) => (
            <li key={step.t}>
              <Link
                href={step.h}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] font-medium text-fg transition-colors hover:border-border-strong hover:bg-muted/60",
                  focusRing
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-fg-muted">
                  {index + 1}
                </span>
                <span className="truncate">{step.t}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {activeRound ? (
        <Card>
          <CardHeader
            title={activeRound.name}
            description="Current round"
            actions={
              roundDebates.length === 0 ? (
                // Drawing happens on the draw page, which runs the venue and rule checks first.
                isOwnerOrAdmin ? (
                  <Link href={`${base}/draw`} className={buttonClasses({ variant: "primary" })}>
                    <Shuffle aria-hidden="true" />
                    Generate draw
                  </Link>
                ) : null
              ) : (
                <>
                  <Link href={`${base}/draw`} className={buttonClasses({ variant: "secondary" })}>
                    <Shuffle aria-hidden="true" />
                    View draw ({roundDebates.length} rooms)
                  </Link>
                  <Link href={`${base}/allocation`} className={buttonClasses({ variant: "secondary" })}>
                    <Users2 aria-hidden="true" />
                    Adjudicator allocation
                  </Link>
                  <Link href={`${base}/results`} className={buttonClasses({ variant: "primary" })}>
                    <FileCheck2 aria-hidden="true" />
                    Enter ballots ({completedRoundDebates}/{roundDebates.length})
                  </Link>
                </>
              )
            }
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {roundStatus && <StatusPill tone={roundStatus.tone}>{roundStatus.label}</StatusPill>}
              <Badge>{activeRound.stage === "elimination" ? "Elimination" : "Preliminary"}</Badge>
            </div>
            {roundMotion ? (
              <blockquote className="max-w-3xl border-l-2 border-border-strong pl-3 text-[13px] text-fg">
                <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-fg-subtle">Motion</span>
                &ldquo;{roundMotion.text}&rdquo;
              </blockquote>
            ) : (
              <p className="text-[13px] text-fg-muted">No motion assigned to this round yet.</p>
            )}
            {roundDebates.length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg-muted">Round completion</span>
                  <span className="font-medium tabular-nums text-fg">
                    {completedRoundDebates} of {roundDebates.length} results complete (
                    {Math.round((completedRoundDebates / Math.max(1, roundDebates.length)) * 100)}%)
                  </span>
                </div>
                <ProgressBar value={completedRoundDebates} max={roundDebates.length} label="Round completion" />
              </div>
            )}
          </CardBody>
        </Card>
      ) : (
        <EmptyState
          icon={<CalendarPlus />}
          title="No rounds created yet"
          description="Create the first round from the round menu in the top bar."
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          href={`${base}/imports/teams`}
          label="Teams"
          value={teams.length}
          detail={`${teams.reduce((sum, t) => sum + (t.speakers?.length || 0), 0)} registered speakers`}
          icon={<Users />}
        />
        <StatTile
          href={`${base}/imports/adjudicators`}
          label="Adjudicators"
          value={adjudicators.length}
          detail={`${adjudicators.filter((a) => !a.trainee).length} accredited chairs`}
          icon={<Users2 />}
        />
        <StatTile
          href={`${base}/imports/venues`}
          label="Venues"
          value={venues.length}
          detail={`${venues.filter((v) => v.available !== false).length} active rooms`}
          icon={<MapPin />}
        />
        <StatTile
          href={`${base}/standings`}
          label="Rounds"
          value={rounds.length}
          detail={`${rounds.filter((r) => r.completed).length} rounds completed`}
          icon={<Trophy />}
        />
      </div>

      {roundDebates.length > 0 && (
        <section aria-labelledby="overview-matchups" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="overview-matchups" className="text-[15px] font-semibold text-fg">
              {activeRound?.name} matchups &amp; rooms
            </h2>
            <Link
              href={`${base}/draw`}
              className={cn("inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-accent-text hover:underline", focusRing)}
            >
              Full draw
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
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
                  <TH>Chair</TH>
                  <TH className="w-32">Status</TH>
                </TR>
              </THead>
              <TBody>
                {roundDebates.map((debate) => {
                  const status = debateStatus(debate);
                  return (
                    <TR key={debate.id}>
                      <TD className="font-medium">{debate.venueName || "Unassigned"}</TD>
                      {sides.map(([side]) => (
                        <TD key={side}>{debate.teams?.[side]?.teamName || "—"}</TD>
                      ))}
                      <TD>
                        {debate.byeTeamId ? (
                          <span className="text-fg-muted">Not required</span>
                        ) : debate.adjudicators?.chairName ? (
                          debate.adjudicators.chairName
                        ) : (
                          <StatusPill tone="danger">Unassigned</StatusPill>
                        )}
                      </TD>
                      <TD>
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
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
