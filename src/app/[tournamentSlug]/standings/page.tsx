"use client";

import React, { useMemo, useState } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { useFormatScore } from "@/features/tournament/components/results/useFormatScore";
import type { MessageKey } from "@/lib/i18n/messages";
import type { SpeakerMetricId, TeamMetricId } from "@/types";
import { exportStandingsToCsv } from "@/lib/csv/importer";
import { csvFileStem, speakerStandingsCsv } from "@/lib/csv/exporters";
import { downloadCsv } from "@/lib/csv/download";
import { ReleasePanel } from "@/features/tournament/components/ReleasePanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/Field";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/Tabs";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Award, Download, Medal, Printer, Search, Users } from "lucide-react";
import { resolveSpeakerExtra, resolveTeamExtra } from "@/lib/standings/precedence";
import { effectiveSpeakerCategories, speakerCategoryNames, speakerRowsInCategory, speakersInCategory } from "@/lib/speakerCategories";

type StandingsTab = "teams" | "speakers" | "replies";

const TABS_ID = "standings";
/** Sticky headers need the table to scroll inside its own frame. */
const TABLE_FRAME = "max-h-[calc(100vh-16rem)] min-h-[12rem]";

/** Column labels for "extra" metrics; most reuse the public tab's metric names. */
const TEAM_METRIC_KEYS: Record<TeamMetricId, MessageKey> = {
  wins: "metric.team.wins",
  points: "metric.team.points",
  speaks_sum: "metric.team.speaks_sum",
  speaks_avg: "metric.team.speaks_avg",
  speaks_ind_avg: "metric.team.speaks_ind_avg",
  speaks_stddev: "metric.team.speaks_stddev",
  margin_sum: "metric.team.margin_sum",
  margin_avg: "metric.team.margin_avg",
  draw_strength_wins: "metric.team.draw_strength_wins",
  draw_strength: "metric.team.draw_strength",
  draw_strength_speaks: "metric.team.draw_strength_speaks",
  draw_strength_rank: "metric.team.draw_strength_rank",
  firsts: "metric.team.firsts",
  seconds: "metric.team.seconds",
  thirds: "metric.team.thirds",
  pullups: "metric.team.pullups",
  pullup_debates: "metric.team.pullup_debates",
  wbw: "results.standings.metricWbw",
  num_adjs: "metric.team.num_adjs",
  num_iron: "metric.team.num_iron",
};

const SPEAKER_METRIC_KEYS: Record<SpeakerMetricId, MessageKey> = {
  speaks_sum: "metric.speaker.speaks_sum",
  speaks_avg: "metric.speaker.speaks_avg",
  speaks_stddev: "metric.speaker.speaks_stddev",
  speaks_trimmed_mean: "metric.speaker.speaks_trimmed_mean",
  speeches_count: "metric.speaker.speeches_count",
  reply_sum: "metric.speaker.reply_sum",
  reply_avg: "metric.speaker.reply_avg",
  srank: "results.standings.metricSrank",
  reply_stddev: "metric.speaker.reply_stddev",
  reply_count: "metric.speaker.reply_count",
  team_points: "metric.speaker.team_points",
  team_wins: "metric.speaker.team_wins",
  firsts: "metric.speaker.firsts",
  seconds: "metric.speaker.seconds",
  thirds: "metric.speaker.thirds",
  num_adjs: "metric.speaker.num_adjs",
};

/** BP placing badge: the number is the content; tone only aids scanning. */
const bpPointTone = (points: number) =>
  points === 3 ? "success" : points === 2 ? "info" : points === 1 ? "warning" : "neutral";

export default function StandingsPage() {
  const {
    tournament,
    teamStandings,
    speakerStandings,
    replyStandings,
    breakCategories,
    teams,
  } = useTournament();
  const { t, plural, formatNumber, formatDecimal, formatList } = useI18n();
  const formatScore = useFormatScore();
  /** Same digits as `formatMetricValue`: integers as they are, anything else to two decimals. */
  const formatMetric = (value: number | undefined) =>
    value === undefined || !Number.isFinite(value)
      ? "—"
      : Number.isInteger(value)
        ? formatNumber(value, { useGrouping: false })
        : formatDecimal(value, 2);

  const [activeTab, setActiveTab] = useState<StandingsTab>("teams");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const isBP = tournament?.format === "bp";
  // "Extra" metrics: calculated and shown, but not used to rank (Tabbycat's *_extra_metrics).
  const teamExtra = resolveTeamExtra(tournament?.preferences);
  const speakerExtra = resolveSpeakerExtra(tournament?.preferences);

  // Teams filter by break category; speakers by speaker category (ids, with older labels resolved).
  // The two are different lists, so each tab offers its own options.
  const speakerCategories = useMemo(
    () => effectiveSpeakerCategories(tournament?.preferences.speakerCategories, teams),
    [tournament?.preferences.speakerCategories, teams]
  );
  const categoryNames = (refs: string[]) => speakerCategoryNames(refs, speakerCategories);
  const categoryOptions = activeTab === "teams"
    ? breakCategories.map((category) => ({ value: category.id, label: category.name }))
    : activeTab === "speakers"
      ? speakerCategories
          .filter((category) => speakersInCategory(teams, category.id, speakerCategories) > 0)
          .map((category) => ({ value: category.id, label: category.name }))
      : [];
  const changeTab = (tab: StandingsTab) => {
    setActiveTab(tab);
    setSelectedCategory("all");
  };

  // Filter Team Standings
  const filteredTeams = teamStandings.filter((row) => {
    const matchesSearch =
      row.teamName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (row.institutionCode || "").toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (selectedCategory === "all") return true;
    return row.breakCategories && row.breakCategories.includes(selectedCategory);
  });

  // Filter Speaker Standings; a category is ranked within itself, as Tabbycat's category tabs are.
  const speakersInView = selectedCategory === "all"
    ? speakerStandings
    : speakerRowsInCategory(speakerStandings, selectedCategory, speakerCategories);
  const filteredSpeakers = speakersInView.filter(
    (s) =>
      s.speakerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.teamName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleExport = () => {
    const name = tournament?.name || "Tournament";
    if (activeTab === "teams") {
      exportStandingsToCsv(teamStandings, name);
    } else if (activeTab === "speakers") {
      downloadCsv(`${csvFileStem(name)}_Speaker_Standings.csv`, speakerStandingsCsv(speakerStandings, { categoryNames }));
    } else {
      downloadCsv(`${csvFileStem(name)}_Reply_Standings.csv`, speakerStandingsCsv(replyStandings, { reply: true }));
    }
  };

  const tabs: TabItem<StandingsTab>[] = [
    { value: "teams", label: t("results.standings.tabTeams"), icon: <Users aria-hidden="true" />, count: teamStandings.length },
    { value: "speakers", label: t("results.standings.tabSpeakers"), icon: <Award aria-hidden="true" />, count: speakerStandings.length },
    ...(!isBP && replyStandings.length > 0
      ? [{ value: "replies" as const, label: t("results.standings.tabReplies"), icon: <Medal aria-hidden="true" />, count: replyStandings.length }]
      : []),
  ];
  const exportHint = t(
    activeTab === "teams"
      ? "results.standings.exportTeamsHint"
      : activeTab === "speakers"
        ? "results.standings.exportSpeakersHint"
        : "results.standings.exportRepliesHint"
  );
  const noMatches = t(searchQuery || selectedCategory !== "all" ? "results.standings.noMatches" : "results.standings.noResults");
  const teamColumns = (isBP ? 11 : 9) + teamExtra.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("results.standings.title")}
        description={t("results.standings.description")}
        actions={
          <>
            <Button variant="secondary" onClick={handleExport} title={exportHint}>
              <Download aria-hidden="true" />
              {t("results.standings.exportCsv")}
            </Button>
            <IconButton variant="secondary" label={t("results.standings.print")} icon={<Printer />} onClick={() => window.print()} />
          </>
        }
      />

      <ReleasePanel />

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <Tabs id={TABS_ID} items={tabs} value={activeTab} onValueChange={changeTab} ariaLabel={t("results.standings.tabsLabel")} className="md:flex-1" />
        <div className="flex items-center gap-2">
          {categoryOptions.length > 0 && (
            <Select
              aria-label={t(activeTab === "teams" ? "results.standings.breakCategory" : "results.standings.speakerCategory")}
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-40"
            >
              <option value="all">{t("results.standings.allCategories")}</option>
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
          <Input
            type="search"
            aria-label={t("results.standings.searchLabel")}
            placeholder={t("results.standings.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leadingIcon={<Search />}
            wrapperClassName="flex-1"
            className="w-full md:w-56"
          />
        </div>
      </div>

      {activeTab === "teams" && (
        <TabPanel id={TABS_ID} value="teams">
          <TableContainer className={TABLE_FRAME}>
            <Table>
              <THead>
                <TR>
                  <TH align="right" className="w-12">#</TH>
                  <TH>{t("results.standings.colTeam")}</TH>
                  <TH>{t("results.standings.colInstitution")}</TH>
                  <TH align="right">{t("results.standings.colPoints")}</TH>
                  <TH align="right">{t("results.standings.colTotalSpeaks")}</TH>
                  <TH align="right">{t("results.standings.colAvgSpeaks")}</TH>
                  {isBP ? (
                    <>
                      <TH align="right" className="w-12">{t("results.standings.colFirsts")}</TH>
                      <TH align="right" className="w-12">{t("results.standings.colSeconds")}</TH>
                      <TH align="right" className="w-12">{t("results.standings.colThirds")}</TH>
                      <TH align="right" className="w-12">{t("results.standings.colFourths")}</TH>
                    </>
                  ) : (
                    <>
                      <TH align="right" className="w-16">{t("results.standings.colWins")}</TH>
                      <TH align="right" className="w-16">{t("results.standings.colMargin")}</TH>
                    </>
                  )}
                  {teamExtra.map((metric) => (
                    <TH key={metric} align="right">{t(TEAM_METRIC_KEYS[metric])}</TH>
                  ))}
                  <TH>{t("results.standings.colRoundResults")}</TH>
                </TR>
              </THead>
              <TBody>
                {filteredTeams.length === 0 && <TableEmpty colSpan={teamColumns}>{noMatches}</TableEmpty>}
                {filteredTeams.map((team) => (
                  <TR key={team.teamId}>
                    <TD numeric className="text-fg-muted">{formatNumber(team.rank)}</TD>
                    <TD className="font-medium">{team.teamName}</TD>
                    <TD className="text-fg-muted">{team.institutionCode || "—"}</TD>
                    <TD numeric className="text-[13px] font-semibold">{formatNumber(team.points)}</TD>
                    <TD numeric>{formatDecimal(team.totalSpeakerScore, 1)}</TD>
                    <TD numeric className="text-fg-muted">{formatDecimal(team.averageSpeakerScore, 2)}</TD>
                    {isBP ? (
                      <>
                        <TD numeric>{formatNumber(team.firstPlaces || 0)}</TD>
                        <TD numeric>{formatNumber(team.secondPlaces || 0)}</TD>
                        <TD numeric>{formatNumber(team.thirdPlaces || 0)}</TD>
                        <TD numeric className="text-fg-muted">{formatNumber(team.fourthPlaces || 0)}</TD>
                      </>
                    ) : (
                      <>
                        <TD numeric className="font-semibold">{formatNumber(team.wins || 0)}</TD>
                        <TD numeric>
                          {team.margins && team.margins > 0 ? `+${formatScore(team.margins)}` : formatScore(team.margins || 0)}
                        </TD>
                      </>
                    )}
                    {teamExtra.map((metric) => (
                      <TD key={metric} numeric className="text-fg-muted">{formatMetric(team.metrics[metric])}</TD>
                    ))}
                    <TD>
                      <div className="flex items-center gap-1">
                        {team.roundResults.map((r, rIdx) => (
                          <Badge
                            key={rIdx}
                            tone={isBP ? bpPointTone(r.points) : r.win ? "success" : "danger"}
                            className="w-6 justify-center px-0 font-mono"
                            title={plural("results.standings.roundResult", r.points, { round: r.roundSeq, side: r.side })}
                          >
                            {isBP ? formatNumber(r.points) : t(r.win ? "results.standings.winShort" : "results.standings.lossShort")}
                          </Badge>
                        ))}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </TabPanel>
      )}

      {activeTab === "speakers" && (
        <TabPanel id={TABS_ID} value="speakers">
          <TableContainer className={TABLE_FRAME}>
            <Table>
              <THead>
                <TR>
                  <TH align="right" className="w-12">#</TH>
                  <TH>{t("results.standings.colSpeaker")}</TH>
                  <TH>{t("results.standings.colTeam")}</TH>
                  <TH>{t("results.standings.colInstitution")}</TH>
                  <TH align="right">{t("results.standings.colSpeeches")}</TH>
                  <TH align="right">{t("results.standings.colTotal")}</TH>
                  <TH align="right">{t("results.standings.colAverage")}</TH>
                  {speakerExtra.map((metric) => (
                    <TH key={metric} align="right">{t(SPEAKER_METRIC_KEYS[metric])}</TH>
                  ))}
                  <TH>{t("results.standings.colRoundScores")}</TH>
                </TR>
              </THead>
              <TBody>
                {filteredSpeakers.length === 0 && <TableEmpty colSpan={8 + speakerExtra.length}>{noMatches}</TableEmpty>}
                {filteredSpeakers.map((spk) => (
                  <TR key={spk.speakerId}>
                    <TD numeric className="text-fg-muted">
                      {spk.ineligible ? <span title={t("results.standings.unrankedSpeechesHint")}>—</span> : formatNumber(spk.rank)}
                    </TD>
                    <TD className="font-medium">
                      {spk.speakerName}
                      {categoryNames(spk.categories ?? []).length > 0 && (
                        <Badge className="ms-2 uppercase">{formatList(categoryNames(spk.categories ?? []))}</Badge>
                      )}
                      {spk.ineligible && <Badge className="ms-2">{t("results.standings.unrankedSpeeches")}</Badge>}
                    </TD>
                    <TD>{spk.teamName}</TD>
                    <TD className="text-fg-muted">{spk.institutionCode || "—"}</TD>
                    <TD numeric className="text-fg-muted">{formatNumber(spk.speechesCount)}</TD>
                    <TD numeric className="text-[13px] font-semibold">{formatDecimal(spk.totalScore, 1)}</TD>
                    <TD numeric>{formatDecimal(spk.averageScore, 2)}</TD>
                    {speakerExtra.map((metric) => (
                      <TD key={metric} numeric className="text-fg-muted">{formatMetric(spk.metrics[metric])}</TD>
                    ))}
                    <TD>
                      <div className="flex items-center gap-1 font-mono text-[11px] text-fg-muted">
                        {spk.scoresByRound.map((sr, idx) => (
                          <span key={idx} className="rounded-sm bg-muted px-1.5 py-0.5">
                            {formatScore(sr.score)}
                          </span>
                        ))}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </TabPanel>
      )}

      {activeTab === "replies" && (
        <TabPanel id={TABS_ID} value="replies">
          <TableContainer className={TABLE_FRAME}>
            <Table>
              <THead>
                <TR>
                  <TH align="right" className="w-12">#</TH>
                  <TH>{t("results.standings.colReplySpeaker")}</TH>
                  <TH>{t("results.standings.colTeam")}</TH>
                  <TH align="right">{t("results.standings.colSpeeches")}</TH>
                  <TH align="right">{t("results.standings.colTotal")}</TH>
                  <TH align="right">{t("results.standings.colAverage")}</TH>
                </TR>
              </THead>
              <TBody>
                {replyStandings.length === 0 && <TableEmpty colSpan={6}>{t("results.standings.noResults")}</TableEmpty>}
                {replyStandings.map((rep) => (
                  <TR key={rep.speakerId}>
                    <TD numeric className="text-fg-muted">
                      {rep.ineligible ? <span title={t("results.standings.unrankedRepliesHint")}>—</span> : formatNumber(rep.rank)}
                    </TD>
                    <TD className="font-medium">
                      {rep.speakerName}
                      {rep.ineligible && <Badge className="ms-2">{t("results.standings.unrankedReplies")}</Badge>}
                    </TD>
                    <TD>{rep.teamName}</TD>
                    <TD numeric className="text-fg-muted">{formatNumber(rep.speechesCount)}</TD>
                    <TD numeric className="text-[13px] font-semibold">{formatDecimal(rep.totalScore, 1)}</TD>
                    <TD numeric>{formatDecimal(rep.averageScore, 2)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </TabPanel>
      )}
    </div>
  );
}
