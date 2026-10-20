"use client";

import { SCORE_DISPLAY_OPTIONS } from "@/lib/scoreDisplay";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import {
  Trophy,
  Shuffle,
  Lightbulb,
  Award,
  ArrowLeft,
  Sparkles,
  ListOrdered,
  Mic,
  MessageSquareQuote,
  FileCheck2,
  Lock,
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
  PublicPersonName,
  PublicTeamName,
  ScoresheetsPanel,
  SideAllocationsPanel,
  SplitMarker,
  WelcomePanel,
  splittingAdjudicators,
} from "@/features/tournament/components/public/PublicSitePanels";
import { usePublicExtras } from "@/features/tournament/components/public/usePublicExtras";
import { getPublicSiteSettings, orderPublicMotions } from "@/lib/publicFeatures";
import { publicRecordPath } from "@/lib/publicRecords";

type PublicTab =
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
  const showPublicMotions = prefs?.publicMotions !== false;
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
  const showSpeakerTab = release.speakerTab && tabRoundCount > 0 && Boolean(publicTabs?.speakerTab);
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
  // The projection only sends public categories; each one with speakers gets its own speaker tab.
  const publicSpeakerCategories = sortSpeakerCategories(
    (prefs?.speakerCategories ?? []).filter((category) => category.public)
  ).filter((category) => speakersInCategory(teams, category.id, prefs?.speakerCategories ?? []) > 0);
  const selectedSpeakerCategory = publicSpeakerCategories.find((category) => category.id === speakerCategoryId);
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

  // Available tabs based on preferences
  const availableTabs: PublicTab[] = [];
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

  const [activeTab, setActiveTab] = useState<PublicTab>(availableTabs[0] || "draw");
  const [searchQuery, setSearchQuery] = useState("");
  const [isMotionPresentation, setIsMotionPresentation] = useState(false);
  const [motionSlideIndex, setMotionSlideIndex] = useState(0);

  // Rounds on the public draw page: the projection marks them ("drawPublic") under the draw mode
  // (current round only, or every released draw); older views fall back to the draw status.
  const isOnDrawPage = (round: (typeof rounds)[number]) =>
    (round as typeof round & { drawPublic?: boolean }).drawPublic ??
    (round.drawStatus === "confirmed" || round.drawStatus === "released");
  const drawRounds = rounds.filter((round) => !round.cancelled && isOnDrawPage(round)).sort((left, right) => left.seq - right.seq);
  const drawRound = drawRounds.find((round) => round.id === activeRound?.id) ?? drawRounds[drawRounds.length - 1];
  const drawDebates = drawRound ? debates.filter((debate) => debate.roundId === drawRound.id) : [];
  const showDrawAdjudicators = drawRound?.adjudicatorsRevealed === true;

  // Only released debates/rounds
  const releasedDebates = activeRound
    ? debates.filter(
        (d) =>
          d.roundId === activeRound.id &&
          (activeRound.drawStatus === "confirmed" || activeRound.drawStatus === "released")
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
    computeMotionStatistics(releasedMotions, debates, motionStatisticBallots, isBP).map((statistic) => [
      statistic.motion.id,
      statistic,
    ])
  );

  useEffect(() => {
    setMotionSlideIndex((index) => Math.min(index, Math.max(0, releasedMotions.length - 1)));
  }, [releasedMotions.length]);

  const availableTabsKey = availableTabs.join("|");
  useEffect(() => {
    const tabs = availableTabsKey.split("|") as PublicTab[];
    if (!tabs.includes(activeTab)) setActiveTab(tabs[0] || "draw");
  }, [activeTab, availableTabsKey]);

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
          <span className="block text-[10px] font-normal text-gray-500">
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
          {href ? <Link href={href} className="hover:underline">{label}</Link> : label}
          {member.id && splits.has(member.id) && <SplitMarker />}
        </React.Fragment>
      );
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p role="status" className="text-xs text-gray-500">{t("public.loading")}</p>
        </div>
      </div>
    );
  }

  if (cloudLoadError) {
    return (
      <div className="min-h-screen bg-[#f6f8fa] flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white border border-amber-200 rounded-xl p-8 text-center shadow-sm space-y-3">
          <h1 className="text-lg font-bold text-gray-900">{t("public.unavailableTitle")}</h1>
          <p role="alert" className="text-xs text-gray-600 leading-relaxed">{cloudLoadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col">
      {/* Public Header */}
      <header className="bg-[#24292e] text-white border-b border-[#1b1f23] py-4 px-6 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center font-mono font-bold text-sm text-white"
            >
              CT
            </Link>
            <div>
              <h1 className="text-base sm:text-lg font-bold tracking-tight">
                {tournament?.name || t("public.defaultTitle")}
              </h1>
              <span className="text-[11px] text-gray-400">
                {t("public.subtitle", { format: formatLabel })}
              </span>
            </div>
          </div>
          <LanguageSwitcher triggerClassName="shrink-0 text-gray-100 hover:bg-white/10 hover:text-white" />
        </div>
      </header>

      {/* Navigation Pills (S1: hide matching sections if toggle is off) */}
      <div className="bg-white border-b border-[#d0d7de] sticky top-14 z-40">
        <nav aria-label={t("public.sections")} className="max-w-6xl mx-auto px-6 py-2.5 flex items-center gap-2 overflow-x-auto">
          {showPublicDraw && (
            <button
              onClick={() => setActiveTab("draw")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 ${
                activeTab === "draw"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Shuffle className="w-3.5 h-3.5" />
              <span>{t("public.tab.draw")}</span>
            </button>
          )}

          {showPublicResults && (
            <button
              onClick={() => setActiveTab("results")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 ${
                activeTab === "results"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>{t("public.tab.results")}</span>
            </button>
          )}

          {showPublicStandings && (
            <button
              onClick={() => setActiveTab("standings")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 ${
                activeTab === "standings"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>{t("public.tab.standings")}</span>
            </button>
          )}

          {showTeamTab && (
            <button
              onClick={() => setActiveTab("teamTab")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 ${
                activeTab === "teamTab"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span>{t("public.tab.teamTab")}</span>
            </button>
          )}

          {showSpeakerTab && (
            <button
              onClick={() => setActiveTab("speakerTab")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 ${
                activeTab === "speakerTab"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>{t("public.tab.speakerTab")}</span>
            </button>
          )}

          {showRepliesTab && (
            <button
              onClick={() => setActiveTab("repliesTab")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 ${
                activeTab === "repliesTab"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <MessageSquareQuote className="w-3.5 h-3.5" />
              <span>{t("public.tab.repliesTab")}</span>
            </button>
          )}

          {showPublicMotions && (
            <button
              onClick={() => setActiveTab("motions")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 ${
                activeTab === "motions"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span>{t("public.tab.motions", { count: releasedMotions.length })}</span>
            </button>
          )}

          {showPublicBreak && (
            <button
              onClick={() => setActiveTab("break")}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 ${
                activeTab === "break"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>{t("public.tab.break")}</span>
            </button>
          )}

          {([
            { tab: "participants", show: showParticipants, label: t("public.tab.participants"), Icon: Users },
            { tab: "institutions", show: showInstitutions, label: t("public.tab.institutions"), Icon: Building2 },
            {
              tab: "adjudicators",
              show: showAdjudicatorLists,
              label: release.adjudicatorCore ? t("public.tab.adjudicationCore") : t("public.tab.breakingAdjudicators"),
              Icon: Gavel,
            },
            { tab: "adjudicatorTab", show: showAdjudicatorTab, label: t("public.tab.adjudicatorTab"), Icon: Scale },
            { tab: "sideAllocations", show: showSideAllocations, label: t("public.tab.sideAllocations"), Icon: ArrowLeftRight },
            { tab: "bracket", show: showBracket, label: t("public.tab.bracket"), Icon: Network },
            { tab: "diversity", show: showDiversity, label: t("public.tab.diversity"), Icon: ChartPie },
            { tab: "feedbackProgress", show: showFeedbackProgress, label: t("public.tab.feedbackProgress"), Icon: ClipboardCheck },
          ] as const).filter((item) => item.show).map(({ tab, label, Icon }) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              aria-pressed={activeTab === tab}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === tab ? "bg-blue-600 text-white shadow-xs" : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Icon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {publicRoundsLoading && (
          <p role="status" className="max-w-6xl mx-auto px-6 pb-2 text-xs text-gray-500">
            {t("public.loadingRounds")}
          </p>
        )}
      </div>

      {/* Main Public Content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full space-y-6">
        <WelcomePanel message={site.welcomeMessage} staff={site.tournamentStaff} />
        {/* 1. Draw View */}
        {showPublicDraw && activeTab === "draw" && (
          <div className="space-y-4">
            {site.drawMode === "current" ? (
              drawRound && (
                <p className="text-xs font-bold text-gray-600">{t("public.currentRound", { round: drawRound.name })}</p>
              )
            ) : (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="text-xs font-bold text-gray-500 uppercase me-1">{t("public.roundPicker")}</span>
                {drawRounds.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActiveRound(r)}
                    aria-pressed={drawRound?.id === r.id}
                    className={`px-3 py-1 text-xs font-bold rounded border ${
                      drawRound?.id === r.id
                        ? "bg-blue-600 text-white border-blue-700"
                        : "bg-white text-gray-700 border-gray-300"
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}

            {drawDebates.length === 0 ? (
              <div className="bg-white border border-[#d0d7de] rounded-lg p-10 text-center text-gray-500 text-xs">
                {t("public.drawNotReleased", { round: drawRound?.name || activeRound?.name || t("public.thisRound") })}
              </div>
            ) : (
              <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-start tabby-table">
                    <thead>
                      <tr>
                        <th>{t("public.col.venue")}</th>
                        {isBP ? (
                          <>
                            <th><abbr title={t("side.OG")}>OG</abbr></th>
                            <th><abbr title={t("side.OO")}>OO</abbr></th>
                            <th><abbr title={t("side.CG")}>CG</abbr></th>
                            <th><abbr title={t("side.CO")}>CO</abbr></th>
                          </>
                        ) : (
                          <>
                            <th>{t("side.AFF")}</th>
                            <th>{t("side.NEG")}</th>
                          </>
                        )}
                        <th>{t("public.col.chair")}</th>
                        <th>{t("public.col.panellists")}</th>
                        <th>{t("public.col.trainees")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drawDebates.map((d, idx) => {
                        const venueCategory = getVenueCategory(d.venueId, d.venueName);
                        return (
                          <tr key={d.id} className="hover:bg-gray-50">
                            <td className="text-xs">
                              <span className="font-bold text-gray-900">{d.venueName || t("public.roomFallback", { number: idx + 1 })}</span>
                              {venueCategory && (
                                <span className="block text-[10px] text-blue-700">{venueCategory}</span>
                              )}
                            </td>
                            {(isBP ? (["OG", "OO", "CG", "CO"] as DebateSide[]) : (["AFF", "NEG"] as DebateSide[])).map((side) => (
                              <td key={side} className="text-xs font-semibold text-gray-900">
                                {renderDrawTeam(d.teams?.[side])}
                                {!isBP && sidesPending(d) && (
                                  <span className="block text-[10px] font-normal text-gray-500">{t("common.sidesTbc")}</span>
                                )}
                              </td>
                            ))}
                            <td className="text-xs font-medium text-gray-900">
                              {showDrawAdjudicators ? panelMembers(d.adjudicators, "chair") : t("common.tba")}
                            </td>
                            <td className="text-xs text-gray-700">
                              {showDrawAdjudicators ? panelMembers(d.adjudicators, "panellists") : t("common.tba")}
                            </td>
                            <td className="text-xs text-gray-600">
                              {showDrawAdjudicators ? panelMembers(d.adjudicators, "trainees") : t("common.tba")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 2. Results & Scores View (S1: publicResults) */}
        {showPublicResults && activeTab === "results" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-xs font-bold text-gray-500 uppercase me-1">{t("public.roundPicker")}</span>
              {rounds.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setActiveRound(r)}
                  className={`px-3 py-1 text-xs font-bold rounded border ${
                    activeRound?.id === r.id
                      ? "bg-blue-600 text-white border-blue-700"
                      : "bg-white text-gray-700 border-gray-300"
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>

            {activeRound?.silent ? (
              <div className="bg-white border border-amber-300 rounded-lg p-10 text-center text-amber-900 text-xs">
                {t("public.resultsSilent", { round: activeRound.name })}
              </div>
            ) : !roundResultsReleased || releasedDebates.length === 0 ? (
              <div className="bg-white border border-[#d0d7de] rounded-lg p-10 text-center text-gray-500 text-xs">
                {t("public.resultsNotReleased", { round: activeRound?.name || t("public.thisRound") })}
              </div>
            ) : (
              <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
                <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">
                  {t("public.resultsTitle", { round: activeRound?.name ?? "" })}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-start tabby-table">
                    <thead>
                      <tr>
                        <th>{t("public.col.venue")}</th>
                        {isBP ? (
                          <>
                            <th>{t("public.col.openingGovRanked")}</th>
                            <th>{t("side.OO")}</th>
                            <th>{t("side.CG")}</th>
                            <th>{t("side.CO")}</th>
                          </>
                        ) : (
                          <>
                            <th>{t("side.AFF")}</th>
                            <th>{t("side.NEG")}</th>
                          </>
                        )}
                        <th>{t("public.col.adjudicators")}</th>
                        <th className="text-center">{t("public.col.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {releasedDebates.map((d) => {
                        const ballot = ballotMap.get(d.id);
                        const venueCategory = getVenueCategory(d.venueId, d.venueName);
                        const splits = splittingAdjudicators(ballot);
                        const canShowScoresheets = site.ballots && roundTeamSpeaksReleased && Boolean(ballot);
                        const scoresheetsOpen = canShowScoresheets && openScoresheetDebateId === d.id;
                        const sides = (isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"]) as DebateSide[];

                        return (
                          <React.Fragment key={d.id}>
                          <tr className="hover:bg-gray-50">
                            <td className="text-xs">
                              <div className="font-bold text-gray-900">{d.venueName || "—"}</div>
                              {venueCategory && (
                                <span className="inline-block mt-0.5 text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                  {venueCategory}
                                </span>
                              )}
                            </td>
                            {isBP ? (
                              (["OG", "OO", "CG", "CO"] as DebateSide[]).map((side) => {
                                const tSlot = d.teams[side];
                                const tScore = ballot?.teamScores?.[side];
                                return (
                                  <td key={side} className="text-xs">
                                    <div className="font-semibold text-gray-900">
                                      {tScore && (
                                        tScore.rank === 1
                                          ? <ArrowUp className="inline w-3.5 h-3.5 me-1 text-emerald-600" aria-label={t("public.winningTeam")} />
                                          : <ArrowDown className="inline w-3.5 h-3.5 me-1 text-red-600" aria-label={t("public.losingTeam")} />
                                      )}
                                      {tSlot?.teamId ? (
                                        <PublicTeamName team={teamsById.get(tSlot.teamId)} name={tSlot.teamName} recordHref={teamHref(tSlot.teamId)} />
                                      ) : "—"}
                                    </div>
                                    {tScore && (
                                      <div className="text-[11px] text-gray-500 font-mono">
                                        {t("public.rank", { rank: tScore.rank })}
                                        {roundTeamSpeaksReleased && (
                                          <> &bull; {t("public.points", { points: tScore.points })} &bull; {t("public.speaks", { speaks: formatNumber(tScore.totalSpeakerScore, SCORE_DISPLAY_OPTIONS) })}</>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                );
                              })
                            ) : (
                              (["AFF", "NEG"] as DebateSide[]).map((side) => {
                                const tSlot = d.teams[side];
                                const tScore = ballot?.teamScores?.[side];
                                return (
                                  <td key={side} className="text-xs">
                                    <div className="font-semibold text-gray-900">
                                      {tScore && (
                                        tScore.win
                                          ? <ArrowUp className="inline w-3.5 h-3.5 me-1 text-emerald-600" aria-label={t("public.winningTeam")} />
                                          : <ArrowDown className="inline w-3.5 h-3.5 me-1 text-red-600" aria-label={t("public.losingTeam")} />
                                      )}
                                      {tSlot?.teamId ? (
                                        <PublicTeamName team={teamsById.get(tSlot.teamId)} name={tSlot.teamName} recordHref={teamHref(tSlot.teamId)} />
                                      ) : "—"}
                                    </div>
                                    {tScore && (
                                      <div className="text-[11px] text-gray-500 font-mono">
                                        {tScore.win ? t("public.win") : t("public.loss")}
                                        {roundTeamSpeaksReleased && <> &bull; {t("public.speaks", { speaks: formatNumber(tScore.totalSpeakerScore, SCORE_DISPLAY_OPTIONS) })}</>}
                                      </div>
                                    )}
                                  </td>
                                );
                              })
                            )}
                            <td className="text-xs text-gray-700">
                              <span className="font-semibold text-gray-700">{t("public.chairLabel")}</span>{" "}
                              <span className="text-gray-900 font-medium">
                                {showPublicAdjudicators ? panelMembers(d.adjudicators, "chair", splits) : t("common.tba")}
                              </span>
                              <span className="mx-1.5 text-gray-300">|</span>
                              <span className="font-medium text-gray-700">{t("public.panellistsLabel")}</span>{" "}
                              <span>{showPublicAdjudicators ? panelMembers(d.adjudicators, "panellists", splits) : t("common.tba")}</span>
                              <span className="mx-1.5 text-gray-300">|</span>
                              <span className="font-medium text-gray-700">{t("public.traineesLabel")}</span>{" "}
                              <span className="italic">
                                {showPublicAdjudicators ? panelMembers(d.adjudicators, "trainees") : t("common.tba")}
                              </span>
                            </td>
                            <td className="text-center">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  ballot?.confirmed
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-gray-100 text-gray-600"
                                }`}
                              >
                                {ballot?.confirmed ? t("public.confirmed") : t("public.pending")}
                              </span>
                              {canShowScoresheets && (
                                <button
                                  type="button"
                                  aria-expanded={scoresheetsOpen}
                                  onClick={() => setOpenScoresheetDebateId(scoresheetsOpen ? null : d.id)}
                                  className="mt-1 block w-full text-[11px] font-semibold text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                                >
                                  {scoresheetsOpen ? t("public.hideScoresheets") : t("public.showScoresheets")}
                                </button>
                              )}
                            </td>
                          </tr>
                          {scoresheetsOpen && (
                            <tr>
                              <td colSpan={sides.length + 3} className="p-0">
                                <ScoresheetsPanel
                                  debate={d}
                                  ballot={ballot}
                                  sides={sides}
                                  teamName={(side) => d.teams?.[side]?.teamName || t("public.noPublicName")}
                                  replyPosition={prefs?.replyScoresEnabled && !isBP ? 4 : undefined}
                                />
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 3. Standings View (S1: publicStandings) */}
        {showPublicStandings && activeTab === "standings" && (
          <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
            <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">
              {t("public.teamStandings")}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-start tabby-table">
                <thead>
                  <tr>
                    <th className="w-12 text-center">#</th>
                    <th>{t("public.col.team")}</th>
                    <th>{t("public.col.institution")}</th>
                    {showAggregateTeamScores && <th className="text-end">{t("public.col.points")}</th>}
                    {showAggregateTeamScores && <th className="text-end">{t("public.col.totalSpeaks")}</th>}
                    {showAggregateTeamScores && <th className="text-end">{t("public.col.avgSpeaks")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {publicStandings.teams.map((row) => (
                    <tr key={row.teamId} className="hover:bg-gray-50">
                      <td className="text-center font-mono font-bold text-xs">{row.rank}</td>
                      <td className="font-bold text-gray-900 text-xs">
                        <PublicTeamName team={teamsById.get(row.teamId)} name={row.teamName} recordHref={teamHref(row.teamId)} />
                      </td>
                      <td className="text-xs text-gray-600">{row.institutionCode || "—"}</td>
                      {showAggregateTeamScores && <td className="text-end font-mono font-bold text-sm text-blue-600">{row.points}</td>}
                      {showAggregateTeamScores && (
                        <td className="text-end font-mono font-semibold text-xs text-gray-800">
                          {formatDecimal(row.totalSpeakerScore, 1)}
                        </td>
                      )}
                      {showAggregateTeamScores && (
                        <td className="text-end font-mono text-xs text-gray-600">
                          {formatDecimal(row.averageSpeakerScore, 2)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3b. Released Team Tab (and break category team tabs) */}
        {showTeamTab && activeTab === "teamTab" && (
          <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
            <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">
              {t("public.tabTitle", {
                tab: t("public.tab.teamTab"),
                rounds: plural("public.completedRounds", tabRoundCount),
              })}
            </div>
            {(teamTabOptions.length > 1 || (selectedTeamTabId === "all" && site.teamTabLimit > 0)) && (
              <div role="group" aria-label={t("public.teamTabCategory")} className="flex flex-wrap items-center gap-1.5 border-b border-[#d0d7de] p-2">
                {teamTabOptions.length > 1 && teamTabOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selectedTeamTabId === option.id}
                    onClick={() => setTeamTabCategoryId(option.id)}
                    className={`rounded px-2.5 py-1 text-xs font-semibold border focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      selectedTeamTabId === option.id
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {option.name}
                  </button>
                ))}
                {selectedTeamTabId === "all" && site.teamTabLimit > 0 && (
                  <span className="self-center text-[11px] text-gray-500">{t("public.topLimit", { limit: site.teamTabLimit })}</span>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-start tabby-table">
                <thead>
                  <tr>
                    <th className="w-12 text-center">#</th>
                    <th>{t("public.col.team")}</th>
                    <th>{t("public.col.institution")}</th>
                    <th className="text-end">{isBP ? t("public.col.points") : t("public.col.wins")}</th>
                    <th className="text-end">{t("public.col.totalSpeaks")}</th>
                    <th className="text-end">{t("public.col.avgSpeaks")}</th>
                    {teamExtra.map((metric) => (
                      <th key={metric} className="text-end">{t(`metric.team.${metric}` as MessageKey)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teamTabRows.map((row) => (
                    <tr key={row.teamId} className="hover:bg-gray-50">
                      <td className="text-center font-mono font-bold text-xs">{row.rank}</td>
                      <td className="font-bold text-gray-900 text-xs">
                        <PublicTeamName team={teamsById.get(row.teamId)} name={row.teamName} recordHref={teamHref(row.teamId)} />
                      </td>
                      <td className="text-xs text-gray-600">{row.institutionCode || "—"}</td>
                      <td className="text-end font-mono font-bold text-sm text-blue-600">
                        {isBP ? row.points : row.wins ?? row.points}
                      </td>
                      <td className="text-end font-mono font-semibold text-xs text-gray-800">
                        {formatDecimal(row.totalSpeakerScore, 1)}
                      </td>
                      <td className="text-end font-mono text-xs text-gray-600">{formatDecimal(row.averageSpeakerScore, 2)}</td>
                      {teamExtra.map((metric) => (
                        <td key={metric} className="text-end font-mono text-xs text-gray-600">
                          {row.metrics[metric] !== undefined ? formatMetricValue(row.metrics[metric]!) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3c. Released Speaker / Replies Tabs */}
        {((showSpeakerTab && activeTab === "speakerTab") || (showRepliesTab && activeTab === "repliesTab")) && (
          <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
            <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">
              {t("public.tabTitle", {
                tab: activeTab === "repliesTab" ? t("public.tab.repliesTab") : t("public.tab.speakerTab"),
                rounds: plural("public.completedRounds", tabRoundCount),
              })}
            </div>
            {activeTab === "speakerTab" && publicSpeakerCategories.length > 0 && (
              <div role="group" aria-label={t("public.speakerCategory")} className="flex flex-wrap gap-1.5 border-b border-[#d0d7de] p-2">
                {[{ id: "all", name: t("public.allSpeakers") }, ...publicSpeakerCategories].map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={(selectedSpeakerCategory?.id ?? "all") === category.id}
                    onClick={() => setSpeakerCategoryId(category.id)}
                    className={`rounded px-2.5 py-1 text-xs font-semibold border focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      (selectedSpeakerCategory?.id ?? "all") === category.id
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {category.name}
                  </button>
                ))}
                {selectedSpeakerCategory?.limit ? (
                  <span className="self-center text-[11px] text-gray-500">
                    {t("public.categoryLimit", { limit: selectedSpeakerCategory.limit, category: selectedSpeakerCategory.name })}
                  </span>
                ) : null}
              </div>
            )}
            {((activeTab === "speakerTab" && !selectedSpeakerCategory && site.speakerTabLimit > 0) ||
              (activeTab === "repliesTab" && site.repliesTabLimit > 0)) && (
              <p className="border-b border-[#d0d7de] px-3 py-1.5 text-[11px] text-gray-500">
                {t("public.topLimit", { limit: activeTab === "repliesTab" ? site.repliesTabLimit : site.speakerTabLimit })}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-start tabby-table">
                <thead>
                  <tr>
                    <th className="w-12 text-center">#</th>
                    <th>{t("public.col.speaker")}</th>
                    <th>{t("public.col.team")}</th>
                    <th className="text-end">{t("public.col.total")}</th>
                    <th className="text-end">{t("public.col.average")}</th>
                    <th className="text-end">{t("public.col.speeches")}</th>
                    {activeTab !== "repliesTab" && speakerExtra.map((metric) => (
                      <th key={metric} className="text-end">{t(`metric.speaker.${metric}` as MessageKey)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(activeTab === "repliesTab" ? publicTabs?.repliesTab ?? [] : speakerTabRows).map((row) => (
                    <tr key={`${row.teamId}-${row.speakerId}`} className="hover:bg-gray-50">
                      <td className="text-center font-mono font-bold text-xs">
                        {row.ineligible ? <span title={t("public.unrankedHint")}>—</span> : row.rank}
                      </td>
                      <td className="font-bold text-gray-900 text-xs">
                        <PublicPersonName name={row.speakerName} anonymous={row.anonymous} />
                        {row.ineligible && (
                          <span className="ms-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                            {t("public.unranked")}
                          </span>
                        )}
                      </td>
                      <td className="text-xs text-gray-600">
                        {row.anonymous ? (
                          <span className="italic text-gray-500">{t("public.redacted")}</span>
                        ) : (
                          <PublicTeamName team={teamsById.get(row.teamId)} name={row.teamName} recordHref={teamHref(row.teamId)} />
                        )}
                      </td>
                      <td className="text-end font-mono font-semibold text-xs text-gray-800">{formatDecimal(row.totalScore, 1)}</td>
                      <td className="text-end font-mono text-xs text-gray-600">{formatDecimal(row.averageScore, 2)}</td>
                      <td className="text-end font-mono text-xs text-gray-600">{row.speechesCount}</td>
                      {activeTab !== "repliesTab" && speakerExtra.map((metric) => (
                        <td key={metric} className="text-end font-mono text-xs text-gray-600">
                          {row.metrics[metric] !== undefined ? formatMetricValue(row.metrics[metric]!) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. Motions View (S1: publicMotions) */}
        {showPublicMotions && activeTab === "motions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-gray-900">{t("public.releasedMotions")}</h2>
              <button
                type="button"
                onClick={() => setIsMotionPresentation(true)}
                disabled={releasedMotions.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-black text-white rounded text-xs font-semibold disabled:opacity-50"
              >
                <Presentation className="w-3.5 h-3.5" aria-hidden="true" />
                {t("public.presentMotions")}
              </button>
            </div>
            {releasedMotions.length === 0 ? (
              <div className="bg-white border border-[#d0d7de] rounded-lg p-10 text-center text-gray-500 text-xs">
                {t("public.noMotions")}
              </div>
            ) : (
              releasedMotions.map((m) => {
                const assignedRounds = rounds.filter((r) => m.rounds && m.rounds.includes(r.id));
                const assignedRoundNames = formatList(assignedRounds.map((r) => r.name));

                return (
                  <div key={m.id} className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-2xs">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                        {m.reference || t("public.motionFallback")}
                      </span>
                      {assignedRoundNames ? (
                        <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                          {t("public.motionRounds", { rounds: assignedRoundNames })}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">{t("public.unassignedRound")}</span>
                      )}
                    </div>
                    <blockquote className="text-base font-bold text-gray-900 my-2.5 ps-3 border-s-4 border-amber-500">
                      &ldquo;{m.text}&rdquo;
                    </blockquote>
                    {m.infoSlide && (
                      <div className="mt-2 p-3 bg-amber-50/50 rounded border border-amber-200 text-xs text-amber-950">
                        <div className="flex items-center justify-between mb-1">
                          <strong className="block text-[10px] uppercase font-bold text-amber-800">
                            {t("public.infoslide")}
                          </strong>
                          {assignedRoundNames && (
                            <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200">
                              {t("public.motionRounds", { rounds: assignedRoundNames })}
                            </span>
                          )}
                        </div>
                        <p className="whitespace-pre-line">{m.infoSlide}</p>
                      </div>
                    )}
                    {motionStatistics.get(m.id) && (
                      <MotionStatisticsSummary statistic={motionStatistics.get(m.id)!} isBP={isBP} />
                    )}
                    {site.vetoStatistics && derived.vetoes?.[m.id] && (() => {
                      const bySide = derived.vetoes[m.id]!;
                      const entries = Object.entries(bySide) as Array<[DebateSide, number]>;
                      const total = entries.reduce((sum, [, count]) => sum + count, 0);
                      return (
                        <p className="mt-2 text-xs text-gray-600">
                          {t("public.vetoes", { count: total })}
                          {entries.length > 1 && (
                            <span className="ms-2 text-gray-500">
                              {t("public.vetoesBySide", { sides: formatList(entries.map(([side, count]) => `${t(`side.${side}`)} ${count}`)) })}
                            </span>
                          )}
                        </p>
                      );
                    })()}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 5. Break View */}
        {showPublicBreak && activeTab === "break" && (
          <div className="space-y-6">
            {publicBreak.map((res) => (
              <div
                key={res.category.id}
                className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden"
              >
                <div className="p-3 bg-purple-50 border-b border-purple-200 font-bold text-xs text-purple-900">
                  {t("public.breakTitle", { category: res.category.name, size: res.category.breakSize })}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-start tabby-table">
                    <thead>
                      <tr>
                        <th className="w-16 text-center">{t("public.col.seed")}</th>
                        <th>{t("public.col.team")}</th>
                        <th>{t("public.col.institution")}</th>
                        {(derived.breakMetrics?.metricIds ?? []).map((metric) => (
                          <th key={metric} className="text-end">{t(`metric.team.${metric}` as MessageKey)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {res.teams.map((b) => (
                        <tr key={b.team.id} className="hover:bg-purple-50/30">
                          <td className="text-center font-mono font-bold text-xs text-purple-700">
                            {b.seed}
                          </td>
                          <td className="font-bold text-gray-900 text-xs">
                            <PublicTeamName team={b.team} recordHref={teamHref(b.team.id)} />
                          </td>
                          <td className="text-xs text-gray-600">{b.team.institutionName || "—"}</td>
                          {(derived.breakMetrics?.metricIds ?? []).map((metric) => {
                            const value = derived.breakMetrics?.teams[b.team.id]?.[metric];
                            return (
                              <td key={metric} className="text-end font-mono text-xs text-gray-600">
                                {value !== undefined ? formatMetricValue(value) : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {showParticipants && activeTab === "participants" && (
          <ParticipantsPanel
            participants={participants}
            showBreakCategories={site.breakCategoriesOnParticipants}
            teamHref={teamHref}
            adjudicatorHref={adjudicatorHref}
          />
        )}
        {showAdjudicatorTab && activeTab === "adjudicatorTab" && derived.adjudicatorTab && (
          <AdjudicatorTabPanel tab={derived.adjudicatorTab} recordHref={adjudicatorHref} />
        )}
        {showSideAllocations && activeTab === "sideAllocations" && derived.sideAllocations && (
          <SideAllocationsPanel allocations={derived.sideAllocations} teamsById={teamsById} />
        )}
        {showBracket && activeTab === "bracket" && (
          <BracketPanel rounds={rounds} debates={debates} ballots={ballots} teamsById={teamsById} isBP={isBP} teamHref={teamHref} />
        )}
        {showDiversity && activeTab === "diversity" && derived.diversity && <DiversityPanel diversity={derived.diversity} />}
        {showFeedbackProgress && activeTab === "feedbackProgress" && derived.feedbackProgress && (
          <FeedbackProgressPanel progress={derived.feedbackProgress} />
        )}
        {showInstitutions && activeTab === "institutions" && <InstitutionsPanel institutions={institutionRows} />}
        {showAdjudicatorLists && activeTab === "adjudicators" && (
          <AdjudicatorListsPanel
            lists={adjudicatorLists}
            showCore={release.adjudicatorCore}
            showBreaking={release.breakingAdjudicators}
          />
        )}
      </main>

      {isMotionPresentation && releasedMotions[motionSlideIndex] && (() => {
        const currentMotion = releasedMotions[motionSlideIndex];
        const currentAssignedRounds = rounds.filter((r) => currentMotion.rounds && currentMotion.rounds.includes(r.id));
        const currentRoundNames = formatList(currentAssignedRounds.map((r) => r.name));

        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("public.presentation.label")}
            className="fixed inset-0 z-[60] flex flex-col bg-[#111820] text-white"
          >
            <header className="flex items-center justify-between border-b border-white/15 px-5 py-4 sm:px-8">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-bold uppercase text-amber-300">
                    {t("public.presentation.position", { index: motionSlideIndex + 1, total: releasedMotions.length })}
                  </p>
                  {currentRoundNames && (
                    <span className="text-[11px] font-semibold text-amber-200 bg-amber-500/20 px-2 py-0.5 rounded border border-amber-400/30">
                      {t("public.motionRounds", { rounds: currentRoundNames })}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-gray-200">
                  {currentMotion.reference || t("public.presentation.fallback")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsMotionPresentation(false)}
                aria-label={t("public.presentation.close")}
                title={t("public.presentation.close")}
                className="p-2 text-gray-300 hover:bg-white/10 hover:text-white rounded"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </header>
            <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-6 py-10 text-center sm:px-14">
              {currentRoundNames && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-xs font-semibold text-amber-300 uppercase tracking-wider">
                  <span>{t("public.presentation.assignedTo", { rounds: currentRoundNames })}</span>
                </div>
              )}
              <p className="max-w-5xl text-3xl font-bold leading-tight sm:text-5xl">
                {currentMotion.text}
              </p>
              {currentMotion.infoSlide && (
                <div className="w-full max-w-4xl border-t border-amber-300/50 pt-6 text-start">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold uppercase text-amber-300">{t("public.presentation.infoSlide")}</p>
                    {currentRoundNames && (
                      <span className="text-xs font-semibold text-amber-200 bg-amber-500/20 px-2.5 py-0.5 rounded border border-amber-400/30">
                        {t("public.motionRounds", { rounds: currentRoundNames })}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-line text-base leading-relaxed text-gray-200 sm:text-lg">
                    {currentMotion.infoSlide}
                  </p>
                </div>
              )}
            </div>
            <footer className="flex items-center justify-between border-t border-white/15 px-5 py-4 sm:px-8">
              <button
                type="button"
                onClick={() => setMotionSlideIndex((index) => Math.max(index - 1, 0))}
                disabled={motionSlideIndex === 0}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10 rounded disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" /> {t("public.presentation.previous")}
              </button>
              <div className="flex items-center gap-1.5" aria-label={t("public.presentation.slide", { index: motionSlideIndex + 1 })}>
                {releasedMotions.map((motion, index) => (
                  <span
                    key={motion.id}
                    className={`h-1.5 w-5 rounded-full ${index === motionSlideIndex ? "bg-amber-300" : "bg-white/25"}`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setMotionSlideIndex((index) => Math.min(index + 1, releasedMotions.length - 1))}
                disabled={motionSlideIndex === releasedMotions.length - 1}
                className="inline-flex items-center gap-1 px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-white/10 rounded disabled:opacity-40"
              >
                {t("public.presentation.next")} <ChevronRight className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
              </button>
            </footer>
          </div>
        );
      })()}

      {/* Footer */}
      <footer className="bg-white border-t border-[#d0d7de] py-4 px-6 text-center text-xs text-gray-500">
        {t("public.footer")}
      </footer>
    </div>
  );
}
