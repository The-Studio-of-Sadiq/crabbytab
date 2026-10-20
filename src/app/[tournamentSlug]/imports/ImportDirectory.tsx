"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { Plus, Upload, Trash2, Edit2, Search, Key } from "lucide-react";
import { Team, Adjudicator, Institution } from "@/types";
import {
  adjudicatorConflictIds,
  applyConflictSelection,
  changeAdjudicatorInstitution,
  extraInstitutionConflictIds,
  teamConflictIds,
  type ConflictSelection,
} from "@/lib/adjudicators/conflicts";
import { participantRegion } from "@/lib/adjudicators/diversity";
import { AdjudicatorConflictsEditor } from "@/features/tournament/components/AdjudicatorConflictsEditor";
import { BreakEligibilityField, SpeakerCategoriesInput } from "@/features/tournament/components/TeamCategoryFields";
import { CsvImportDialog } from "@/features/tournament/components/CsvImportDialog";
import { effectiveSpeakerCategories, speakerCategoryNames, speakerCategoryRefs } from "@/lib/speakerCategories";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, IconButton, buttonClasses, iconButtonClasses } from "@/components/ui/Button";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Checkbox, Input, Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";

type DirectoryTab = "teams" | "adjs" | "institutions";

const TAB_TEXT: Record<
  DirectoryTab,
  { title: MessageKey; description: MessageKey; search: MessageKey; add: MessageKey }
> = {
  institutions: {
    title: "setup.imports.institutionsTitle",
    description: "setup.imports.institutionsDescription",
    search: "setup.imports.searchInstitutions",
    add: "setup.imports.addInstitution",
  },
  teams: {
    title: "setup.imports.teamsTitle",
    description: "setup.imports.teamsDescription",
    search: "setup.imports.searchTeams",
    add: "setup.imports.addTeam",
  },
  adjs: {
    title: "setup.imports.adjudicatorsTitle",
    description: "setup.imports.adjudicatorsDescription",
    search: "setup.imports.searchAdjudicators",
    add: "setup.imports.addAdjudicator",
  },
};

/** A record waiting for the delete confirmation. */
interface PendingDelete {
  kind: "team" | "adjudicator" | "institution";
  id: string;
  name: string;
}

const DELETE_TEXT: Record<PendingDelete["kind"], { title: MessageKey; description: MessageKey; confirm: MessageKey }> = {
  team: {
    title: "setup.imports.deleteTeamTitle",
    description: "setup.imports.deleteTeamDescription",
    confirm: "setup.imports.deleteTeamConfirm",
  },
  adjudicator: {
    title: "setup.imports.deleteAdjudicatorTitle",
    description: "setup.imports.deleteAdjudicatorDescription",
    confirm: "setup.imports.deleteAdjudicatorConfirm",
  },
  institution: {
    title: "setup.imports.deleteInstitutionTitle",
    description: "setup.imports.deleteInstitutionDescription",
    confirm: "setup.imports.deleteInstitutionConfirm",
  },
};

/** Inset box grouping an affiliation choice inside a form. */
const groupBox = "space-y-2 rounded-md border border-border bg-muted/40 p-3";
const groupLegend = "px-1 text-xs font-medium text-fg";

export default function ImportDirectory({
  category,
}: {
  category: "institutions" | "teams" | "adjudicators";
}) {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;
  const { t, plural, formatDecimal } = useI18n();

  const {
    tournament,
    isOwnerOrAdmin,
    teams,
    adjudicators,
    institutions,
    breakCategories,
    addTeam,
    updateTeam,
    deleteTeam,
    addAdjudicator,
    updateAdjudicators,
    deleteAdjudicator,
    addInstitution,
    updateInstitution,
    deleteInstitution,
  } = useTournament();

  const activeTab: "teams" | "adjs" | "institutions" =
    category === "adjudicators" ? "adjs" : category;
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);

  const [showAddAdjModal, setShowAddAdjModal] = useState(false);
  const [editingAdj, setEditingAdj] = useState<Adjudicator | null>(null);
  const [editingAdjConflicts, setEditingAdjConflicts] = useState<ConflictSelection>({
    teamIds: [],
    adjudicatorIds: [],
    institutionIds: [],
  });
  const [adjSaveError, setAdjSaveError] = useState("");

  const [showAddInstModal, setShowAddInstModal] = useState(false);
  const [editingInst, setEditingInst] = useState<Institution | null>(null);

  const [showCsvModal, setShowCsvModal] = useState(false);

  // New Institution Form State
  const [instName, setInstName] = useState("");
  const [instCode, setInstCode] = useState("");
  const [instRegion, setInstRegion] = useState("");

  // New Team Form State
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamInstId, setNewTeamInstId] = useState("");
  const [newTeamUnaffiliated, setNewTeamUnaffiliated] = useState(false);
  const [newSpk1, setNewSpk1] = useState("");
  const [newSpk1Email, setNewSpk1Email] = useState("");
  const [newSpk2, setNewSpk2] = useState("");
  const [newSpk2Email, setNewSpk2Email] = useState("");
  const [newSpk3, setNewSpk3] = useState("");
  const [newSpk3Email, setNewSpk3Email] = useState("");
  const [newBreakCategories, setNewBreakCategories] = useState<string[]>([]);
  const [newSpeakerCategories, setNewSpeakerCategories] = useState<string[][]>([[], [], []]);
  const setNewSpeakerCategoriesAt = (index: number, categories: string[]) =>
    setNewSpeakerCategories((current) => current.map((item, itemIndex) => (itemIndex === index ? categories : item)));

  // New Adj Form State
  const [newAdjName, setNewAdjName] = useState("");
  const [newAdjEmail, setNewAdjEmail] = useState("");
  const [newAdjInstId, setNewAdjInstId] = useState("");
  const [newAdjUnaffiliated, setNewAdjUnaffiliated] = useState(false);
  const [newAdjScore, setNewAdjScore] = useState(5.0);
  const [newAdjTrainee, setNewAdjTrainee] = useState(false);

  const isBP = tournament?.format === "bp";
  const speakerCategories = useMemo(
    () => effectiveSpeakerCategories(tournament?.preferences.speakerCategories, teams),
    [tournament?.preferences.speakerCategories, teams]
  );

  // Institution count maps
  const instTeamCount = useMemo(() => {
    const map = new Map<string, number>();
    teams.forEach((t) => {
      if (t.institutionId) {
        map.set(t.institutionId, (map.get(t.institutionId) || 0) + 1);
      } else if (t.institutionName) {
        // match by name
        const match = institutions.find((i) => i.name.toLowerCase() === (t.institutionName || "").toLowerCase());
        if (match) {
          map.set(match.id, (map.get(match.id) || 0) + 1);
        }
      }
    });
    return map;
  }, [teams, institutions]);

  const instAdjCount = useMemo(() => {
    const map = new Map<string, number>();
    adjudicators.forEach((a) => {
      if (a.institutionId) {
        map.set(a.institutionId, (map.get(a.institutionId) || 0) + 1);
      } else if (a.institutionName && !a.independent) {
        const match = institutions.find((i) => i.name.toLowerCase() === (a.institutionName || "").toLowerCase());
        if (match) {
          map.set(match.id, (map.get(match.id) || 0) + 1);
        }
      }
    });
    return map;
  }, [adjudicators, institutions]);

  const filteredInstitutions = institutions.filter(
    (i) =>
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (i.region || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredTeams = teams.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.institutionName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.speakers || []).some((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredAdjs = adjudicators.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.institutionName || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Institution Handlers
  const handleCreateInstitution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instName.trim()) return;

    await addInstitution({
      name: instName.trim(),
      code: instCode.trim() || instName.trim().substring(0, 4).toUpperCase(),
      region: instRegion.trim() || undefined,
    });

    setInstName("");
    setInstCode("");
    setInstRegion("");
    setShowAddInstModal(false);
  };

  const handleUpdateInstitution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInst || !editingInst.name.trim()) return;

    await updateInstitution(editingInst);
    setEditingInst(null);
  };

  // Team Handlers
  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    const selectedInst = !newTeamUnaffiliated && newTeamInstId ? institutions.find((i) => i.id === newTeamInstId) : null;

    const speakers = [
      {
        id: `spk-${Date.now()}-1`,
        name: newSpk1.trim() || `${newTeamName} Spk 1`,
        email: newSpk1Email.trim() || undefined,
        categories: newSpeakerCategories[0].length > 0 ? newSpeakerCategories[0] : undefined,
      },
      {
        id: `spk-${Date.now()}-2`,
        name: newSpk2.trim() || `${newTeamName} Spk 2`,
        email: newSpk2Email.trim() || undefined,
        categories: newSpeakerCategories[1].length > 0 ? newSpeakerCategories[1] : undefined,
      },
    ];

    if (!isBP && (newSpk3.trim() || newSpk3Email.trim())) {
      speakers.push({
        id: `spk-${Date.now()}-3`,
        name: newSpk3.trim() || `${newTeamName} Spk 3`,
        email: newSpk3Email.trim() || undefined,
        categories: newSpeakerCategories[2].length > 0 ? newSpeakerCategories[2] : undefined,
      });
    }

    await addTeam({
      name: newTeamName.trim(),
      codeName: newTeamName.trim(),
      institutionId: selectedInst ? selectedInst.id : undefined,
      institutionName: selectedInst ? selectedInst.name : undefined,
      speakers,
      breakCategories: newBreakCategories,
      speakerCategories: [],
      checkedIn: true,
    });

    setNewTeamName("");
    setNewTeamInstId("");
    setNewTeamUnaffiliated(false);
    setNewSpk1("");
    setNewSpk1Email("");
    setNewSpk2("");
    setNewSpk2Email("");
    setNewSpk3("");
    setNewSpk3Email("");
    setNewBreakCategories([]);
    setNewSpeakerCategories([[], [], []]);
    setShowAddTeamModal(false);
  };

  const handleUpdateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeam || !editingTeam.name.trim()) return;

    await updateTeam(editingTeam);
    setEditingTeam(null);
  };

  // Adjudicator Handlers
  const handleCreateAdj = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdjName.trim()) return;

    const selectedInst = !newAdjUnaffiliated && newAdjInstId ? institutions.find((i) => i.id === newAdjInstId) : null;

    await addAdjudicator({
      name: newAdjName.trim(),
      email: newAdjEmail.trim() || undefined,
      institutionId: selectedInst ? selectedInst.id : undefined,
      institutionName: selectedInst ? selectedInst.name : undefined,
      baseScore: newAdjScore,
      trainee: newAdjTrainee,
      independent: newAdjUnaffiliated || !selectedInst,
      checkedIn: true,
      conflicts: selectedInst ? [{ institutionId: selectedInst.id, type: "institution" }] : [],
    });

    setNewAdjName("");
    setNewAdjEmail("");
    setNewAdjInstId("");
    setNewAdjUnaffiliated(false);
    setNewAdjScore(5.0);
    setNewAdjTrainee(false);
    setShowAddAdjModal(false);
  };

  const institutionsById = useMemo(
    () => new Map(institutions.map((institution) => [institution.id, institution])),
    [institutions]
  );

  const openAdjEditor = (adjudicator: Adjudicator) => {
    setAdjSaveError("");
    setEditingAdj(adjudicator);
    setEditingAdjConflicts({
      teamIds: teamConflictIds(adjudicator),
      adjudicatorIds: adjudicatorConflictIds(adjudicator, adjudicators),
      institutionIds: extraInstitutionConflictIds(adjudicator),
    });
  };

  const handleUpdateAdj = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdj || !editingAdj.name.trim()) return;

    setAdjSaveError("");
    try {
      // Also saves anyone whose declaration of a removed adjudicator conflict was dropped.
      await updateAdjudicators(applyConflictSelection(editingAdj, editingAdjConflicts, adjudicators));
    } catch (error) {
      setAdjSaveError(error instanceof Error ? error.message : t("setup.imports.adjudicatorSaveError"));
      return;
    }
    setEditingAdj(null);
  };

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const requestDelete = (request: PendingDelete) => {
    setDeleteError("");
    setPendingDelete(request);
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      if (pendingDelete.kind === "team") await deleteTeam(pendingDelete.id);
      else if (pendingDelete.kind === "adjudicator") await deleteAdjudicator(pendingDelete.id);
      else await deleteInstitution(pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("setup.imports.deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  const tabText = TAB_TEXT[activeTab];
  const speakerLabel = (name: string | undefined, index: number) =>
    name || t("setup.imports.speakerNumber", { number: index + 1 });
  /** Empty-table message: a search with no hits, or nothing registered yet. */
  const emptyMessage = (total: number, emptyKey: MessageKey) =>
    total > 0 && searchQuery ? t("setup.imports.noMatches", { query: searchQuery }) : t(emptyKey);
  const institutionOptions = institutions.map((inst) => (
    <option key={inst.id} value={inst.id}>
      {inst.name} ({inst.code})
    </option>
  ));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t(tabText.title)}
        description={t(tabText.description)}
        actions={
          <>
            <Link href={`/${tournamentSlug}/private-urls`} className={buttonClasses({ variant: "secondary" })}>
              <Key aria-hidden="true" />
              {t("setup.imports.privateUrls")}
            </Link>
            <Button variant="secondary" onClick={() => setShowCsvModal(true)}>
              <Upload aria-hidden="true" />
              {t("setup.imports.importCsv")}
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                activeTab === "institutions"
                  ? setShowAddInstModal(true)
                  : activeTab === "teams"
                    ? setShowAddTeamModal(true)
                    : setShowAddAdjModal(true)
              }
            >
              <Plus aria-hidden="true" />
              {t(tabText.add)}
            </Button>
          </>
        }
      />

      {/* Search */}
      <div className="w-full sm:w-72">
        <Input
          type="search"
          leadingIcon={<Search />}
          aria-label={t(tabText.search)}
          placeholder={t(tabText.search)}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 1. Teams Table */}
      {activeTab === "teams" && (
        <TableContainer>
          <Table>
            <caption className="sr-only">{t("setup.imports.teamsCaption")}</caption>
            <THead>
              <TR>
                <TH align="right" className="w-12">#</TH>
                <TH>{t("setup.imports.colTeamName")}</TH>
                <TH>{t("setup.imports.institution")}</TH>
                <TH>{t("setup.imports.colSpeakers")}</TH>
                <TH>{t("setup.imports.colCategories")}</TH>
                <TH align="center" className="w-28">{t("setup.common.status")}</TH>
                <TH align="right" className="w-28">{t("setup.common.actions")}</TH>
              </TR>
            </THead>
            <TBody>
              {filteredTeams.map((team, idx) => (
                <TR key={team.id}>
                  <TD numeric className="text-fg-muted">{idx + 1}</TD>
                  <TD className="font-medium">{team.name}</TD>
                  <TD>
                    {team.institutionName ? (
                      <span className="text-xs">{team.institutionName}</span>
                    ) : (
                      <span className="text-xs italic text-fg-muted">{t("setup.imports.unaffiliated")}</span>
                    )}
                  </TD>
                  <TD className="text-xs text-fg-muted">
                    {team.speakers?.map((s) => s.name).join(", ") || "—"}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {speakerCategoryNames(
                        team.speakers.flatMap((speaker) => speakerCategoryRefs(speaker, team)),
                        speakerCategories
                      ).map((name) => (
                        <Badge key={name} tone="accent">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TD align="center">
                    <StatusPill tone="success">{t("setup.imports.checkedIn")}</StatusPill>
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-0.5">
                      {team.privateUrlKey && (
                        <Link
                          href={`/${tournamentSlug}/private/team/${team.privateUrlKey}`}
                          target="_blank"
                          rel="noreferrer"
                          className={iconButtonClasses({ size: "sm" })}
                          aria-label={t("setup.imports.openTeamPortal", { name: team.name })}
                          title={t("setup.imports.openTeamPortal", { name: team.name })}
                        >
                          <Key aria-hidden="true" />
                        </Link>
                      )}
                      <IconButton
                        size="sm"
                        icon={<Edit2 aria-hidden="true" />}
                        label={t("setup.imports.editTeamNamed", { name: team.name })}
                        onClick={() => setEditingTeam(team)}
                      />
                      {isOwnerOrAdmin && (
                        <IconButton
                          size="sm"
                          icon={<Trash2 aria-hidden="true" />}
                          label={t("setup.imports.deleteTeamNamed", { name: team.name })}
                          onClick={() => requestDelete({ kind: "team", id: team.id, name: team.name })}
                          className="hover:text-danger"
                        />
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
              {filteredTeams.length === 0 && (
                <TableEmpty colSpan={7}>{emptyMessage(teams.length, "setup.imports.teamsEmpty")}</TableEmpty>
              )}
            </TBody>
          </Table>
        </TableContainer>
      )}

      {/* 2. Adjudicators Table */}
      {activeTab === "adjs" && (
        <TableContainer>
          <Table>
            <caption className="sr-only">{t("setup.imports.adjudicatorsCaption")}</caption>
            <THead>
              <TR>
                <TH align="right" className="w-12">#</TH>
                <TH>{t("setup.imports.colJudgeName")}</TH>
                <TH>{t("setup.imports.colAffiliation")}</TH>
                <TH align="right">{t("setup.imports.colRating")}</TH>
                <TH>{t("setup.imports.colGenderRegion")}</TH>
                <TH align="right">{t("setup.imports.colConflicts")}</TH>
                <TH align="center">{t("setup.imports.colRole")}</TH>
                <TH align="center" className="w-24">{t("setup.common.status")}</TH>
                <TH align="right" className="w-28">{t("setup.common.actions")}</TH>
              </TR>
            </THead>
            <TBody>
              {filteredAdjs.map((adj, idx) => (
                <TR key={adj.id}>
                  <TD numeric className="text-fg-muted">{idx + 1}</TD>
                  <TD className="font-medium">{adj.name}</TD>
                  <TD>
                    {adj.independent || !adj.institutionName ? (
                      <Badge>{t("setup.imports.unaffiliated")}</Badge>
                    ) : (
                      <span className="text-xs">{adj.institutionName}</span>
                    )}
                  </TD>
                  <TD numeric className="font-semibold">
                    {formatDecimal(adj.baseScore ?? 5, 1)}
                  </TD>
                  <TD className="text-xs text-fg-muted">
                    {adj.gender?.trim() || "—"} · {participantRegion(adj, institutionsById) || "—"}
                  </TD>
                  <TD numeric>
                    {teamConflictIds(adj).length + adjudicatorConflictIds(adj, adjudicators).length +
                      extraInstitutionConflictIds(adj).length}
                  </TD>
                  <TD align="center">
                    {adj.trainee ? (
                      <Badge tone="warning">{t("setup.imports.trainee")}</Badge>
                    ) : (
                      <Badge tone="info">{t("setup.imports.accredited")}</Badge>
                    )}
                  </TD>
                  <TD align="center">
                    <StatusPill tone="success">{t("setup.imports.active")}</StatusPill>
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-0.5">
                      {adj.privateUrlKey && (
                        <Link
                          href={`/${tournamentSlug}/private/adjudicator/${adj.privateUrlKey}`}
                          target="_blank"
                          rel="noreferrer"
                          className={iconButtonClasses({ size: "sm" })}
                          aria-label={t("setup.imports.openAdjudicatorPortal", { name: adj.name })}
                          title={t("setup.imports.openAdjudicatorPortal", { name: adj.name })}
                        >
                          <Key aria-hidden="true" />
                        </Link>
                      )}
                      <IconButton
                        size="sm"
                        icon={<Edit2 aria-hidden="true" />}
                        label={t("setup.imports.editAdjudicatorNamed", { name: adj.name })}
                        onClick={() => openAdjEditor(adj)}
                      />
                      {isOwnerOrAdmin && (
                        <IconButton
                          size="sm"
                          icon={<Trash2 aria-hidden="true" />}
                          label={t("setup.imports.deleteAdjudicatorNamed", { name: adj.name })}
                          onClick={() => requestDelete({ kind: "adjudicator", id: adj.id, name: adj.name })}
                          className="hover:text-danger"
                        />
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
              {filteredAdjs.length === 0 && (
                <TableEmpty colSpan={9}>
                  {emptyMessage(adjudicators.length, "setup.imports.adjudicatorsEmpty")}
                </TableEmpty>
              )}
            </TBody>
          </Table>
        </TableContainer>
      )}

      {/* 3. Institutions Table */}
      {activeTab === "institutions" && (
        <TableContainer>
          <Table>
            <caption className="sr-only">{t("setup.imports.institutionsCaption")}</caption>
            <THead>
              <TR>
                <TH align="right" className="w-12">#</TH>
                <TH>{t("setup.imports.colInstitutionName")}</TH>
                <TH>{t("setup.imports.colCodeAbbr")}</TH>
                <TH>{t("setup.imports.region")}</TH>
                <TH align="center">{t("setup.imports.colTeamsCount")}</TH>
                <TH align="center">{t("setup.imports.colJudgesCount")}</TH>
                <TH align="right" className="w-24">{t("setup.common.actions")}</TH>
              </TR>
            </THead>
            <TBody>
              {filteredInstitutions.map((inst, idx) => (
                <TR key={inst.id}>
                  <TD numeric className="text-fg-muted">{idx + 1}</TD>
                  <TD className="font-medium">{inst.name}</TD>
                  <TD className="font-mono text-xs">{inst.code}</TD>
                  <TD className="text-xs text-fg-muted">{inst.region || "—"}</TD>
                  <TD align="center">
                    <Badge>{plural("setup.imports.teamsCount", instTeamCount.get(inst.id) || 0)}</Badge>
                  </TD>
                  <TD align="center">
                    <Badge>{plural("setup.imports.judgesCount", instAdjCount.get(inst.id) || 0)}</Badge>
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-0.5">
                      <IconButton
                        size="sm"
                        icon={<Edit2 aria-hidden="true" />}
                        label={t("setup.imports.editInstitutionNamed", { name: inst.name })}
                        onClick={() => setEditingInst(inst)}
                      />
                      {isOwnerOrAdmin && (
                        <IconButton
                          size="sm"
                          icon={<Trash2 aria-hidden="true" />}
                          label={t("setup.imports.deleteInstitutionNamed", { name: inst.name })}
                          onClick={() => requestDelete({ kind: "institution", id: inst.id, name: inst.name })}
                          className="hover:text-danger"
                        />
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
              {filteredInstitutions.length === 0 && (
                <TableEmpty colSpan={7}>
                  {emptyMessage(institutions.length, "setup.imports.institutionsEmpty")}
                </TableEmpty>
              )}
            </TBody>
          </Table>
        </TableContainer>
      )}

      {/* Add Institution */}
      <Dialog
        open={showAddInstModal}
        onClose={() => setShowAddInstModal(false)}
        title={t("setup.imports.addInstitutionTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowAddInstModal(false)}>
              {t("setup.common.cancel")}
            </Button>
            <Button type="submit" form="add-institution-form" variant="primary">
              {t("setup.imports.createInstitution")}
            </Button>
          </>
        }
      >
        <form id="add-institution-form" onSubmit={handleCreateInstitution} className="space-y-3">
          <Input
            label={t("setup.imports.institutionName")}
            required
            placeholder={t("setup.imports.institutionNamePlaceholder")}
            value={instName}
            onChange={(e) => setInstName(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t("setup.imports.codeAbbr")}
              help={t("setup.imports.codeHelp")}
              placeholder={t("setup.imports.codePlaceholder")}
              value={instCode}
              onChange={(e) => setInstCode(e.target.value)}
            />
            <Input
              label={t("setup.imports.region")}
              help={t("setup.common.optional")}
              placeholder={t("setup.imports.regionPlaceholder")}
              value={instRegion}
              onChange={(e) => setInstRegion(e.target.value)}
            />
          </div>
        </form>
      </Dialog>

      {/* Edit Institution */}
      <Dialog
        open={editingInst !== null}
        onClose={() => setEditingInst(null)}
        title={t("setup.imports.editInstitutionTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingInst(null)}>
              {t("setup.common.cancel")}
            </Button>
            <Button type="submit" form="edit-institution-form" variant="primary">
              {t("setup.common.saveChanges")}
            </Button>
          </>
        }
      >
        {editingInst && (
          <form id="edit-institution-form" onSubmit={handleUpdateInstitution} className="space-y-3">
            <Input
              label={t("setup.imports.institutionName")}
              required
              value={editingInst.name}
              onChange={(e) => setEditingInst({ ...editingInst, name: e.target.value })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t("setup.imports.codeAbbr")}
                value={editingInst.code}
                onChange={(e) => setEditingInst({ ...editingInst, code: e.target.value })}
              />
              <Input
                label={t("setup.imports.region")}
                value={editingInst.region || ""}
                onChange={(e) => setEditingInst({ ...editingInst, region: e.target.value })}
              />
            </div>
          </form>
        )}
      </Dialog>

      {/* Add Team */}
      <Dialog
        open={showAddTeamModal}
        onClose={() => setShowAddTeamModal(false)}
        title={t("setup.imports.addTeamTitle")}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowAddTeamModal(false)}>
              {t("setup.common.cancel")}
            </Button>
            <Button type="submit" form="add-team-form" variant="primary">
              {t("setup.imports.addTeam")}
            </Button>
          </>
        }
      >
        <form id="add-team-form" onSubmit={handleCreateTeam} className="space-y-3">
          <Input
            label={t("setup.imports.teamName")}
            required
            placeholder={t("setup.imports.teamNamePlaceholder")}
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
          />

          <fieldset className={groupBox}>
            <legend className={groupLegend}>{t("setup.imports.affiliation")}</legend>
            <Checkbox
              label={t("setup.imports.unaffiliatedIndependent")}
              checked={newTeamUnaffiliated}
              onChange={(e) => setNewTeamUnaffiliated(e.target.checked)}
            />
            {!newTeamUnaffiliated ? (
              <div className="space-y-1">
                <Select
                  aria-label={t("setup.imports.institution")}
                  value={newTeamInstId}
                  onChange={(e) => setNewTeamInstId(e.target.value)}
                >
                  <option value="">{t("setup.imports.selectInstitution")}</option>
                  {institutionOptions}
                </Select>
                {institutions.length === 0 && (
                  <p className="text-xs text-warning">{t("setup.imports.noInstitutionsTeam")}</p>
                )}
              </div>
            ) : (
              <p className="text-xs italic text-fg-muted">{t("setup.imports.teamIndependentHelp")}</p>
            )}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                [newSpk1, setNewSpk1, newSpk1Email, setNewSpk1Email],
                [newSpk2, setNewSpk2, newSpk2Email, setNewSpk2Email],
                ...(!isBP ? [[newSpk3, setNewSpk3, newSpk3Email, setNewSpk3Email] as const] : []),
              ] as const
            ).map(([name, setName, email, setEmail], index) => (
              <div key={index} className="space-y-1.5">
                <Input
                  label={t("setup.imports.speakerNumber", { number: index + 1 })}
                  placeholder={t("setup.imports.speakerNamePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  type="email"
                  aria-label={t("setup.imports.speakerEmailLabel", { number: index + 1 })}
                  placeholder={t("setup.imports.emailOptional")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <SpeakerCategoriesInput
                  id={`new-speaker-${index + 1}-categories`}
                  label={t("setup.imports.speakerCategoriesLabel", { number: index + 1 })}
                  categories={speakerCategories}
                  value={newSpeakerCategories[index]}
                  onChange={(categories) => setNewSpeakerCategoriesAt(index, categories)}
                />
              </div>
            ))}
          </div>

          <BreakEligibilityField
            categories={breakCategories}
            value={newBreakCategories}
            onChange={setNewBreakCategories}
          />
        </form>
      </Dialog>

      {/* Edit Team */}
      <Dialog
        open={editingTeam !== null}
        onClose={() => setEditingTeam(null)}
        title={t("setup.imports.editTeamTitle")}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingTeam(null)}>
              {t("setup.common.cancel")}
            </Button>
            <Button type="submit" form="edit-team-form" variant="primary">
              {t("setup.common.saveChanges")}
            </Button>
          </>
        }
      >
        {editingTeam && (
          <form id="edit-team-form" onSubmit={handleUpdateTeam} className="space-y-3">
            <Input
              label={t("setup.imports.teamName")}
              required
              value={editingTeam.name}
              onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
            />

            {/* Public identity (Tabbycat code names and emoji) */}
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <Input
                label={t("setup.imports.codeName")}
                value={editingTeam.codeName ?? ""}
                onChange={(e) => setEditingTeam({ ...editingTeam, codeName: e.target.value || undefined })}
                placeholder={t("setup.imports.teamCodeNamePlaceholder")}
              />
              <Input
                label={t("setup.imports.emoji")}
                value={editingTeam.emoji ?? ""}
                onChange={(e) => setEditingTeam({ ...editingTeam, emoji: e.target.value.trim() || undefined })}
                maxLength={8}
              />
            </div>

            <fieldset className={groupBox}>
              <legend className={groupLegend}>{t("setup.imports.affiliation")}</legend>
              <Checkbox
                label={t("setup.imports.unaffiliatedShort")}
                checked={!editingTeam.institutionId && !editingTeam.institutionName}
                onChange={(e) => {
                  if (e.target.checked) {
                    setEditingTeam({ ...editingTeam, institutionId: undefined, institutionName: undefined });
                  } else {
                    const firstInst = institutions[0];
                    if (firstInst) {
                      setEditingTeam({ ...editingTeam, institutionId: firstInst.id, institutionName: firstInst.name });
                    }
                  }
                }}
              />
              {editingTeam.institutionId || editingTeam.institutionName ? (
                <Select
                  aria-label={t("setup.imports.institution")}
                  value={editingTeam.institutionId || ""}
                  onChange={(e) => {
                    const selected = institutions.find((i) => i.id === e.target.value);
                    setEditingTeam({
                      ...editingTeam,
                      institutionId: selected?.id,
                      institutionName: selected?.name,
                    });
                  }}
                >
                  <option value="">{t("setup.imports.selectInstitution")}</option>
                  {institutionOptions}
                </Select>
              ) : (
                <p className="text-xs italic text-fg-muted">{t("setup.imports.teamIndependentShort")}</p>
              )}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-xs font-medium text-fg">{t("setup.imports.speakers")}</legend>
              {editingTeam.speakers?.map((spk, idx) => (
                <div
                  key={spk.id || idx}
                  role="group"
                  aria-label={speakerLabel(spk.name, idx)}
                  className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-2"
                >
                  <Input
                    value={spk.name}
                    onChange={(e) => {
                      const newSpeakers = [...editingTeam.speakers];
                      newSpeakers[idx] = { ...spk, name: e.target.value };
                      setEditingTeam({ ...editingTeam, speakers: newSpeakers });
                    }}
                    aria-label={t("setup.imports.speakerNameLabel", { number: idx + 1 })}
                    placeholder={t("setup.imports.speakerNumber", { number: idx + 1 })}
                  />
                  <Input
                    type="email"
                    value={spk.email || ""}
                    onChange={(e) => {
                      const newSpeakers = [...editingTeam.speakers];
                      newSpeakers[idx] = { ...spk, email: e.target.value.trim() || undefined };
                      setEditingTeam({ ...editingTeam, speakers: newSpeakers });
                    }}
                    aria-label={t("setup.imports.speakerEmailLabel", { number: idx + 1 })}
                    placeholder={t("setup.imports.emailOptional")}
                  />
                  <Input
                    value={spk.codeName || ""}
                    onChange={(e) => {
                      const newSpeakers = [...editingTeam.speakers];
                      newSpeakers[idx] = { ...spk, codeName: e.target.value || undefined };
                      setEditingTeam({ ...editingTeam, speakers: newSpeakers });
                    }}
                    placeholder={t("setup.imports.codeNameOptional")}
                    aria-label={t("setup.imports.namedSpeakerCodeName", { name: speakerLabel(spk.name, idx) })}
                  />
                  <Checkbox
                    className="self-center"
                    label={t("setup.imports.anonymousPublic")}
                    checked={spk.anonymous === true}
                    onChange={(e) => {
                      const newSpeakers = [...editingTeam.speakers];
                      newSpeakers[idx] = { ...spk, anonymous: e.target.checked || undefined };
                      setEditingTeam({ ...editingTeam, speakers: newSpeakers });
                    }}
                  />
                  <div className="sm:col-span-2">
                    <SpeakerCategoriesInput
                      id={`edit-speaker-${idx}-categories`}
                      label={t("setup.imports.namedSpeakerCategories", { name: speakerLabel(spk.name, idx) })}
                      categories={speakerCategories}
                      value={speakerCategoryRefs(spk, editingTeam)}
                      onChange={(categories) => {
                        const newSpeakers = [...editingTeam.speakers];
                        newSpeakers[idx] = { ...spk, categories: categories.length > 0 ? categories : undefined };
                        setEditingTeam({ ...editingTeam, speakers: newSpeakers });
                      }}
                    />
                  </div>
                </div>
              ))}
            </fieldset>

            <BreakEligibilityField
              categories={breakCategories}
              value={editingTeam.breakCategories ?? []}
              onChange={(categoryIds) => setEditingTeam({ ...editingTeam, breakCategories: categoryIds })}
            />
          </form>
        )}
      </Dialog>

      {/* Add Adjudicator */}
      <Dialog
        open={showAddAdjModal}
        onClose={() => setShowAddAdjModal(false)}
        title={t("setup.imports.addAdjudicatorTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowAddAdjModal(false)}>
              {t("setup.common.cancel")}
            </Button>
            <Button type="submit" form="add-adjudicator-form" variant="primary">
              {t("setup.imports.addAdjudicator")}
            </Button>
          </>
        }
      >
        <form id="add-adjudicator-form" onSubmit={handleCreateAdj} className="space-y-3">
          <Input
            label={t("setup.imports.judgeName")}
            required
            placeholder={t("setup.imports.judgeNamePlaceholder")}
            value={newAdjName}
            onChange={(e) => setNewAdjName(e.target.value)}
          />
          <Input
            type="email"
            label={t("setup.common.email")}
            placeholder={t("setup.imports.emailOptional")}
            value={newAdjEmail}
            onChange={(e) => setNewAdjEmail(e.target.value)}
          />

          <fieldset className={groupBox}>
            <legend className={groupLegend}>{t("setup.imports.affiliation")}</legend>
            <Checkbox
              label={t("setup.imports.unaffiliatedIndependent")}
              checked={newAdjUnaffiliated}
              onChange={(e) => setNewAdjUnaffiliated(e.target.checked)}
            />
            {!newAdjUnaffiliated ? (
              <div className="space-y-1">
                <Select
                  aria-label={t("setup.imports.institution")}
                  value={newAdjInstId}
                  onChange={(e) => setNewAdjInstId(e.target.value)}
                >
                  <option value="">{t("setup.imports.selectInstitution")}</option>
                  {institutionOptions}
                </Select>
                {institutions.length === 0 && (
                  <p className="text-xs text-warning">{t("setup.imports.noInstitutionsAdjudicator")}</p>
                )}
              </div>
            ) : (
              <p className="text-xs italic text-fg-muted">{t("setup.imports.adjudicatorIndependentHelp")}</p>
            )}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              type="number"
              step="0.5"
              min="1"
              max="10"
              label={t("setup.imports.baseRating")}
              value={newAdjScore}
              onChange={(e) => setNewAdjScore(parseFloat(e.target.value) || 5.0)}
              className="font-mono"
            />
            <Checkbox
              className="sm:pt-6"
              label={t("setup.imports.traineeJudge")}
              checked={newAdjTrainee}
              onChange={(e) => setNewAdjTrainee(e.target.checked)}
            />
          </div>
        </form>
      </Dialog>

      {/* Edit Adjudicator */}
      <Dialog
        open={editingAdj !== null}
        onClose={() => setEditingAdj(null)}
        title={t("setup.imports.editAdjudicatorTitle")}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingAdj(null)}>
              {t("setup.common.cancel")}
            </Button>
            <Button type="submit" form="edit-adjudicator-form" variant="primary">
              {t("setup.common.saveChanges")}
            </Button>
          </>
        }
      >
        {editingAdj && (
          <form id="edit-adjudicator-form" onSubmit={handleUpdateAdj} className="space-y-3">
            <Input
              label={t("setup.imports.judgeName")}
              required
              value={editingAdj.name}
              onChange={(e) => setEditingAdj({ ...editingAdj, name: e.target.value })}
            />
            <Input
              type="email"
              label={t("setup.common.email")}
              value={editingAdj.email || ""}
              onChange={(e) => setEditingAdj({ ...editingAdj, email: e.target.value.trim() || undefined })}
              placeholder={t("setup.imports.emailOptional")}
            />

            <fieldset className={groupBox}>
              <legend className={groupLegend}>{t("setup.imports.affiliation")}</legend>
              <Checkbox
                label={t("setup.imports.unaffiliatedIndependent")}
                checked={editingAdj.independent}
                onChange={(e) => {
                  const isIndep = e.target.checked;
                  const institution = isIndep
                    ? undefined
                    : institutions.find((item) => item.id === editingAdj.institutionId) ?? institutions[0];
                  setEditingAdj(changeAdjudicatorInstitution(editingAdj, institution));
                }}
              />
              {!editingAdj.independent ? (
                <Select
                  aria-label={t("setup.imports.institution")}
                  value={editingAdj.institutionId || ""}
                  onChange={(e) => {
                    const selected = institutions.find((i) => i.id === e.target.value);
                    setEditingAdj(changeAdjudicatorInstitution(editingAdj, selected));
                    setEditingAdjConflicts((current) => ({
                      ...current,
                      institutionIds: current.institutionIds.filter((id) => id !== selected?.id),
                    }));
                  }}
                >
                  <option value="">{t("setup.imports.selectInstitution")}</option>
                  {institutionOptions}
                </Select>
              ) : (
                <p className="text-xs italic text-fg-muted">{t("setup.imports.adjudicatorIndependentShort")}</p>
              )}
            </fieldset>

            <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
              <legend className="sr-only">{t("setup.imports.publicLists")}</legend>
              <Checkbox
                label={t("setup.imports.adjCore")}
                checked={editingAdj.adjCore === true}
                onChange={(e) => setEditingAdj({ ...editingAdj, adjCore: e.target.checked || undefined })}
              />
              <Checkbox
                label={t("setup.imports.breakingAdjudicator")}
                checked={editingAdj.breaking === true}
                onChange={(e) => setEditingAdj({ ...editingAdj, breaking: e.target.checked || undefined })}
              />
              <Checkbox
                label={t("setup.imports.anonymousPublic")}
                checked={editingAdj.anonymous === true}
                onChange={(e) => setEditingAdj({ ...editingAdj, anonymous: e.target.checked || undefined })}
              />
            </fieldset>

            <Input
              label={t("setup.imports.codeName")}
              value={editingAdj.codeName ?? ""}
              onChange={(e) => setEditingAdj({ ...editingAdj, codeName: e.target.value || undefined })}
              placeholder={t("setup.imports.adjudicatorCodeNamePlaceholder")}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="number"
                step="0.5"
                min="1"
                max="10"
                label={t("setup.imports.baseRating")}
                value={editingAdj.baseScore}
                onChange={(e) => setEditingAdj({ ...editingAdj, baseScore: parseFloat(e.target.value) || 5.0 })}
                className="font-mono"
              />
              <Checkbox
                className="sm:pt-6"
                label={t("setup.imports.traineeJudge")}
                checked={editingAdj.trainee}
                onChange={(e) => setEditingAdj({ ...editingAdj, trainee: e.target.checked })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={t("setup.imports.gender")}
                value={editingAdj.gender || ""}
                onChange={(e) => setEditingAdj({ ...editingAdj, gender: e.target.value || undefined })}
                onBlur={(e) => setEditingAdj({ ...editingAdj, gender: e.target.value.trim() || undefined })}
                placeholder={t("setup.imports.genderPlaceholder")}
              />
              <Input
                label={t("setup.imports.region")}
                help={t("setup.imports.regionHelp")}
                value={editingAdj.region || ""}
                onChange={(e) => setEditingAdj({ ...editingAdj, region: e.target.value || undefined })}
                onBlur={(e) => setEditingAdj({ ...editingAdj, region: e.target.value.trim() || undefined })}
                placeholder={
                  participantRegion({ institutionId: editingAdj.institutionId }, institutionsById) ||
                  t("setup.common.optional")
                }
              />
            </div>

            <AdjudicatorConflictsEditor
              adjudicator={editingAdj}
              selection={editingAdjConflicts}
              teams={teams}
              adjudicators={adjudicators}
              institutions={institutions}
              onChange={setEditingAdjConflicts}
            />

            {adjSaveError && (
              <Alert tone="danger" role="alert">
                {adjSaveError}
              </Alert>
            )}
          </form>
        )}
      </Dialog>

      {pendingDelete && (
        <ConfirmActionDialog
          variant="danger"
          title={t(DELETE_TEXT[pendingDelete.kind].title, { name: pendingDelete.name })}
          description={t(DELETE_TEXT[pendingDelete.kind].description)}
          confirmLabel={t(DELETE_TEXT[pendingDelete.kind].confirm)}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
          isBusy={deleting}
          error={deleteError || undefined}
        />
      )}

      <CsvImportDialog
        kind={activeTab === "adjs" ? "adjudicators" : activeTab}
        open={showCsvModal}
        onClose={() => setShowCsvModal(false)}
      />
    </div>
  );
}
