"use client";

import { isDrawPubliclyReleased } from "@/lib/draw/drawStatus";
import { sideMessage, translatedSideName } from "@/lib/sideNames";
import { isPolyFormat, tournamentSides } from "@/lib/debateSides";
import { SCORE_DISPLAY_OPTIONS } from "@/lib/scoreDisplay";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicCenteredCard, PublicShell } from "@/components/public/PublicShell";
import { ChoiceChips } from "@/components/public/ChoiceChips";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, Section } from "@/components/ui/Card";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { useFocusTrap } from "@/components/ui/useFocusTrap";
import {
  Trophy,
  Shuffle,
  Lightbulb,
  Award,
  ListOrdered,
  Mic,
  MessageSquareQuote,
  FileCheck2,
  Presentation,
  ChevronLeft,
  ChevronRight,
  X,
  ArrowUp,
  ArrowDown,
  Users,
  Building2,
  Gavel,
  Scale,
  ArrowLeftRight,
  Network,
  ChartPie,
  ClipboardCheck,
  Loader2,
  House,
} from "lucide-react";
import type { DebateAdjudicatorSlot, DebateSide } from "@/types";
import { sidesPending } from "@/lib/draw/manualSides";
import { calculateStandings } from "@/lib/standings/calculator";
import { speakersInCategory, sortSpeakerCategories } from "@/lib/speakerCategories";
import { formatMetricValue } from "@/lib/standings/metrics";
import { resolveSpeakerExtra, resolveTeamExtra } from "@/lib/standings/precedence";
import type { MessageKey } from "@/lib/i18n";
import {
  buildPublicBreak,
  getPublicRelease,
  isAnyTabReleased,
  isTabRound,
} from "@/lib/publicRelease";
import { canShowAggregateTeamScores } from "@/lib/publicScoreVisibility";
import { computeMotionStatistics } from "@/lib/motionStatistics";
import { buildPublicAdjudicatorLists, buildPublicInstitutions, buildPublicParticipants } from "@/lib/publicLists";
import {
  AdjudicatorListsPanel,
  InstitutionsPanel,
  MotionStatisticsSummary,
  ParticipantsPanel,
} from "@/features/tournament/components/public/PublicListPanels";
import {
  AdjudicatorTabPanel,
  BracketPanel,
  DiversityPanel,
  FeedbackProgressPanel,
  PublicDebateMotionLabel,
  PublicPersonName,
  PublicTeamName,
  ScoresheetsPanel,
  SideAllocationsPanel,
  SplitMarker,
  splittingAdjudicators,
  publicRecordLinkClass,
} from "@/features/tournament/components/public/PublicSitePanels";
import { usePublicExtras } from "@/features/tournament/components/public/usePublicExtras";
import { PublicFormLinks } from "@/features/tournament/components/public/forms/PublicBallotForm";
import { PublicSiteLinks } from "@/features/tournament/components/public/PublicSiteLinks";
import { PublicHomePanel } from "@/features/tournament/components/public/PublicHomePanel";
import { usePublicSiteStatus } from "@/features/tournament/components/public/usePublicSiteStatus";
import { registrationOpen } from "@/lib/publicView/siteLinks";
import { getPublicSiteSettings, orderPublicMotions } from "@/lib/publicFeatures";
import { debateMotion, publicRecordPath } from "@/lib/publicRecords";

type PublicTab =
  | "home"
  | "draw"
  | "results"
  | "standings"
  | "teamTab"
  | "speakerTab"
  | "repliesTab"
  | "motions"
  | "break"
  | "participants"
  | "institutions"
  | "adjudicators"
  | "adjudicatorTab"
  | "sideAllocations"
  | "bracket"
  | "diversity"
  | "feedbackProgress";

const PUBLIC_TABS: readonly PublicTab[] = [
  "home",
  "draw",
  "results",
  "standings",
  "teamTab",
  "speakerTab",
  "repliesTab",
  "motions",
  "break",
  "participants",
  "institutions",
  "adjudicators",
  "adjudicatorTab",
  "sideAllocations",
  "bracket",
  "diversity",
  "feedbackProgress",
];

/** The tab a `?tab=` link asks for (e.g. `/open/public?tab=draw`), if it names one. */
function requestedTab(search: string): PublicTab | undefined {
  const tab = new URLSearchParams(search).get("tab");
  return PUBLIC_TABS.find((candidate) => candidate === tab);
}

export default function PublicTournamentPage() {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;

  const {
    tournament,
    loading,
    cloudLoadError,
    activeRound,
    rounds,
    setActiveRound,
    debates,
    ballots,
    teams,
    motions,
    breakCategories,
    venues,
    adjudicators,
    institutions,
    publicRoundsLoading,
  } = useTournament();
  const { t, plural, formatDecimal, formatList, formatNumber } = useI18n();
  // "all" or a public speaker category id (Tabbycat's per-category speaker tabs).
  const [speakerCategoryId, setSpeakerCategoryId] = useState("all");
  // "all" or a break category id (Tabbycat's break category team tabs).
  const [teamTabCategoryId, setTeamTabCategoryId] = useState("all");
  const [openScoresheetDebateId, setOpenScoresheetDebateId] = useState<string | null>(null);
  const extras = usePublicExtras();
  const siteStatus = usePublicSiteStatus(tournamentSlug);

  const getVenueCategory = (venueId?: string, venueName?: string): string | undefined => {
    if (!venueId && !venueName) return undefined;
    const v = venues.find(
      (item) => (venueId && item.id === venueId) || (venueName && item.name === venueName)
    );
    return v?.category?.trim() || undefined;
  };

  const isBP = tournament?.format === "bp";
  const formatLabel = tournament ? t(`format.${tournament.format}`) : t("common.tournament");
  const prefs = tournament?.preferences;

  // S1: Public toggles
  const site = getPublicSiteSettings(prefs);
  const showPublicDraw = site.drawMode !== "off";
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const adjudicatorsById = new Map(adjudicators.map((adjudicator) => [adjudicator.id, adjudicator]));
  const teamHref = (teamId: string) => (site.recordPages && teamsById.has(teamId) ? publicRecordPath(tournamentSlug, "team", teamId) : undefined);
  const adjudicatorHref = (adjudicatorId: string) =>
    site.recordPages && adjudicatorsById.has(adjudicatorId) && !adjudicatorsById.get(adjudicatorId)?.anonymous
      ? publicRecordPath(tournamentSlug, "adjudicator", adjudicatorId)
      : undefined;
  const showPublicResults = prefs?.publicResults !== false;
  const hasPublicTeamSpeaks = rounds.some(
    (round) => round.resultsReleased && round.teamSpeaksReleased && !round.silent
  );
  const showPublicStandings = prefs?.publicStandings !== false && hasPublicTeamSpeaks;
  // The motions page and the motion statistics (Tabbycat `motion_tab_released`) are released
  // separately; either one shows the motions tab.
  const showPublicMotions = site.motionsPage || site.motionTab;
  // Tournament-level releases (team/speaker/replies tab, break per category).
  const release = getPublicRelease(prefs);
  // Tabs are computed when the view is published (top-N limits applied there); see lib/publicView/derived.ts.
  const tabRounds = isAnyTabReleased(release) ? rounds.filter(isTabRound) : [];
  const tabRoundIds = new Set(tabRounds.map((round) => round.id));
  const publicTabs = extras.tabs;
  const tabRoundCount = publicTabs?.roundCount ?? 0;
  const breakCategoryTabIds = Object.keys(publicTabs?.breakCategoryTabs ?? {}).filter(
    (categoryId) => (publicTabs?.breakCategoryTabs?.[categoryId]?.length ?? 0) > 0
  );
  const showTeamTab = tabRoundCount > 0 && ((release.teamTab && Boolean(publicTabs?.teamTab)) || breakCategoryTabIds.length > 0);
  const overallSpeakerTab = release.speakerTab && Boolean(publicTabs?.speakerTab);
  const showRepliesTab = release.repliesTab && tabRoundCount > 0 && Boolean(publicTabs?.repliesTab);
  const teamTabOptions = [
    ...(release.teamTab && publicTabs?.teamTab ? [{ id: "all", name: t("public.allTeams") }] : []),
    ...breakCategories
      .filter((category) => breakCategoryTabIds.includes(category.id))
      .sort((left, right) => left.seq - right.seq)
      .map((category) => ({ id: category.id, name: category.name })),
  ];
  const selectedTeamTabId = teamTabOptions.some((option) => option.id === teamTabCategoryId)
    ? teamTabCategoryId
    : teamTabOptions[0]?.id ?? "all";
  const teamTabRows = (selectedTeamTabId === "all" ? publicTabs?.teamTab : publicTabs?.breakCategoryTabs?.[selectedTeamTabId]) ?? [];
  // The selected tab's top-N limit: the site-wide team tab limit, or the break category's own.
  const selectedTeamTabLimit =
    selectedTeamTabId === "all" ? site.teamTabLimit : publicTabs?.limits.breakCategories?.[selectedTeamTabId] ?? 0;
  // The projection only sends public categories; each one with speakers gets its own speaker tab.
  const publicSpeakerCategories = sortSpeakerCategories(
    (prefs?.speakerCategories ?? []).filter((category) => category.public)
  ).filter((category) =>
    speakersInCategory(teams, category.id, prefs?.speakerCategories ?? []) > 0 &&
    // Category tabs are released with the speaker tab or on their own (`releaseSpeakerCategoryTabs`).
    Boolean(publicTabs?.speakerCategoryTabs?.[category.id])
  );
  const showSpeakerTab = tabRoundCount > 0 && (overallSpeakerTab || publicSpeakerCategories.length > 0);
  const selectedSpeakerCategory =
    publicSpeakerCategories.find((category) => category.id === speakerCategoryId) ??
    (overallSpeakerTab ? undefined : publicSpeakerCategories[0]);
  const speakerTabRows = (selectedSpeakerCategory
    ? publicTabs?.speakerCategoryTabs?.[selectedSpeakerCategory.id]
    : publicTabs?.speakerTab) ?? [];
  const tabRankByTeamId = new Map((publicTabs?.teamTab ?? []).map((row) => [row.teamId, row.rank]));
  // The "extra" metrics the tab director chose to show (calculated, not used to rank).
  const teamExtra = resolveTeamExtra(prefs);
  const speakerExtra = resolveSpeakerExtra(prefs);
  const publicBreak = buildPublicBreak(breakCategories, teams, release, (teamId) => tabRankByTeamId.get(teamId));
  const showPublicBreak = publicBreak.length > 0;
  const showParticipants = release.participants;
  const showInstitutions = release.institutions;
  const showAdjudicatorLists = release.adjudicatorCore || release.breakingAdjudicators;
  const participants = buildPublicParticipants(
    teams,
    adjudicators,
    release,
    site.breakCategoriesOnParticipants ? new Map(breakCategories.map((category) => [category.id, category.name])) : undefined
  );
  const derived = extras.derived;
  const showAdjudicatorTab = site.adjudicatorTab && Boolean(derived.adjudicatorTab);
  const showSideAllocations = site.sideAllocations && Boolean(derived.sideAllocations);
  const showBracket = site.bracket && showPublicDraw && rounds.some((round) => round.stage === "elimination");
  const showDiversity = site.diversity && Boolean(derived.diversity);
  const showFeedbackProgress = site.feedbackProgress && Boolean(derived.feedbackProgress);
  const institutionRows = buildPublicInstitutions(institutions, teams, adjudicators, release);
  const adjudicatorLists = buildPublicAdjudicatorLists(adjudicators, release);

  // Available tabs based on preferences. Home (the organiser's homepage, or the welcome message)
  // is always first and is where the page opens.
  const availableTabs: PublicTab[] = ["home"];
  if (showPublicDraw) availableTabs.push("draw");
  if (showPublicResults) availableTabs.push("results");
  if (showPublicStandings) availableTabs.push("standings");
  if (showTeamTab) availableTabs.push("teamTab");
  if (showSpeakerTab) availableTabs.push("speakerTab");
  if (showRepliesTab) availableTabs.push("repliesTab");
  if (showPublicMotions) availableTabs.push("motions");
  if (showPublicBreak) availableTabs.push("break");
  if (showParticipants) availableTabs.push("participants");
  if (showInstitutions) availableTabs.push("institutions");
  if (showAdjudicatorLists) availableTabs.push("adjudicators");
  if (showAdjudicatorTab) availableTabs.push("adjudicatorTab");
  if (showSideAllocations) availableTabs.push("sideAllocations");
  if (showBracket) availableTabs.push("bracket");
  if (showDiversity) availableTabs.push("diversity");
  if (showFeedbackProgress) availableTabs.push("feedbackProgress");

  const [activeTab, setActiveTab] = useState<PublicTab>("home");
  const [searchQuery, setSearchQuery] = useState("");
  const [isMotionPresentation, setIsMotionPresentation] = useState(false);
  const [motionSlideIndex, setMotionSlideIndex] = useState(0);

  // Rounds on the public draw page: the projection marks them ("drawPublic") under the draw mode
  // (current round only, or every released draw); older views fall back to the draw status.
  const isOnDrawPage = (round: (typeof rounds)[number]) =>
    (round as typeof round & { drawPublic?: boolean }).drawPublic ??
    isDrawPubliclyReleased(round);
  const drawRounds = rounds.filter((round) => !round.cancelled && isOnDrawPage(round)).sort((left, right) => left.seq - right.seq);
  const drawRound = drawRounds.find((round) => round.id === activeRound?.id) ?? drawRounds[drawRounds.length - 1];
  const drawDebates = drawRound ? debates.filter((debate) => debate.roundId === drawRound.id) : [];
  const showDrawAdjudicators = drawRound?.adjudicatorsRevealed === true;

  // Only released debates/rounds
  const releasedDebates = activeRound
    ? debates.filter(
        (d) =>
          d.roundId === activeRound.id &&
          isDrawPubliclyReleased(activeRound)
      )
    : [];

  const roundResultsReleased = Boolean(activeRound?.resultsReleased && !activeRound.silent);
  const showPublicAdjudicators = activeRound?.adjudicatorsRevealed === true;
  const roundTeamSpeaksReleased = Boolean(roundResultsReleased && activeRound?.teamSpeaksReleased);

  const releasedMotions = orderPublicMotions(
    motions.filter((motion) => motion.released === true),
    site.motionsOrder,
    new Map(rounds.map((round) => [round.id, round.seq]))
  );

  const publicRounds = rounds.filter((round) => round.resultsReleased && !round.silent);
  const publicRoundIds = new Set(publicRounds.map((round) => round.id));
  const showAggregateTeamScores = canShowAggregateTeamScores(rounds);
  const publicBallots = ballots.filter(
    (ballot) => ballot.confirmed && !ballot.discarded && publicRoundIds.has(ballot.roundId)
  );
  const publicDebates = debates.filter((debate) => publicRoundIds.has(debate.roundId));
  const publicStandings = tournament
    ? calculateStandings(tournament, publicRounds, teams, publicDebates, publicBallots)
    : { teams: [], speakers: [], replies: [] };

  const ballotMap = new Map<string, any>();
  publicBallots.forEach((ballot) => ballotMap.set(ballot.debateId, ballot));
  // Same gate as the projection (public round results or a released tab), applied again so a local
  // working copy never feeds unreleased results into the statistics.
  const motionStatisticBallots = ballots.filter(
    (ballot) => publicRoundIds.has(ballot.roundId) || tabRoundIds.has(ballot.roundId)
  );
  const motionStatistics = new Map(
    // Tabbycat has no motion statistics for more or fewer than two teams (other than BP).
    !site.motionTab || isPolyFormat(tournament?.format) ? [] : computeMotionStatistics(releasedMotions, debates, motionStatisticBallots, isBP).map((statistic) => [
      statistic.motion.id,
      statistic,
    ])
  );

  useEffect(() => {
    setMotionSlideIndex((index) => Math.min(index, Math.max(0, releasedMotions.length - 1)));
  }, [releasedMotions.length]);

  // A `?tab=` link opens that tab. Read after mount (the server render has no URL search), and kept
  // as the active tab even while that tab's data is still loading: until it is available the page
  // shows Home (see shownTab), then switches to it.
  useEffect(() => {
    const tab = requestedTab(window.location.search);
    if (tab) setActiveTab(tab);
  }, []);

  /** Switches tab and records it in the URL (replacing the history entry) so the view can be shared. */
  const selectTab = (tab: PublicTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "home") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url);
  };

  useEffect(() => {
    if (!isMotionPresentation) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMotionPresentation(false);
      if (event.key === "ArrowRight") {
        setMotionSlideIndex((index) => Math.min(index + 1, releasedMotions.length - 1));
      }
      if (event.key === "ArrowLeft") setMotionSlideIndex((index) => Math.max(index - 1, 0));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMotionPresentation, releasedMotions.length]);

  /** A team cell of the draw: emoji, public name (record link), and its speakers when shown in the draw. */
  const renderDrawTeam = (slot: { teamId: string; teamName?: string } | undefined) => {
    if (!slot?.teamId) return "—";
    const team = teamsById.get(slot.teamId);
    return (
      <>
        <PublicTeamName team={team} name={slot.teamName ?? team?.name} recordHref={teamHref(slot.teamId)} />
        {site.showSpeakersInDraw && team && team.speakers.length > 0 && (
          <span className="block text-[11px] font-normal text-fg-muted">
            {team.speakers.map((speaker, index) => (
              <React.Fragment key={speaker.id}>
                {index > 0 && ", "}
                <PublicPersonName name={speaker.name} anonymous={speaker.anonymous} />
              </React.Fragment>
            ))}
          </span>
        )}
      </>
    );
  };

  /** Adjudicators in one panel role: redacted when anonymous, linked to records, splits marked. */
  const panelMembers = (
    slot: Partial<DebateAdjudicatorSlot> | undefined,
    role: "chair" | "panellists" | "trainees",
    splits: Set<string> = new Set()
  ): React.ReactNode => {
    const members =
      role === "chair"
        ? slot?.chairId || slot?.chairName ? [{ id: slot?.chairId, name: slot?.chairName ?? "" }] : []
        : (role === "panellists" ? slot?.panellistIds ?? [] : slot?.traineeIds ?? []).map((id, index) => ({
            id,
            name: (role === "panellists" ? slot?.panellistNames : slot?.traineeNames)?.[index] ?? adjudicatorsById.get(id)?.name ?? "",
          }));
    if (members.length === 0) return "—";
    return members.map((member, index) => {
      const anonymous = member.id ? adjudicatorsById.get(member.id)?.anonymous === true : false;
      const href = member.id ? adjudicatorHref(member.id) : undefined;
      const label = <PublicPersonName name={member.name} anonymous={anonymous} />;
      return (
        <React.Fragment key={member.id ?? index}>
          {index > 0 && ", "}
          {href ? <Link href={href} className={publicRecordLinkClass}>{label}</Link> : label}
          {member.id && splits.has(member.id) && <SplitMarker />}
        </React.Fragment>
      );
    });
  };

  if (loading) {
    return (
      <PublicShell title={t("public.defaultTitle")}>
        <div className="flex flex-col items-center gap-2 py-16">
          <Loader2 className="h-6 w-6 animate-spin text-fg-subtle motion-reduce:animate-none" aria-hidden="true" />
          <p role="status" className="text-xs text-fg-muted">{t("public.loading")}</p>
        </div>
      </PublicShell>
    );
  }

  if (cloudLoadError) {
    return (
      <PublicShell title={tournament?.name || t("public.defaultTitle")}>
        <PublicCenteredCard>
          <h1 className="text-[15px] font-semibold text-fg">{t("public.unavailableTitle")}</h1>
          <Alert role="alert" tone="warning">{cloudLoadError}</Alert>
        </PublicCenteredCard>
      </PublicShell>
    );
  }

  const sectionIcons: Record<PublicTab, React.ReactNode> = {
    home: <House aria-hidden="true" />,
    draw: <Shuffle aria-hidden="true" />,
    results: <FileCheck2 aria-hidden="true" />,
    standings: <Trophy aria-hidden="true" />,
    teamTab: <ListOrdered aria-hidden="true" />,
    speakerTab: <Mic aria-hidden="true" />,
    repliesTab: <MessageSquareQuote aria-hidden="true" />,
    motions: <Lightbulb aria-hidden="true" />,
    break: <Award aria-hidden="true" />,
    participants: <Users aria-hidden="true" />,
    institutions: <Building2 aria-hidden="true" />,
    adjudicators: <Gavel aria-hidden="true" />,
    adjudicatorTab: <Scale aria-hidden="true" />,
    sideAllocations: <ArrowLeftRight aria-hidden="true" />,
    bracket: <Network aria-hidden="true" />,
    diversity: <ChartPie aria-hidden="true" />,
    feedbackProgress: <ClipboardCheck aria-hidden="true" />,
  };
  const sectionLabels: Record<PublicTab, string> = {
    home: t("public.tab.home"),
    draw: t("public.tab.draw"),
    results: t("public.tab.results"),
    standings: t("public.tab.standings"),
    teamTab: t("public.tab.teamTab"),
    speakerTab: t("public.tab.speakerTab"),
    repliesTab: t("public.tab.repliesTab"),
    motions: site.motionsPage
      ? t("public.tab.motions", { count: releasedMotions.length })
      : t("public.tab.motionStatistics", { count: releasedMotions.length }),
    break: t("public.tab.break"),
    participants: t("public.tab.participants"),
    institutions: t("public.tab.institutions"),
    adjudicators: release.adjudicatorCore ? t("public.tab.adjudicationCore") : t("public.tab.breakingAdjudicators"),
    adjudicatorTab: t("public.tab.adjudicatorTab"),
    sideAllocations: t("public.tab.sideAllocations"),
    bracket: t("public.tab.bracket"),
    diversity: t("public.tab.diversity"),
    feedbackProgress: t("public.tab.feedbackProgress"),
  };
  const shownTab: PublicTab = availableTabs.includes(activeTab) ? activeTab : "home";
  const poly = isPolyFormat(tournament?.format);
  const drawSides = (tournament && poly ? tournamentSides(tournament) : isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"]) as DebateSide[];
  const sideHeader = (side: DebateSide) =>
    isBP ? <abbr title={sideMessage(t, side)} className="no-underline">{side}</abbr> : translatedSideName(t, side, tournament?.preferences);

  const roundPicker = (pickable: typeof rounds, selectedId: string | undefined) => (
    <ChoiceChips
      label={t("public.roundPicker")}
      showLabel
      options={pickable.map((round) => ({ value: round.id, label: round.name }))}
      value={selectedId}
      onChange={(roundId) => {
        const round = pickable.find((item) => item.id === roundId);
        if (round) setActiveRound(round);
      }}
    />
  );

  return (
    <PublicShell
      titleAs="h1"
      title={tournament?.name || t("public.defaultTitle")}
      subtitle={t("public.subtitle", { format: formatLabel })}
      nav={
        <Tabs
          id="public-sections"
          ariaLabel={t("public.sections")}
          items={availableTabs.map((tab) => ({ value: tab, label: sectionLabels[tab], icon: sectionIcons[tab] }))}
          value={shownTab}
          onValueChange={selectTab}
          className="border-b-0"
        />
      }
    >
      {publicRoundsLoading && (
        <p role="status" className="text-xs text-fg-muted">
          {t("public.loadingRounds")}
        </p>
      )}
      <PublicFormLinks slug={tournamentSlug} ballot={site.ballotForm} feedback={site.feedbackForm && prefs?.feedbackEnabled !== false} />
      <PublicSiteLinks
        slug={tournamentSlug}
        schedule={prefs?.publicSchedule === true}
        checkins={prefs?.publicCheckInStatus === true}
        status={siteStatus}
      />

      <TabPanel id="public-sections" value={shownTab} className="space-y-4">
          {/* 0. Home: the organiser's homepage, or the welcome message */}
          {shownTab === "home" && (
            <PublicHomePanel
              slug={tournamentSlug}
              homepage={site.homepage}
              welcomeMessage={site.welcomeMessage}
              staff={site.tournamentStaff}
              registrationOpen={registrationOpen(siteStatus.registrationState)}
              nothingElsePublished={availableTabs.length === 1}
            />
          )}

          {/* 1. Draw */}
          {shownTab === "draw" && (
            <>
              {site.drawMode === "current"
                ? drawRound && <p className="text-[13px] font-medium text-fg-muted">{t("public.currentRound", { round: drawRound.name })}</p>
                : roundPicker(drawRounds, drawRound?.id)}

              {drawDebates.length === 0 ? (
                <EmptyState
                  icon={<Shuffle />}
                  title={t("public.drawNotReleased", { round: drawRound?.name || activeRound?.name || t("public.thisRound") })}
                />
              ) : (
                <TableContainer>
                  <Table className="text-start">
                    <caption className="sr-only">{sectionLabels.draw}</caption>
                    <THead>
                      <TR>
                        <TH>{t("public.col.venue")}</TH>
                        {drawSides.map((side) => <TH key={side}>{sideHeader(side)}</TH>)}
                        <TH>{t("public.col.chair")}</TH>
                        <TH>{t("public.col.panellists")}</TH>
                        <TH>{t("public.col.trainees")}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {drawDebates.map((d, idx) => {
                        const venueCategory = getVenueCategory(d.venueId, d.venueName);
                        return (
                          <TR key={d.id}>
                            <TD>
                              <span className="font-medium text-fg">{d.venueName || t("public.roomFallback", { number: idx + 1 })}</span>
                              {venueCategory && <span className="block text-[11px] text-fg-muted">{venueCategory}</span>}
                            </TD>
                            {drawSides.map((side) => (
                              <TD key={side} className="font-medium">
                                {renderDrawTeam(d.teams?.[side])}
                                {!isBP && sidesPending(d) && (
                                  <span className="block text-[11px] font-normal text-fg-muted">{t("common.sidesTbc")}</span>
                                )}
                              </TD>
                            ))}
                            <TD>{showDrawAdjudicators ? panelMembers(d.adjudicators, "chair") : t("common.tba")}</TD>
                            <TD className="text-fg-muted">{showDrawAdjudicators ? panelMembers(d.adjudicators, "panellists") : t("common.tba")}</TD>
                            <TD className="text-fg-muted">{showDrawAdjudicators ? panelMembers(d.adjudicators, "trainees") : t("common.tba")}</TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}

          {/* 2. Results and scores */}
          {shownTab === "results" && (
            <>
              {roundPicker(rounds, activeRound?.id)}

              {activeRound?.silent ? (
                <Alert tone="warning">{t("public.resultsSilent", { round: activeRound.name })}</Alert>
              ) : !roundResultsReleased || releasedDebates.length === 0 ? (
                <EmptyState
                  icon={<FileCheck2 />}
                  title={t("public.resultsNotReleased", { round: activeRound?.name || t("public.thisRound") })}
                />
              ) : (
                <Card className="overflow-hidden">
                  <CardHeader title={t("public.resultsTitle", { round: activeRound?.name ?? "" })} />
                  <div className="overflow-x-auto">
                    <Table className="text-start">
                      <THead>
                        <TR>
                          <TH>{t("public.col.venue")}</TH>
                          {isBP ? (
                            <>
                              <TH>{t("public.col.openingGovRanked")}</TH>
                              <TH>{t("side.OO")}</TH>
                              <TH>{t("side.CG")}</TH>
                              <TH>{t("side.CO")}</TH>
                            </>
                          ) : (
                            <>
                              {drawSides.map((side) => <TH key={side}>{translatedSideName(t, side, tournament?.preferences)}</TH>)}
                            </>
                          )}
                          <TH>{t("public.col.adjudicators")}</TH>
                          {site.motionsInResults && <TH>{t("public.col.motion")}</TH>}
                          <TH align="center">{t("public.col.status")}</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {releasedDebates.map((d) => {
                          const ballot = ballotMap.get(d.id);
                          const venueCategory = getVenueCategory(d.venueId, d.venueName);
                          const splits = splittingAdjudicators(ballot);
                          const canShowScoresheets = site.ballots && roundTeamSpeaksReleased && Boolean(ballot);
                          const scoresheetsOpen = canShowScoresheets && openScoresheetDebateId === d.id;
                          const scoresheetsId = `scoresheets-${d.id}`;

                          return (
                            <React.Fragment key={d.id}>
                              <TR>
                                <TD>
                                  <div className="font-medium text-fg">{d.venueName || "—"}</div>
                                  {venueCategory && <Badge className="mt-0.5">{venueCategory}</Badge>}
                                </TD>
                                {drawSides.map((side) => {
                                  const tSlot = d.teams[side];
                                  const tScore = ballot?.teamScores?.[side];
                                  // Poly: ranked (scored), advancing (results only) or neither (score-only voting ballots).
                                  const won = tScore
                                    ? isBP ? tScore.rank === 1 : poly ? (tScore.rank !== undefined ? tScore.rank === 1 : tScore.win) : tScore.win
                                    : undefined;
                                  return (
                                    <TD key={side}>
                                      <div className="font-medium text-fg">
                                        {won !== undefined &&
                                          (won ? (
                                            <ArrowUp className="me-1 inline h-3.5 w-3.5 text-success" aria-label={t("public.winningTeam")} />
                                          ) : (
                                            <ArrowDown className="me-1 inline h-3.5 w-3.5 text-danger" aria-label={t("public.losingTeam")} />
                                          ))}
                                        {tSlot?.teamId ? (
                                          <PublicTeamName team={teamsById.get(tSlot.teamId)} name={tSlot.teamName} recordHref={teamHref(tSlot.teamId)} />
                                        ) : "—"}
                                      </div>
                                      {tScore && (
                                        <div className="font-mono text-[11px] text-fg-muted">
                                          {isBP || (poly && tScore.rank !== undefined)
                                            ? t("public.rank", { rank: tScore.rank ?? 0 })
                                            : poly ? (tScore.win ? t("results.ballot.advances") : "")
                                            : tScore.win ? t("public.win") : t("public.loss")}
                                          {roundTeamSpeaksReleased && (
                                            <>
                                              {(isBP || (poly && tScore.rank !== undefined)) && <> &bull; {t("public.points", { points: tScore.points })}</>}
                                              {" "}&bull; {t("public.speaks", { speaks: formatNumber(tScore.totalSpeakerScore, SCORE_DISPLAY_OPTIONS) })}
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </TD>
                                  );
                                })}
                                <TD className="min-w-[12rem] text-xs text-fg-muted">
                                  <span className="font-medium">{t("public.chairLabel")}</span>{" "}
                                  <span className="font-medium text-fg">
                                    {showPublicAdjudicators ? panelMembers(d.adjudicators, "chair", splits) : t("common.tba")}
                                  </span>
                                  <span className="block">
                                    <span className="font-medium">{t("public.panellistsLabel")}</span>{" "}
                                    {showPublicAdjudicators ? panelMembers(d.adjudicators, "panellists", splits) : t("common.tba")}
                                  </span>
                                  <span className="block">
                                    <span className="font-medium">{t("public.traineesLabel")}</span>{" "}
                                    <span className="italic">{showPublicAdjudicators ? panelMembers(d.adjudicators, "trainees") : t("common.tba")}</span>
                                  </span>
                                </TD>
                                {site.motionsInResults && (
                                  <TD className="text-xs">
                                    <PublicDebateMotionLabel motion={debateMotion(d, ballot, motions)} />
                                  </TD>
                                )}
                                <TD align="center">
                                  {ballot?.confirmed ? (
                                    <StatusPill tone="success">{t("public.confirmed")}</StatusPill>
                                  ) : (
                                    <StatusPill tone="neutral">{t("public.pending")}</StatusPill>
                                  )}
                                  {canShowScoresheets && (
                                    <button
                                      type="button"
                                      aria-expanded={scoresheetsOpen}
                                      aria-controls={scoresheetsOpen ? scoresheetsId : undefined}
                                      onClick={() => setOpenScoresheetDebateId(scoresheetsOpen ? null : d.id)}
                                      className={cn("mt-1 block w-full rounded-sm text-[11px] font-medium text-accent-text hover:underline", focusRing)}
                                    >
                                      {scoresheetsOpen ? t("public.hideScoresheets") : t("public.showScoresheets")}
                                    </button>
                                  )}
                                </TD>
                              </TR>
                              {scoresheetsOpen && (
                                <tr id={scoresheetsId}>
                                  <td colSpan={drawSides.length + 3 + (site.motionsInResults ? 1 : 0)} className="border-b border-border p-0">
                                    <ScoresheetsPanel
                                      debate={d}
                                      ballot={ballot}
                                      sides={drawSides}
                                      teamName={(side) => d.teams?.[side]?.teamName || t("public.noPublicName")}
                                      replyPosition={prefs?.replyScoresEnabled && !isBP ? 4 : undefined}
                                    />
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </TBody>
                    </Table>
                  </div>
                </Card>
              )}
            </>
          )}

          {/* 3. Standings */}
          {shownTab === "standings" && (
            <Card className="overflow-hidden">
              <CardHeader title={t("public.teamStandings")} />
              <div className="overflow-x-auto">
                <Table className="text-start">
                  <THead>
                    <TR>
                      <TH align="center" className="w-12">#</TH>
                      <TH>{t("public.col.team")}</TH>
                      <TH>{t("public.col.institution")}</TH>
                      {showAggregateTeamScores && <TH align="right">{t("public.col.points")}</TH>}
                      {showAggregateTeamScores && <TH align="right">{t("public.col.totalSpeaks")}</TH>}
                      {showAggregateTeamScores && <TH align="right">{t("public.col.avgSpeaks")}</TH>}
                    </TR>
                  </THead>
                  <TBody>
                    {publicStandings.teams.length === 0 && <TableEmpty colSpan={showAggregateTeamScores ? 6 : 3}>{t("public.noRows")}</TableEmpty>}
                    {publicStandings.teams.map((row) => (
                      <TR key={row.teamId}>
                        <TD align="center" className="font-mono text-xs font-semibold">{row.rank}</TD>
                        <TD className="font-medium">
                          <PublicTeamName team={teamsById.get(row.teamId)} name={row.teamName} recordHref={teamHref(row.teamId)} />
                        </TD>
                        <TD className="text-fg-muted">{row.institutionCode || "—"}</TD>
                        {showAggregateTeamScores && <TD numeric className="font-semibold">{row.points}</TD>}
                        {showAggregateTeamScores && <TD numeric>{formatDecimal(row.totalSpeakerScore, 1)}</TD>}
                        {showAggregateTeamScores && <TD numeric className="text-fg-muted">{formatDecimal(row.averageSpeakerScore, 2)}</TD>}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
          )}

          {/* 3b. Released team tab (and break category team tabs) */}
          {shownTab === "teamTab" && (
            <Card className="overflow-hidden">
              <CardHeader
                title={t("public.tabTitle", {
                  tab: t("public.tab.teamTab"),
                  rounds: plural("public.completedRounds", tabRoundCount),
                })}
              />
              {(teamTabOptions.length > 1 || selectedTeamTabLimit > 0) && (
                <ChoiceChips
                  label={t("public.teamTabCategory")}
                  className="border-b border-border px-4 py-2"
                  options={teamTabOptions.length > 1 ? teamTabOptions.map((option) => ({ value: option.id, label: option.name })) : []}
                  value={selectedTeamTabId}
                  onChange={setTeamTabCategoryId}
                >
                  {selectedTeamTabLimit > 0 && (
                    <span className="text-[11px] text-fg-muted">{t("public.topLimit", { limit: selectedTeamTabLimit })}</span>
                  )}
                </ChoiceChips>
              )}
              <div className="overflow-x-auto">
                <Table className="text-start">
                  <THead>
                    <TR>
                      <TH align="center" className="w-12">#</TH>
                      <TH>{t("public.col.team")}</TH>
                      <TH>{t("public.col.institution")}</TH>
                      <TH align="right">{isBP || poly ? t("public.col.points") : t("public.col.wins")}</TH>
                      <TH align="right">{t("public.col.totalSpeaks")}</TH>
                      <TH align="right">{t("public.col.avgSpeaks")}</TH>
                      {teamExtra.map((metric) => (
                        <TH key={metric} align="right">{t(`metric.team.${metric}` as MessageKey)}</TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {teamTabRows.length === 0 && <TableEmpty colSpan={6 + teamExtra.length}>{t("public.noRows")}</TableEmpty>}
                    {teamTabRows.map((row) => (
                      <TR key={row.teamId}>
                        <TD align="center" className="font-mono text-xs font-semibold">{row.rank}</TD>
                        <TD className="font-medium">
                          <PublicTeamName team={teamsById.get(row.teamId)} name={row.teamName} recordHref={teamHref(row.teamId)} />
                        </TD>
                        <TD className="text-fg-muted">{row.institutionCode || "—"}</TD>
                        <TD numeric className="font-semibold">{isBP || poly ? row.points : row.wins ?? row.points}</TD>
                        <TD numeric>{formatDecimal(row.totalSpeakerScore, 1)}</TD>
                        <TD numeric className="text-fg-muted">{formatDecimal(row.averageSpeakerScore, 2)}</TD>
                        {teamExtra.map((metric) => (
                          <TD key={metric} numeric className="text-fg-muted">
                            {row.metrics[metric] !== undefined ? formatMetricValue(row.metrics[metric]!) : "—"}
                          </TD>
                        ))}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
          )}

          {/* 3c. Released speaker / replies tabs */}
          {(shownTab === "speakerTab" || shownTab === "repliesTab") && (
            <Card className="overflow-hidden">
              <CardHeader
                title={t("public.tabTitle", {
                  tab: shownTab === "repliesTab" ? t("public.tab.repliesTab") : t("public.tab.speakerTab"),
                  rounds: plural("public.completedRounds", tabRoundCount),
                })}
              />
              {shownTab === "speakerTab" && publicSpeakerCategories.length > 0 && (
                <ChoiceChips
                  label={t("public.speakerCategory")}
                  className="border-b border-border px-4 py-2"
                  options={[...(overallSpeakerTab ? [{ id: "all", name: t("public.allSpeakers") }] : []), ...publicSpeakerCategories].map((category) => ({
                    value: category.id,
                    label: category.name,
                  }))}
                  value={selectedSpeakerCategory?.id ?? "all"}
                  onChange={setSpeakerCategoryId}
                >
                  {selectedSpeakerCategory?.limit ? (
                    <span className="text-[11px] text-fg-muted">
                      {t("public.categoryLimit", { limit: selectedSpeakerCategory.limit, category: selectedSpeakerCategory.name })}
                    </span>
                  ) : null}
                </ChoiceChips>
              )}
              {((shownTab === "speakerTab" && !selectedSpeakerCategory && site.speakerTabLimit > 0) ||
                (shownTab === "repliesTab" && site.repliesTabLimit > 0)) && (
                <p className="border-b border-border px-4 py-1.5 text-[11px] text-fg-muted">
                  {t("public.topLimit", { limit: shownTab === "repliesTab" ? site.repliesTabLimit : site.speakerTabLimit })}
                </p>
              )}
              <div className="overflow-x-auto">
                <Table className="text-start">
                  <THead>
                    <TR>
                      <TH align="center" className="w-12">#</TH>
                      <TH>{t("public.col.speaker")}</TH>
                      <TH>{t("public.col.team")}</TH>
                      <TH align="right">{t("public.col.total")}</TH>
                      <TH align="right">{t("public.col.average")}</TH>
                      <TH align="right">{t("public.col.speeches")}</TH>
                      {shownTab !== "repliesTab" && speakerExtra.map((metric) => (
                        <TH key={metric} align="right">{t(`metric.speaker.${metric}` as MessageKey)}</TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {(() => {
                      const rows = shownTab === "repliesTab" ? publicTabs?.repliesTab ?? [] : speakerTabRows;
                      const columns = 6 + (shownTab !== "repliesTab" ? speakerExtra.length : 0);
                      if (rows.length === 0) return <TableEmpty colSpan={columns}>{t("public.noRows")}</TableEmpty>;
                      return rows.map((row) => (
                        <TR key={`${row.teamId}-${row.speakerId}`}>
                          <TD align="center" className="font-mono text-xs font-semibold">
                            {row.ineligible ? <span title={t("public.unrankedHint")}>—</span> : row.rank}
                          </TD>
                          <TD className="font-medium">
                            <PublicPersonName name={row.speakerName} anonymous={row.anonymous} />
                            {row.ineligible && <Badge className="ms-2">{t("public.unranked")}</Badge>}
                          </TD>
                          <TD className="text-fg-muted">
                            {row.anonymous ? (
                              <span className="italic">{t("public.redacted")}</span>
                            ) : (
                              <PublicTeamName team={teamsById.get(row.teamId)} name={row.teamName} recordHref={teamHref(row.teamId)} />
                            )}
                          </TD>
                          <TD numeric className="font-semibold">{formatDecimal(row.totalScore, 1)}</TD>
                          <TD numeric className="text-fg-muted">{formatDecimal(row.averageScore, 2)}</TD>
                          <TD numeric className="text-fg-muted">{row.speechesCount}</TD>
                          {shownTab !== "repliesTab" && speakerExtra.map((metric) => (
                            <TD key={metric} numeric className="text-fg-muted">
                              {row.metrics[metric] !== undefined ? formatMetricValue(row.metrics[metric]!) : "—"}
                            </TD>
                          ))}
                        </TR>
                      ));
                    })()}
                  </TBody>
                </Table>
              </div>
            </Card>
          )}

          {/* 4. Motions */}
          {shownTab === "motions" && (
            <Section
              title={site.motionsPage ? t("public.releasedMotions") : t("public.motionStatisticsTitle")}
              actions={
                site.motionsPage && <Button
                  size="sm"
                  onClick={() => setIsMotionPresentation(true)}
                  disabled={releasedMotions.length === 0}
                >
                  <Presentation aria-hidden="true" />
                  {t("public.presentMotions")}
                </Button>
              }
            >
              {releasedMotions.length === 0 ? (
                <EmptyState icon={<Lightbulb />} title={t("public.noMotions")} />
              ) : (
                releasedMotions.map((m) => {
                  const assignedRounds = rounds.filter((r) => m.rounds && m.rounds.includes(r.id));
                  const assignedRoundNames = formatList(assignedRounds.map((r) => r.name));
                  const vetoesBySide = site.vetoStatistics ? derived.vetoes?.[m.id] : undefined;

                  return (
                    <Card key={m.id} className="p-4 sm:p-5">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge tone="accent">{m.reference || t("public.motionFallback")}</Badge>
                        {assignedRoundNames ? (
                          <Badge>{t("public.motionRounds", { rounds: assignedRoundNames })}</Badge>
                        ) : (
                          <span className="text-xs italic text-fg-muted">{t("public.unassignedRound")}</span>
                        )}
                      </div>
                      <blockquote className="my-2.5 border-s-2 border-accent ps-3 text-[15px] font-semibold leading-snug text-fg">
                        &ldquo;{m.text}&rdquo;
                      </blockquote>
                      {site.motionsPage && m.infoSlide && (
                        <div className="mt-2 rounded-md border border-border bg-muted p-3 text-[13px] text-fg">
                          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">{t("public.infoslide")}</p>
                          <p className="whitespace-pre-line">{m.infoSlide}</p>
                        </div>
                      )}
                      {motionStatistics.get(m.id) && (
                        <MotionStatisticsSummary statistic={motionStatistics.get(m.id)!} isBP={isBP} />
                      )}
                      {vetoesBySide && (() => {
                        const entries = Object.entries(vetoesBySide) as Array<[DebateSide, number]>;
                        const total = entries.reduce((sum, [, count]) => sum + count, 0);
                        return (
                          <p className="mt-2 text-xs text-fg-muted">
                            {t("public.vetoes", { count: total })}
                            {entries.length > 1 && (
                              <span className="ms-2">
                                {t("public.vetoesBySide", { sides: formatList(entries.map(([side, count]) => `${translatedSideName(t, side, tournament?.preferences)} ${count}`)) })}
                              </span>
                            )}
                          </p>
                        );
                      })()}
                    </Card>
                  );
                })
              )}
            </Section>
          )}

          {/* 5. Break */}
          {shownTab === "break" && publicBreak.map((res) => (
            <Card key={res.category.id} className="overflow-hidden">
              <CardHeader title={t("public.breakTitle", { category: res.category.name, size: res.category.breakSize })} />
              <div className="overflow-x-auto">
                <Table className="text-start">
                  <THead>
                    <TR>
                      <TH align="center" className="w-16">{t("public.col.seed")}</TH>
                      <TH>{t("public.col.team")}</TH>
                      <TH>{t("public.col.institution")}</TH>
                      {(derived.breakMetrics?.metricIds ?? []).map((metric) => (
                        <TH key={metric} align="right">{t(`metric.team.${metric}` as MessageKey)}</TH>
                      ))}
                    </TR>
                  </THead>
                  <TBody>
                    {res.teams.map((b) => (
                      <TR key={b.team.id}>
                        <TD align="center" className="font-mono text-xs font-semibold">{b.seed}</TD>
                        <TD className="font-medium">
                          <PublicTeamName team={b.team} recordHref={teamHref(b.team.id)} />
                        </TD>
                        <TD className="text-fg-muted">{b.team.institutionName || "—"}</TD>
                        {(derived.breakMetrics?.metricIds ?? []).map((metric) => {
                          const value = derived.breakMetrics?.teams[b.team.id]?.[metric];
                          return (
                            <TD key={metric} numeric className="text-fg-muted">
                              {value !== undefined ? formatMetricValue(value) : "—"}
                            </TD>
                          );
                        })}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
          ))}

          {shownTab === "participants" && (
            <ParticipantsPanel
              participants={participants}
              showBreakCategories={site.breakCategoriesOnParticipants}
              showUnaccredited={site.showUnaccredited}
              teamHref={teamHref}
              adjudicatorHref={adjudicatorHref}
            />
          )}
          {shownTab === "adjudicatorTab" && derived.adjudicatorTab && (
            <AdjudicatorTabPanel tab={derived.adjudicatorTab} recordHref={adjudicatorHref} />
          )}
          {shownTab === "sideAllocations" && derived.sideAllocations && (
            <SideAllocationsPanel allocations={derived.sideAllocations} teamsById={teamsById} />
          )}
          {shownTab === "bracket" && (
            <BracketPanel rounds={rounds} debates={debates} ballots={ballots} teamsById={teamsById} isBP={isBP} teamHref={teamHref} />
          )}
          {shownTab === "diversity" && derived.diversity && <DiversityPanel diversity={derived.diversity} />}
          {shownTab === "feedbackProgress" && derived.feedbackProgress && (
            <FeedbackProgressPanel progress={derived.feedbackProgress} />
          )}
          {shownTab === "institutions" && <InstitutionsPanel institutions={institutionRows} />}
          {shownTab === "adjudicators" && (
            <AdjudicatorListsPanel
              lists={adjudicatorLists}
              showCore={release.adjudicatorCore}
              showBreaking={release.breakingAdjudicators}
              showUnaccredited={site.showUnaccredited}
            />
          )}
      </TabPanel>

      {isMotionPresentation && releasedMotions[motionSlideIndex] && (
        <MotionPresentation
          motion={releasedMotions[motionSlideIndex]}
          roundNames={formatList(
            rounds.filter((r) => releasedMotions[motionSlideIndex].rounds?.includes(r.id)).map((r) => r.name)
          )}
          index={motionSlideIndex}
          total={releasedMotions.length}
          motionIds={releasedMotions.map((motion) => motion.id)}
          onPrevious={() => setMotionSlideIndex((index) => Math.max(index - 1, 0))}
          onNext={() => setMotionSlideIndex((index) => Math.min(index + 1, releasedMotions.length - 1))}
          onClose={() => setIsMotionPresentation(false)}
        />
      )}
    </PublicShell>
  );
}


/**
 * Full-screen motion slides for projecting in the venue. Arrow keys and Escape are handled by the
 * page; this traps focus so keyboard users stay inside the presentation.
 */
function MotionPresentation({
  motion,
  roundNames,
  index,
  total,
  motionIds,
  onPrevious,
  onNext,
  onClose,
}: {
  motion: { reference?: string; text: string; infoSlide?: string };
  roundNames: string;
  index: number;
  total: number;
  motionIds: string[];
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, { active: true });
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("public.presentation.label")}
      className="fixed inset-0 z-[60] flex flex-col bg-background text-fg"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
              {t("public.presentation.position", { index: index + 1, total })}
            </p>
            {roundNames && <Badge>{t("public.motionRounds", { rounds: roundNames })}</Badge>}
          </div>
          <p className="mt-1 truncate text-sm font-semibold">{motion.reference || t("public.presentation.fallback")}</p>
        </div>
        <IconButton label={t("public.presentation.close")} icon={<X aria-hidden="true" />} onClick={onClose} />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-6 py-10 text-center sm:px-14">
        {roundNames && (
          <Badge tone="accent" className="h-6 px-2.5 text-xs">{t("public.presentation.assignedTo", { rounds: roundNames })}</Badge>
        )}
        <p className="max-w-5xl text-3xl font-semibold leading-tight sm:text-5xl">{motion.text}</p>
        {motion.infoSlide && (
          <div className="w-full max-w-4xl border-t border-border pt-6 text-start">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">{t("public.presentation.infoSlide")}</p>
            <p className="whitespace-pre-line text-base leading-relaxed text-fg sm:text-lg">{motion.infoSlide}</p>
          </div>
        )}
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-8">
        <Button variant="ghost" onClick={onPrevious} disabled={index === 0}>
          <ChevronLeft className="rtl:-scale-x-100" aria-hidden="true" /> {t("public.presentation.previous")}
        </Button>
        <div className="flex items-center gap-1.5" role="img" aria-label={t("public.presentation.slide", { index: index + 1 })}>
          {motionIds.map((id, dot) => (
            <span key={id} className={cn("h-1.5 w-5 rounded-full", dot === index ? "bg-accent" : "bg-border-strong")} />
          ))}
        </div>
        <Button variant="ghost" onClick={onNext} disabled={index === total - 1}>
          {t("public.presentation.next")} <ChevronRight className="rtl:-scale-x-100" aria-hidden="true" />
        </Button>
      </footer>
    </div>
  );
}
