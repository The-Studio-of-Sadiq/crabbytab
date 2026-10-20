"use client";

import { formatScore } from "@/lib/scoreDisplay";
import React, { useMemo, useState } from "react";
import { useTournament } from "@/contexts/TournamentContext";
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
import { SPEAKER_METRIC_LABELS, TEAM_METRIC_LABELS, formatMetricValue } from "@/lib/standings/metrics";
import { resolveSpeakerExtra, resolveTeamExtra } from "@/lib/standings/precedence";
import { effectiveSpeakerCategories, speakerCategoryNames, speakerRowsInCategory, speakersInCategory } from "@/lib/speakerCategories";

type StandingsTab = "teams" | "speakers" | "replies";

const TABS_ID = "standings";
/** Sticky headers need the table to scroll inside its own frame. */
const TABLE_FRAME = "max-h-[calc(100vh-16rem)] min-h-[12rem]";

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
  const filteredTeams = teamStandings.filter((t) => {
    const matchesSearch =
      t.teamName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.institutionCode || "").toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (selectedCategory === "all") return true;
    return t.breakCategories && t.breakCategories.includes(selectedCategory);
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
    { value: "teams", label: "Teams", icon: <Users aria-hidden="true" />, count: teamStandings.length },
    { value: "speakers", label: "Speakers", icon: <Award aria-hidden="true" />, count: speakerStandings.length },
    ...(!isBP && replyStandings.length > 0
      ? [{ value: "replies" as const, label: "Reply speakers", icon: <Medal aria-hidden="true" />, count: replyStandings.length }]
      : []),
  ];
  const exportNoun = activeTab === "teams" ? "team" : activeTab === "speakers" ? "speaker" : "reply";
  const noMatches = searchQuery || selectedCategory !== "all" ? "No entries match the current filters." : "No results have been entered yet.";
  const teamColumns = (isBP ? 11 : 9) + teamExtra.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Standings"
        description="Rankings computed via Tabbycat standard metric chains (points → speaker scores → rank distribution)."
        actions={
          <>
            <Button variant="secondary" onClick={handleExport} title={`Download the ${exportNoun} standings as CSV`}>
              <Download aria-hidden="true" />
              Export CSV
            </Button>
            <IconButton variant="secondary" label="Print standings" icon={<Printer />} onClick={() => window.print()} />
          </>
        }
      />

      <ReleasePanel />

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <Tabs id={TABS_ID} items={tabs} value={activeTab} onValueChange={changeTab} ariaLabel="Standings type" className="md:flex-1" />
        <div className="flex items-center gap-2">
          {categoryOptions.length > 0 && (
            <Select
              aria-label={activeTab === "teams" ? "Break category" : "Speaker category"}
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-40"
            >
              <option value="all">All categories</option>
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
          <Input
            type="search"
            aria-label="Search standings"
            placeholder="Search tab…"
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
                  <TH>Team</TH>
                  <TH>Institution</TH>
                  <TH align="right">Points</TH>
                  <TH align="right">Total speaks</TH>
                  <TH align="right">Avg speaks</TH>
                  {isBP ? (
                    <>
                      <TH align="right" className="w-12">1st</TH>
                      <TH align="right" className="w-12">2nd</TH>
                      <TH align="right" className="w-12">3rd</TH>
                      <TH align="right" className="w-12">4th</TH>
                    </>
                  ) : (
                    <>
                      <TH align="right" className="w-16">Wins</TH>
                      <TH align="right" className="w-16">Margin</TH>
                    </>
                  )}
                  {teamExtra.map((metric) => (
                    <TH key={metric} align="right">{TEAM_METRIC_LABELS[metric]}</TH>
                  ))}
                  <TH>Round results</TH>
                </TR>
              </THead>
              <TBody>
                {filteredTeams.length === 0 && <TableEmpty colSpan={teamColumns}>{noMatches}</TableEmpty>}
                {filteredTeams.map((team) => (
                  <TR key={team.teamId}>
                    <TD numeric className="text-fg-muted">{team.rank}</TD>
                    <TD className="font-medium">{team.teamName}</TD>
                    <TD className="text-fg-muted">{team.institutionCode || "—"}</TD>
                    <TD numeric className="text-[13px] font-semibold">{team.points}</TD>
                    <TD numeric>{team.totalSpeakerScore.toFixed(1)}</TD>
                    <TD numeric className="text-fg-muted">{team.averageSpeakerScore.toFixed(2)}</TD>
                    {isBP ? (
                      <>
                        <TD numeric>{team.firstPlaces || 0}</TD>
                        <TD numeric>{team.secondPlaces || 0}</TD>
                        <TD numeric>{team.thirdPlaces || 0}</TD>
                        <TD numeric className="text-fg-muted">{team.fourthPlaces || 0}</TD>
                      </>
                    ) : (
                      <>
                        <TD numeric className="font-semibold">{team.wins || 0}</TD>
                        <TD numeric>{team.margins && team.margins > 0 ? `+${team.margins}` : team.margins || 0}</TD>
                      </>
                    )}
                    {teamExtra.map((metric) => (
                      <TD key={metric} numeric className="text-fg-muted">{formatMetricValue(team.metrics[metric])}</TD>
                    ))}
                    <TD>
                      <div className="flex items-center gap-1">
                        {team.roundResults.map((r, rIdx) => (
                          <Badge
                            key={rIdx}
                            tone={isBP ? bpPointTone(r.points) : r.win ? "success" : "danger"}
                            className="w-6 justify-center px-0 font-mono"
                            title={`Round ${r.roundSeq}: ${r.points} pts (${r.side})`}
                          >
                            {isBP ? r.points : r.win ? "W" : "L"}
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
                  <TH>Speaker</TH>
                  <TH>Team</TH>
                  <TH>Institution</TH>
                  <TH align="right">Speeches</TH>
                  <TH align="right">Total</TH>
                  <TH align="right">Average</TH>
                  {speakerExtra.map((metric) => (
                    <TH key={metric} align="right">{SPEAKER_METRIC_LABELS[metric]}</TH>
                  ))}
                  <TH>Round scores</TH>
                </TR>
              </THead>
              <TBody>
                {filteredSpeakers.length === 0 && <TableEmpty colSpan={8 + speakerExtra.length}>{noMatches}</TableEmpty>}
                {filteredSpeakers.map((spk) => (
                  <TR key={spk.speakerId}>
                    <TD numeric className="text-fg-muted">
                      {spk.ineligible ? <span title="Missed too many speeches to be ranked">—</span> : spk.rank}
                    </TD>
                    <TD className="font-medium">
                      {spk.speakerName}
                      {categoryNames(spk.categories ?? []).length > 0 && (
                        <Badge className="ml-2 uppercase">{categoryNames(spk.categories ?? []).join(", ")}</Badge>
                      )}
                      {spk.ineligible && <Badge className="ml-2">Unranked: missed speeches</Badge>}
                    </TD>
                    <TD>{spk.teamName}</TD>
                    <TD className="text-fg-muted">{spk.institutionCode || "—"}</TD>
                    <TD numeric className="text-fg-muted">{spk.speechesCount}</TD>
                    <TD numeric className="text-[13px] font-semibold">{spk.totalScore.toFixed(1)}</TD>
                    <TD numeric>{spk.averageScore.toFixed(2)}</TD>
                    {speakerExtra.map((metric) => (
                      <TD key={metric} numeric className="text-fg-muted">{formatMetricValue(spk.metrics[metric])}</TD>
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
                  <TH>Reply speaker</TH>
                  <TH>Team</TH>
                  <TH align="right">Speeches</TH>
                  <TH align="right">Total</TH>
                  <TH align="right">Average</TH>
                </TR>
              </THead>
              <TBody>
                {replyStandings.map((rep) => (
                  <TR key={rep.speakerId}>
                    <TD numeric className="text-fg-muted">
                      {rep.ineligible ? <span title="Missed too many replies to be ranked">—</span> : rep.rank}
                    </TD>
                    <TD className="font-medium">
                      {rep.speakerName}
                      {rep.ineligible && <Badge className="ml-2">Unranked: missed replies</Badge>}
                    </TD>
                    <TD>{rep.teamName}</TD>
                    <TD numeric className="text-fg-muted">{rep.speechesCount}</TD>
                    <TD numeric className="text-[13px] font-semibold">{rep.totalScore.toFixed(1)}</TD>
                    <TD numeric>{rep.averageScore.toFixed(2)}</TD>
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
