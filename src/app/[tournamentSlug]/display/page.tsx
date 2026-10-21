"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { useAuth } from "@/contexts/AuthContext";
import { SideBadge } from "@/components/ui/SideBadge";
import { Debate, DebateSide, Motion, Round } from "@/types";
import { debateSides, isPolyFormat } from "@/lib/debateSides";
import { sidesPending } from "@/lib/draw/manualSides";
import { Monitor, Lock, ChevronLeft, ChevronRight } from "lucide-react";
import {
  buildAlphabeticalDraw,
  buildMotionRevealSteps,
  motionsForDisplay,
  nextRevealStep,
  projectorAccess,
  projectorRounds,
  staffProjectorRound,
  type ProjectorStaffCopy,
} from "@/lib/display";
import { safeJsonParse } from "@/lib/safeJson";
import { motionsStatusOf } from "@/features/tournament/application/motionRelease";
import { getLocalStore } from "@/lib/offline/localStore";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import type { MessageKey } from "@/lib/i18n";

type DisplayView = "rooms" | "teams" | "motions";

const VIEW_LABELS: Record<DisplayView, MessageKey> = {
  rooms: "results.display.view.rooms",
  teams: "results.display.view.teams",
  motions: "results.display.view.motions",
};

/** View toggles: the selected view is filled and marked with aria-pressed, not by colour alone. */
const toggleClasses = (active: boolean) =>
  cn(
    "px-3 py-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
    active ? "bg-accent text-accent-fg" : "bg-surface text-fg hover:bg-muted"
  );

export default function DisplayPage() {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;
  const {
    tournament,
    activeRound: publicActiveRound,
    rounds: publicRounds,
    debates: publicDebates,
    motions: publicMotions,
    isOwnerOrAdmin,
    isDataEntryAssistant,
    staffPermissions,
  } = useTournament();
  const { user } = useAuth();
  const { t, plural, formatList } = useI18n();
  const [scale, setScale] = useState(1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [view, setView] = useState<DisplayView>("rooms");
  /** Concurrent rounds (same schedule slot) are shown together unless narrowed to the active round. */
  const [showConcurrent, setShowConcurrent] = useState(true);
  const [revealIndex, setRevealIndex] = useState(0);
  const [staffCopy, setStaffCopy] = useState<ProjectorStaffCopy | null>(null);
  const [staffCopyReload, setStaffCopyReload] = useState(0);

  const isBP = tournament?.format === "bp";
  const prefs = tournament?.preferences;

  // Staff (server-verified administrators, or data-entry staff with draw.display / motions.display;
  // never a device-local owner id) may project a confirmed draw and motions before they are public,
  // as in Tabbycat. The page itself loads only the public projection, so their records come from
  // the administrator's working copy on this device, or the staff member's assistant data.
  const access = projectorAccess({ isOwnerOrAdmin, isDataEntryAssistant, permissions: staffPermissions });
  const mayProjectEarly = access.draw || access.motions;
  const tournamentId = tournament?.id;
  useEffect(() => {
    if (!mayProjectEarly || typeof window === "undefined") {
      setStaffCopy(null);
      return;
    }
    let active = true;
    const load = async (): Promise<ProjectorStaffCopy> => {
      if (isOwnerOrAdmin) {
        const store = getLocalStore();
        const [rounds, debates, motions] = await Promise.all(
          ["rounds", "debates", "motions"].map((name) => store.read(`crabbytab_t_${tournamentSlug}_${name}`))
        );
        return {
          rounds: safeJsonParse<Round[]>(rounds, []),
          debates: safeJsonParse<Debate[]>(debates, []),
          motions: safeJsonParse<Motion[]>(motions, []),
        };
      }
      if (!user || !tournamentId) throw new Error("Sign in to project the staff copy.");
      const token = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournamentId)}/assistant-data`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        collections?: { rounds?: Round[]; debates?: Debate[]; motions?: Motion[] };
      };
      if (!response.ok) throw new Error(result.error || `Could not load staff data (${response.status}).`);
      return {
        rounds: result.collections?.rounds ?? [],
        debates: result.collections?.debates ?? [],
        motions: result.collections?.motions ?? [],
      };
    };
    load()
      .then((copy) => {
        // No working copy on this device (e.g. a fresh projector laptop): the public view stays.
        if (active) setStaffCopy(copy.rounds.length > 0 ? copy : null);
      })
      .catch((error: unknown) => {
        console.warn("Could not load the staff copy for the projector:", error);
        if (active) setStaffCopy(null);
      });
    return () => {
      active = false;
    };
  }, [mayProjectEarly, isOwnerOrAdmin, user, tournamentId, tournamentSlug, staffCopyReload]);

  const staffDraw = access.draw && staffCopy !== null;
  const staffMotions = access.motions && staffCopy !== null;
  const staffRound = staffCopy
    ? staffProjectorRound(staffCopy.rounds, prefs?.currentRoundId, publicActiveRound?.id)
    : undefined;
  const activeRound = (staffDraw || staffMotions) && staffRound ? staffRound : publicActiveRound;
  const rounds = staffDraw && staffCopy ? staffCopy.rounds : publicRounds;
  const debates = staffDraw && staffCopy ? staffCopy.debates : publicDebates;
  const motions = staffMotions && staffCopy ? staffCopy.motions : publicMotions;

  // For non-staff viewers, the round's draw must be on the public draw page: the projection marks
  // it under the draw mode (current round only / every released draw); older views fall back to
  // the legacy switch and the draw status. Staff projecting their copy see confirmed draws.
  // Concurrent rounds of the active round's schedule slot are shown together (Tabbycat's "current
  // rounds" display), each under its own heading.
  const slotRounds = projectorRounds(activeRound, rounds, { staff: true, legacyPublicDraw: true, concurrent: true });
  const hasConcurrent = slotRounds.length > 1;
  const shownRounds = projectorRounds(activeRound, rounds, {
    staff: staffDraw,
    legacyPublicDraw: prefs?.publicDraw !== false,
    concurrent: showConcurrent,
  });
  const showDraw = shownRounds.length > 0;
  const showAdjudicatorsFor = (round: Round) => staffDraw || round.adjudicatorsRevealed === true;
  const showMotions = staffMotions || prefs?.publicMotions !== false;

  const shownRoundIds = new Set(shownRounds.map((round) => round.id));
  const roundDebates = debates.filter((d) => shownRoundIds.has(d.roundId));
  // Three-state release: viewers see nothing, the info slides only, or the motions (motionRelease.ts).
  const motionsStatus = motionsStatusOf(activeRound ?? undefined);
  const infoSlidesOnly = !staffMotions && motionsStatus === "info_slides_released";
  const roundMotions = showMotions && (staffMotions || motionsStatus !== "not_released")
    ? motionsForDisplay(motions, activeRound?.id, staffMotions, motionsStatus)
    : [];
  const revealSteps = buildMotionRevealSteps(roundMotions, { roundId: activeRound?.id, infoSlidesOnly });
  const revealStep = revealSteps[Math.min(revealIndex, revealSteps.length - 1)];
  const releasedHeaderMotion = roundMotions.find((motion) => motion.released === true);
  const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];

  useEffect(() => {
    setRevealIndex(0);
  }, [activeRound?.id, revealSteps.length]);

  const revealIndexRef = useRef(revealIndex);
  revealIndexRef.current = revealIndex;
  const revealRef = useRef<HTMLElement>(null);
  // Focus the slide so Space advances it rather than re-pressing the view button.
  useEffect(() => {
    if (view === "motions") revealRef.current?.focus();
  }, [view]);
  useEffect(() => {
    if (view !== "motions") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      // Space and Enter on a focused button activate that button instead.
      if (target?.tagName === "BUTTON" && (event.key === " " || event.key === "Enter")) return;
      if (event.key === "Escape") {
        setView("rooms");
        return;
      }
      const current = revealIndexRef.current;
      const next = nextRevealStep(current, event.key, revealSteps.length);
      if (next === current) return;
      event.preventDefault();
      setRevealIndex(next);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, revealSteps.length]);

  useEffect(() => {
    if (!autoScroll || view === "motions") return;
    let dir = 1;
    const id = window.setInterval(() => {
      const el = document.getElementById("display-scroll");
      if (!el) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) dir = -1;
      if (el.scrollTop <= 0) dir = 1;
      el.scrollBy({ top: 2 * dir });
    }, 40);
    return () => window.clearInterval(id);
  }, [autoScroll, view, roundDebates.length]);

  const drawHidden = (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface p-10 text-center">
      <Lock className="h-8 w-8 text-fg-subtle" aria-hidden="true" />
      <p className="text-base font-semibold">{t("results.display.drawHiddenTitle")}</p>
      <p className="text-sm text-fg-muted">{t("results.display.drawHiddenBody")}</p>
    </div>
  );

  /** "Motion 2 · Reference" when a round has several motions; otherwise just the reference. */
  const motionLabel = (index: number, reference?: string) => {
    if (roundMotions.length > 1) {
      return reference
        ? t("results.display.motionNumberWithReference", { number: index + 1, reference })
        : t("results.display.motionNumber", { number: index + 1 });
    }
    return reference ?? "";
  };

  /** One round's draw in the selected view (by team or by room). */
  const renderRoundDraw = (round: Round, debatesOfRound: Debate[]) => {
    const showAdjudicators = showAdjudicatorsFor(round);
    return view === "teams" ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-start">
                <caption className="sr-only">{t("results.display.byTeamCaption")}</caption>
                <thead className="bg-muted text-sm uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-start">{t("results.display.column.team")}</th>
                    <th scope="col" className="px-4 py-2 text-start">{t("results.display.column.side")}</th>
                    <th scope="col" className="px-4 py-2 text-start">{t("results.display.column.room")}</th>
                    <th scope="col" className="px-4 py-2 text-start">{t("results.display.column.against")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {buildAlphabeticalDraw(debatesOfRound, isBP).map((row) => (
                    <tr key={row.teamId} className="bg-surface">
                      <th scope="row" className="px-4 py-2 text-start font-semibold">{row.teamName}</th>
                      <td className="px-4 py-2">
                        {row.side
                          ? <SideBadge side={row.side} preferences={prefs} />
                          : row.bye ? t("results.display.bye") : t("results.display.sidesAtDebate")}
                      </td>
                      <td className="px-4 py-2 font-semibold text-accent-text">
                        {row.bye ? "—" : row.venueName || t("common.tba")}
                      </td>
                      <td className="px-4 py-2 text-fg-muted">{row.opponents.length ? formatList(row.opponents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
    ) : (
            <div className="space-y-3">
              {debatesOfRound.map((debate) => {
                const byeTeam = debate.byeTeamId
                  ? Object.values(debate.teams).find((slot) => slot?.teamId === debate.byeTeamId)
                  : undefined;
                return (
                  <div key={debate.id} className="rounded-lg border border-border bg-surface p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-accent-text">
                        {debate.byeTeamId
                          ? t("results.display.bye")
                          : debate.venueName || t("results.display.roomFallback", { rank: debate.roomRank })}
                      </span>
                      <span className="text-sm text-fg-muted">
                        {debate.byeTeamId
                          ? t("results.display.noAdjudicatorNeeded")
                          : t("results.display.chair", {
                              name: showAdjudicators ? debate.adjudicators?.chairName || t("common.tba") : t("common.tba"),
                            })}
                      </span>
                    </div>
                    {debate.byeTeamId ? (
                      <div className="rounded-md border border-border bg-muted p-4">
                        <div className="font-semibold">{byeTeam?.teamName || t("results.display.teamFallback")}</div>
                        <div className="mt-1 text-sm text-fg-muted">
                          {debate.byeResult === "win" ? t("results.display.byeWin") : t("results.display.byeAbsent")}
                        </div>
                      </div>
                    ) : (
                      <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", (isBP || isPolyFormat(tournament?.format)) && "xl:grid-cols-4")}>
                        {(tournament && isPolyFormat(tournament.format) ? debateSides(debate, tournament) : sides).map((side) => (
                          <div key={side} className="rounded-md border border-border bg-muted p-3">
                            {sidesPending(debate)
                              ? <span className="text-[11px] font-semibold uppercase text-fg-muted">{t("results.display.sidesAtDebate")}</span>
                              : <SideBadge side={side} preferences={prefs} />}
                            <div className="mt-2 font-semibold">{debate.teams[side]?.teamName || "—"}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {showAdjudicators && !debate.byeTeamId &&
                      ((debate.adjudicators?.panellistNames?.length || 0) > 0 ||
                        (debate.adjudicators?.traineeNames?.length || 0) > 0) && (
                      <div className="mt-3 space-y-1 text-sm text-fg-muted">
                        {debate.adjudicators?.panellistNames?.length ? (
                          <p>{t("results.display.panellists", { names: formatList(debate.adjudicators.panellistNames) })}</p>
                        ) : null}
                        {debate.adjudicators?.traineeNames?.length ? (
                          <p>{t("results.display.trainees", { names: formatList(debate.adjudicators.traineeNames) })}</p>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
    );
  };

  // `theme-projector` (globals.css) is a high-contrast palette for projection: black canvas,
  // white text, yellow accent, saturated side colours. It ignores the viewer's light/dark choice.
  return (
    <div className="theme-projector min-h-screen bg-background p-4 text-fg sm:p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm uppercase tracking-widest text-fg-muted">
            <Monitor className="h-4 w-4" aria-hidden="true" />
            <span>{t("results.display.eyebrow")}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            {t("results.display.heading", {
              tournament: tournament?.name ?? "",
              round: view !== "motions" && shownRounds.length > 1
                ? formatList(shownRounds.map((round) => round.name))
                : activeRound?.name || t("results.display.noRound"),
            })}
          </h1>
          {view !== "motions" && releasedHeaderMotion && (
            <p className="mt-2 text-lg italic text-fg-muted">{releasedHeaderMotion.text}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={t("results.display.viewGroup")}
            className="flex divide-x divide-border-strong overflow-hidden rounded-md border border-border-strong rtl:divide-x-reverse"
          >
            {(Object.keys(VIEW_LABELS) as DisplayView[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                aria-pressed={view === item}
                className={toggleClasses(view === item)}
              >
                {t(VIEW_LABELS[item])}
              </button>
            ))}
          </div>
          <Button
            onClick={() => setScale((s) => Math.max(0.8, s - 0.1))}
            aria-label={t("results.display.textSmaller")}
            title={t("results.display.textSmaller")}
          >
            A−
          </Button>
          <Button
            onClick={() => setScale((s) => Math.min(1.6, s + 0.1))}
            aria-label={t("results.display.textLarger")}
            title={t("results.display.textLarger")}
          >
            A+
          </Button>
          {view !== "motions" && hasConcurrent && (
            <Button onClick={() => setShowConcurrent((v) => !v)} aria-pressed={showConcurrent}>
              {t("results.display.concurrentRounds")}
            </Button>
          )}
          {mayProjectEarly && (
            <Button
              onClick={() => setStaffCopyReload((count) => count + 1)}
              title={t("results.display.reloadStaffCopyHint")}
            >
              {t("results.display.reloadStaffCopy")}
            </Button>
          )}
          {view !== "motions" && (
            <Button onClick={() => setAutoScroll((v) => !v)} aria-pressed={autoScroll}>
              {autoScroll ? t("results.display.pauseScroll") : t("results.display.autoScroll")}
            </Button>
          )}
        </div>
      </div>

      {view === "motions" ? (
        <section
          ref={revealRef}
          tabIndex={-1}
          aria-label={t("results.display.view.motions")}
          aria-live="polite"
          className="flex min-h-[calc(100vh-12rem)] flex-col rounded-lg border border-border bg-surface focus:outline-none"
          style={{ fontSize: `${scale}rem` }}
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center sm:px-14">
            {!showMotions ? (
              <p className="text-fg-muted">{t("results.display.motionsNotPublic")}</p>
            ) : roundMotions.length === 0 || !revealStep ? (
              <p className="text-fg-muted">
                {staffMotions ? t("results.display.noMotionsStaff") : t("results.display.noMotionsPublic")}
              </p>
            ) : revealStep.kind === "cover" ? (
              <>
                <p className="text-sm font-bold uppercase tracking-widest text-accent-text">{activeRound?.name}</p>
                <p className="text-4xl font-bold sm:text-6xl">
                  {infoSlidesOnly
                    ? plural("results.display.infoSlidesCover", roundMotions.length)
                    : plural("results.display.motionsCover", roundMotions.length)}
                </p>
                <p className="text-sm text-fg-muted">{t("results.display.pressToReveal")}</p>
              </>
            ) : revealStep.kind === "info" ? (
              <div className="w-full max-w-4xl text-start">
                <p className="mb-3 text-sm font-bold uppercase text-accent-text">
                  {roundMotions.length > 1
                    ? t("results.display.infoSlideForMotion", { number: revealStep.index + 1 })
                    : t("results.display.infoSlide")}
                </p>
                <p className="whitespace-pre-line text-xl leading-relaxed sm:text-2xl">
                  {revealStep.motion.infoSlide}
                </p>
              </div>
            ) : (
              <>
                {(roundMotions.length > 1 || revealStep.motion.reference) && (
                  <p className="text-sm font-bold uppercase text-accent-text">
                    {motionLabel(revealStep.index, revealStep.motion.reference)}
                  </p>
                )}
                <p className="max-w-5xl text-3xl font-bold leading-tight sm:text-5xl">{revealStep.motion.text}</p>
              </>
            )}
            {staffMotions && revealStep && revealStep.kind !== "cover" && (
              revealStep.kind === "info" ? motionsStatus === "not_released" : revealStep.motion.released !== true
            ) && (
              <p className="rounded-md border border-warning-border bg-warning-subtle px-2 py-1 text-xs font-semibold text-warning">
                {revealStep.kind === "info"
                  ? t("results.display.previewInfoSlides")
                  : t("results.display.previewMotion")}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
            <Button
              variant="ghost"
              size="lg"
              className="text-fg"
              onClick={() => setRevealIndex((index) => nextRevealStep(index, "ArrowLeft", revealSteps.length))}
              disabled={revealIndex === 0}
            >
              <ChevronLeft className="rtl:-scale-x-100" aria-hidden="true" /> {t("results.display.back")}
            </Button>
            <span className="text-center text-fg-muted">
              {t("results.display.stepStatus", {
                step: Math.min(revealIndex, revealSteps.length - 1) + 1,
                total: revealSteps.length,
              })}
            </span>
            <Button
              variant="ghost"
              size="lg"
              className="text-fg"
              onClick={() => setRevealIndex((index) => nextRevealStep(index, "ArrowRight", revealSteps.length))}
              disabled={revealIndex >= revealSteps.length - 1}
            >
              {t("results.display.next")} <ChevronRight className="rtl:-scale-x-100" aria-hidden="true" />
            </Button>
          </div>
        </section>
      ) : (
        <div
          id="display-scroll"
          className="max-h-[calc(100vh-11rem)] overflow-y-auto pe-2"
          style={{ fontSize: `${scale}rem` }}
        >
          {!showDraw ? (
            drawHidden
          ) : roundDebates.length === 0 ? (
            <p className="text-fg-muted">{t("results.display.noDraw")}</p>
          ) : (
            <div className="space-y-6">
              {shownRounds.map((round) => {
                const debatesOfRound = roundDebates.filter((debate) => debate.roundId === round.id);
                return (
                  <section key={round.id} aria-label={round.name} className="space-y-3">
                    {shownRounds.length > 1 && (
                      <h2 className="text-lg font-bold uppercase tracking-wide text-accent-text">{round.name}</h2>
                    )}
                    {debatesOfRound.length === 0
                      ? <p className="text-fg-muted">{t("results.display.noDraw")}</p>
                      : renderRoundDraw(round, debatesOfRound)}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
