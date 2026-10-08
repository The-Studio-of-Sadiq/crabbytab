"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { parseTeamsCsv, parseAdjudicatorsCsv, parseInstitutionsCsv } from "@/lib/csv/importer";
import {
  Users,
  Users2,
  Building2,
  Plus,
  Upload,
  Trash2,
  Edit2,
  Search,
  CheckCircle2,
  AlertTriangle,
  X,
  Sparkles,
  ExternalLink,
  Key,
} from "lucide-react";
import { Team, Adjudicator, Institution } from "@/types";

export default function ImportDirectory({
  category,
}: {
  category: "institutions" | "teams" | "adjudicators";
}) {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;

  const {
    tournament,
    teams,
    adjudicators,
    institutions,
    addTeam,
    addTeams,
    updateTeam,
    deleteTeam,
    addAdjudicator,
    addAdjudicators,
    updateAdjudicator,
    deleteAdjudicator,
    addInstitution,
    addInstitutions,
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

  const [showAddInstModal, setShowAddInstModal] = useState(false);
  const [editingInst, setEditingInst] = useState<Institution | null>(null);

  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvImportError, setCsvImportError] = useState("");
  const [isImportingCsv, setIsImportingCsv] = useState(false);

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
  const [newCategory, setNewCategory] = useState("");

  // New Adj Form State
  const [newAdjName, setNewAdjName] = useState("");
  const [newAdjEmail, setNewAdjEmail] = useState("");
  const [newAdjInstId, setNewAdjInstId] = useState("");
  const [newAdjUnaffiliated, setNewAdjUnaffiliated] = useState(false);
  const [newAdjScore, setNewAdjScore] = useState(5.0);
  const [newAdjTrainee, setNewAdjTrainee] = useState(false);

  const isBP = tournament?.format === "bp";

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
      },
      {
        id: `spk-${Date.now()}-2`,
        name: newSpk2.trim() || `${newTeamName} Spk 2`,
        email: newSpk2Email.trim() || undefined,
      },
    ];

    if (!isBP && (newSpk3.trim() || newSpk3Email.trim())) {
      speakers.push({
        id: `spk-${Date.now()}-3`,
        name: newSpk3.trim() || `${newTeamName} Spk 3`,
        email: newSpk3Email.trim() || undefined,
      });
    }

    await addTeam({
      name: newTeamName.trim(),
      codeName: newTeamName.trim(),
      institutionId: selectedInst ? selectedInst.id : undefined,
      institutionName: selectedInst ? selectedInst.name : undefined,
      speakers,
      breakCategories: [],
      speakerCategories: newCategory ? [newCategory.trim().toLowerCase()] : [],
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
    setNewCategory("");
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

  const handleUpdateAdj = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdj || !editingAdj.name.trim()) return;

    await updateAdjudicator(editingAdj);
    setEditingAdj(null);
  };

  // CSV Import Handler
  const handleCsvImport = async () => {
    if (!csvText.trim()) return;
    setIsImportingCsv(true);
    setCsvImportError("");
    try {
      if (activeTab === "institutions") {
        const parsed = parseInstitutionsCsv(csvText, tournament?.id || "");
        await addInstitutions(parsed.map(({ name, code, region }) => ({ name, code, region })));
      } else if (activeTab === "teams") {
        const parsed = parseTeamsCsv(csvText, tournament?.id || "");
        const matchedTeams = parsed.map((team) => {
          // Match institution from existing list if possible
          if (team.institutionName) {
            const matchedInst = institutions.find(
              (inst) =>
                inst.name.toLowerCase() === team.institutionName?.toLowerCase() ||
                inst.code.toLowerCase() === team.institutionName?.toLowerCase()
            );
            if (matchedInst) {
              return { ...team, institutionId: matchedInst.id, institutionName: matchedInst.name };
            }
          }
          return team;
        });
        await addTeams(matchedTeams);
      } else {
        const parsed = parseAdjudicatorsCsv(csvText, tournament?.id || "");
        const matchedAdjudicators = parsed.map((adjudicator) => {
          if (adjudicator.institutionName && !adjudicator.independent) {
            const matchedInst = institutions.find(
              (inst) =>
                inst.name.toLowerCase() === adjudicator.institutionName?.toLowerCase() ||
                inst.code.toLowerCase() === adjudicator.institutionName?.toLowerCase()
            );
            if (matchedInst) {
              return {
                ...adjudicator,
                institutionId: matchedInst.id,
                institutionName: matchedInst.name,
                conflicts: [{ institutionId: matchedInst.id, type: "institution" as const }],
              };
            }
          }
          return adjudicator;
        });
        await addAdjudicators(matchedAdjudicators);
      }
      setCsvText("");
      setShowCsvModal(false);
    } catch (error) {
      setCsvImportError(error instanceof Error ? error.message : "Could not import CSV data.");
    } finally {
      setIsImportingCsv(false);
    }
  };

  const handleCsvFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setCsvText(await file.text());
      setCsvImportError("");
    } catch (error) {
      setCsvImportError(error instanceof Error ? error.message : "Could not read the selected CSV file.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            {activeTab === "institutions" ? (
              <Building2 className="w-6 h-6 text-emerald-600" />
            ) : activeTab === "teams" ? (
              <Users className="w-6 h-6 text-blue-600" />
            ) : (
              <Users2 className="w-6 h-6 text-indigo-600" />
            )}
            <span>
              {activeTab === "institutions"
                ? "Institutions"
                : activeTab === "teams"
                ? "Teams"
                : "Adjudicators"}
            </span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {activeTab === "institutions"
              ? "Manage institutions and affiliations used by teams and adjudicators."
              : activeTab === "teams"
              ? "Manage debating teams, speakers, affiliations, and team imports."
              : "Manage adjudicators, affiliations, scores, and adjudicator imports."}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Link
            href={`/${tournamentSlug}/private-urls`}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold border border-gray-300 rounded text-xs shadow-2xs transition"
          >
            <Key className="w-3.5 h-3.5 text-blue-600" />
            <span>Private URLs</span>
          </Link>

          <button
            onClick={() => setShowCsvModal(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold border border-gray-300 rounded text-xs shadow-2xs transition"
          >
            <Upload className="w-3.5 h-3.5 text-gray-500" />
            <span>Import CSV</span>
          </button>

          {activeTab === "institutions" ? (
            <button
              onClick={() => setShowAddInstModal(true)}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-xs shadow-xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Institution</span>
            </button>
          ) : activeTab === "teams" ? (
            <button
              onClick={() => setShowAddTeamModal(true)}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-xs shadow-xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Team</span>
            </button>
          ) : (
            <button
              onClick={() => setShowAddAdjModal(true)}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded text-xs shadow-xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Adjudicator</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#d0d7de] pb-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400" />
          <input
            type="text"
            placeholder={
              activeTab === "institutions"
                ? "Search institutions..."
                : activeTab === "teams"
                ? "Search teams..."
                : "Search judges..."
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 w-60"
          />
        </div>
      </div>

      {/* 1. Teams Table */}
      {activeTab === "teams" && (
        <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left tabby-table">
              <thead>
                <tr>
                  <th className="w-12 text-center">#</th>
                  <th>Team Name</th>
                  <th>Institution</th>
                  <th>Speakers</th>
                  <th>Categories</th>
                  <th className="w-20 text-center">Status</th>
                  <th className="w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeams.map((team, idx) => (
                  <tr key={team.id} className="hover:bg-gray-50">
                    <td className="text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                    <td className="font-bold text-gray-900 text-xs">{team.name}</td>
                    <td>
                      {team.institutionName ? (
                        <span className="inline-flex items-center space-x-1 text-xs text-gray-800 font-medium">
                          <Building2 className="w-3 h-3 text-gray-400" />
                          <span>{team.institutionName}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Independent / Unaffiliated</span>
                      )}
                    </td>
                    <td className="text-xs text-gray-700">
                      {team.speakers?.map((s) => s.name).join(", ") || "—"}
                    </td>
                    <td>
                      {team.speakerCategories?.map((c) => (
                        <span
                          key={c}
                          className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-100 text-blue-800 uppercase mr-1"
                        >
                          {c}
                        </span>
                      ))}
                    </td>
                    <td className="text-center">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase">
                        Checked In
                      </span>
                    </td>
                    <td className="text-right space-x-1">
                      {team.privateUrlKey && (
                        <Link
                          href={`/${tournamentSlug}/private/team/${team.privateUrlKey}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 text-gray-400 hover:text-emerald-600 rounded transition inline-block align-middle"
                          title="Open Team Private Portal"
                        >
                          <Key className="w-3.5 h-3.5" />
                        </Link>
                      )}
                      <button
                        onClick={() => setEditingTeam(team)}
                        className="p-1 text-gray-400 hover:text-blue-600 rounded transition"
                        title="Edit Team"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete team "${team.name}"?`)) deleteTeam(team.id);
                        }}
                        className="p-1 text-gray-400 hover:text-red-600 rounded transition"
                        title="Delete Team"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredTeams.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-xs text-gray-400">
                      No teams registered yet. Click &quot;Add Team&quot; or import via CSV.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. Adjudicators Table */}
      {activeTab === "adjs" && (
        <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left tabby-table">
              <thead>
                <tr>
                  <th className="w-12 text-center">#</th>
                  <th>Judge Name</th>
                  <th>Institution / Affiliation</th>
                  <th className="text-center">Rating</th>
                  <th className="text-center">Role</th>
                  <th className="w-20 text-center">Status</th>
                  <th className="w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAdjs.map((adj, idx) => (
                  <tr key={adj.id} className="hover:bg-gray-50">
                    <td className="text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                    <td className="font-bold text-gray-900 text-xs">{adj.name}</td>
                    <td>
                      {adj.independent || !adj.institutionName ? (
                        <span className="text-[11px] font-semibold bg-gray-100 text-gray-700 px-2 py-0.5 rounded border border-gray-200">
                          Independent / Unaffiliated
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 text-xs text-gray-800 font-medium">
                          <Building2 className="w-3 h-3 text-indigo-500" />
                          <span>{adj.institutionName}</span>
                        </span>
                      )}
                    </td>
                    <td className="text-center font-mono font-bold text-xs bg-gray-50 text-indigo-700">
                      {adj.baseScore?.toFixed(1) || "5.0"}
                    </td>
                    <td className="text-center">
                      {adj.trainee ? (
                        <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded uppercase">
                          Trainee
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded uppercase">
                          Accredited
                        </span>
                      )}
                    </td>
                    <td className="text-center">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase">
                        Active
                      </span>
                    </td>
                    <td className="text-right space-x-1">
                      {adj.privateUrlKey && (
                        <Link
                          href={`/${tournamentSlug}/private/adjudicator/${adj.privateUrlKey}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 text-gray-400 hover:text-blue-600 rounded transition inline-block align-middle"
                          title="Open Adjudicator Private Portal"
                        >
                          <Key className="w-3.5 h-3.5" />
                        </Link>
                      )}
                      <button
                        onClick={() => setEditingAdj(adj)}
                        className="p-1 text-gray-400 hover:text-indigo-600 rounded transition"
                        title="Edit Judge"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete judge "${adj.name}"?`)) deleteAdjudicator(adj.id);
                        }}
                        className="p-1 text-gray-400 hover:text-red-600 rounded transition"
                        title="Delete Judge"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredAdjs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-xs text-gray-400">
                      No adjudicators registered yet. Click &quot;Add Adjudicator&quot; or import via CSV.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Institutions Table */}
      {activeTab === "institutions" && (
        <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left tabby-table">
              <thead>
                <tr>
                  <th className="w-12 text-center">#</th>
                  <th>Institution Name</th>
                  <th>Code / Abbr</th>
                  <th>Region</th>
                  <th className="text-center">Teams Count</th>
                  <th className="text-center">Judges Count</th>
                  <th className="w-24 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInstitutions.map((inst, idx) => (
                  <tr key={inst.id} className="hover:bg-gray-50">
                    <td className="text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                    <td className="font-bold text-gray-900 text-xs flex items-center space-x-1.5 py-2.5">
                      <Building2 className="w-4 h-4 text-emerald-600" />
                      <span>{inst.name}</span>
                    </td>
                    <td className="font-mono text-xs font-semibold text-gray-700">{inst.code}</td>
                    <td className="text-xs text-gray-600">{inst.region || "—"}</td>
                    <td className="text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                        {instTeamCount.get(inst.id) || 0} teams
                      </span>
                    </td>
                    <td className="text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800">
                        {instAdjCount.get(inst.id) || 0} judges
                      </span>
                    </td>
                    <td className="text-right space-x-1">
                      <button
                        onClick={() => setEditingInst(inst)}
                        className="p-1 text-gray-400 hover:text-emerald-600 rounded transition"
                        title="Edit Institution"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete institution "${inst.name}"? This will unlink associated teams and judges.`)) {
                            deleteInstitution(inst.id);
                          }
                        }}
                        className="p-1 text-gray-400 hover:text-red-600 rounded transition"
                        title="Delete Institution"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredInstitutions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-xs text-gray-400">
                      No institutions registered yet. Click &quot;Add Institution&quot; or import via CSV.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Institution Modal */}
      {showAddInstModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Building2 className="w-5 h-5 text-emerald-600" />
              <span>Add New Institution</span>
            </h3>
            <form onSubmit={handleCreateInstitution} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Institution Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Oxford Union Society"
                  value={instName}
                  onChange={(e) => setInstName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Code / Abbr</label>
                  <input
                    type="text"
                    placeholder="e.g. Oxford"
                    value={instCode}
                    onChange={(e) => setInstCode(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Region (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. UK / Europe"
                    value={instRegion}
                    onChange={(e) => setInstRegion(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddInstModal(false)}
                  className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded shadow-xs"
                >
                  Create Institution
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Institution Modal */}
      {editingInst && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Edit2 className="w-5 h-5 text-emerald-600" />
              <span>Edit Institution</span>
            </h3>
            <form onSubmit={handleUpdateInstitution} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Institution Name</label>
                <input
                  type="text"
                  required
                  value={editingInst.name}
                  onChange={(e) => setEditingInst({ ...editingInst, name: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Code / Abbr</label>
                  <input
                    type="text"
                    value={editingInst.code}
                    onChange={(e) => setEditingInst({ ...editingInst, code: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Region</label>
                  <input
                    type="text"
                    value={editingInst.region || ""}
                    onChange={(e) => setEditingInst({ ...editingInst, region: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingInst(null)}
                  className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded shadow-xs"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Team Modal */}
      {showAddTeamModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Plus className="w-5 h-5 text-blue-600" />
              <span>Add New Team</span>
            </h3>
            <form onSubmit={handleCreateTeam} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Team Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Oxford A"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Institution Dropbox & Unaffiliated Checkbox */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-md space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-gray-800">Institution Affiliation</label>
                  <label className="flex items-center space-x-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newTeamUnaffiliated}
                      onChange={(e) => setNewTeamUnaffiliated(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="font-semibold text-gray-700">Unaffiliated / Independent</span>
                  </label>
                </div>

                {!newTeamUnaffiliated ? (
                  <div>
                    <select
                      value={newTeamInstId}
                      onChange={(e) => setNewTeamInstId(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- Select Institution --</option>
                      {institutions.map((inst) => (
                        <option key={inst.id} value={inst.id}>
                          {inst.name} ({inst.code})
                        </option>
                      ))}
                    </select>
                    {institutions.length === 0 && (
                      <p className="text-[11px] text-amber-600 mt-1">
                        No institutions registered yet. Create one in the Institutions tab or import via CSV.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-500 italic">
                    This team is registered as independent with no institutional clash constraints.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Speaker 1</label>
                  <input
                    type="text"
                    placeholder="Name"
                    value={newSpk1}
                    onChange={(e) => setNewSpk1(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                  />
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    value={newSpk1Email}
                    onChange={(e) => setNewSpk1Email(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Speaker 2</label>
                  <input
                    type="text"
                    placeholder="Name"
                    value={newSpk2}
                    onChange={(e) => setNewSpk2(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                  />
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    value={newSpk2Email}
                    onChange={(e) => setNewSpk2Email(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              {!isBP && (
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Speaker 3</label>
                  <input
                    type="text"
                    placeholder="Name"
                    value={newSpk3}
                    onChange={(e) => setNewSpk3(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                  />
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    value={newSpk3Email}
                    onChange={(e) => setNewSpk3Email(e.target.value)}
                    className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Speaker Category (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. ESL or Novice"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddTeamModal(false)}
                  className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs"
                >
                  Add Team
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Team Modal */}
      {editingTeam && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Edit2 className="w-5 h-5 text-blue-600" />
              <span>Edit Team</span>
            </h3>
            <form onSubmit={handleUpdateTeam} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Team Name</label>
                <input
                  type="text"
                  required
                  value={editingTeam.name}
                  onChange={(e) => setEditingTeam({ ...editingTeam, name: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Institution Selection */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-md space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-gray-800">Institution Affiliation</label>
                  <label className="flex items-center space-x-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
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
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <span className="font-semibold text-gray-700">Unaffiliated</span>
                  </label>
                </div>

                {editingTeam.institutionId || editingTeam.institutionName ? (
                  <select
                    value={editingTeam.institutionId || ""}
                    onChange={(e) => {
                      const selected = institutions.find((i) => i.id === e.target.value);
                      setEditingTeam({
                        ...editingTeam,
                        institutionId: selected?.id,
                        institutionName: selected?.name,
                      });
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs bg-white"
                  >
                    <option value="">-- Select Institution --</option>
                    {institutions.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.name} ({inst.code})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[11px] text-gray-500 italic">Independent / Unaffiliated Team</p>
                )}
              </div>

              {/* Speakers editing */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-700">Speakers</label>
                {editingTeam.speakers?.map((spk, idx) => (
                  <div key={spk.id || idx} className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={spk.name}
                      onChange={(e) => {
                        const newSpeakers = [...editingTeam.speakers];
                        newSpeakers[idx] = { ...spk, name: e.target.value };
                        setEditingTeam({ ...editingTeam, speakers: newSpeakers });
                      }}
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                      placeholder={`Speaker ${idx + 1}`}
                    />
                    <input
                      type="email"
                      value={spk.email || ""}
                      onChange={(e) => {
                        const newSpeakers = [...editingTeam.speakers];
                        newSpeakers[idx] = { ...spk, email: e.target.value.trim() || undefined };
                        setEditingTeam({ ...editingTeam, speakers: newSpeakers });
                      }}
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                      placeholder="Email (optional)"
                    />
                  </div>
                ))}
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingTeam(null)}
                  className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Adj Modal */}
      {showAddAdjModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Plus className="w-5 h-5 text-indigo-600" />
              <span>Add Adjudicator</span>
            </h3>
            <form onSubmit={handleCreateAdj} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Judge Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Eleanor Vance"
                  value={newAdjName}
                  onChange={(e) => setNewAdjName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <input
                  type="email"
                  placeholder="Email (optional)"
                  value={newAdjEmail}
                  onChange={(e) => setNewAdjEmail(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Institution Dropbox & Unaffiliated Checkbox */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-md space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-gray-800">Institution Affiliation</label>
                  <label className="flex items-center space-x-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newAdjUnaffiliated}
                      onChange={(e) => setNewAdjUnaffiliated(e.target.checked)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="font-semibold text-gray-700">Unaffiliated / Independent</span>
                  </label>
                </div>

                {!newAdjUnaffiliated ? (
                  <div>
                    <select
                      value={newAdjInstId}
                      onChange={(e) => setNewAdjInstId(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">-- Select Institution --</option>
                      {institutions.map((inst) => (
                        <option key={inst.id} value={inst.id}>
                          {inst.name} ({inst.code})
                        </option>
                      ))}
                    </select>
                    {institutions.length === 0 && (
                      <p className="text-[11px] text-amber-600 mt-1">
                        No institutions registered yet. Create one in the Institutions tab.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-500 italic">
                    This judge is independent and will have no automatic institutional clash restrictions.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Base Rating (1-10)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="10"
                    value={newAdjScore}
                    onChange={(e) => setNewAdjScore(parseFloat(e.target.value) || 5.0)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                </div>
                <div className="flex items-center pt-5">
                  <label className="flex items-center space-x-2 cursor-pointer text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={newAdjTrainee}
                      onChange={(e) => setNewAdjTrainee(e.target.checked)}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                    <span>Trainee Judge</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddAdjModal(false)}
                  className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-xs"
                >
                  Add Adjudicator
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Adj Modal */}
      {editingAdj && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Edit2 className="w-5 h-5 text-indigo-600" />
              <span>Edit Adjudicator</span>
            </h3>
            <form onSubmit={handleUpdateAdj} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Judge Name</label>
                <input
                  type="text"
                  required
                  value={editingAdj.name}
                  onChange={(e) => setEditingAdj({ ...editingAdj, name: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <input
                  type="email"
                  value={editingAdj.email || ""}
                  onChange={(e) =>
                    setEditingAdj({ ...editingAdj, email: e.target.value.trim() || undefined })
                  }
                  placeholder="Email (optional)"
                  className="mt-1 w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Institution Selection */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-md space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-gray-800">Institution Affiliation</label>
                  <label className="flex items-center space-x-1.5 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingAdj.independent}
                      onChange={(e) => {
                        const isIndep = e.target.checked;
                        setEditingAdj({
                          ...editingAdj,
                          independent: isIndep,
                          institutionId: isIndep ? undefined : editingAdj.institutionId || institutions[0]?.id,
                          institutionName: isIndep ? undefined : editingAdj.institutionName || institutions[0]?.name,
                          conflicts: isIndep ? [] : editingAdj.conflicts,
                        });
                      }}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                    <span className="font-semibold text-gray-700">Unaffiliated / Independent</span>
                  </label>
                </div>

                {!editingAdj.independent ? (
                  <select
                    value={editingAdj.institutionId || ""}
                    onChange={(e) => {
                      const selected = institutions.find((i) => i.id === e.target.value);
                      setEditingAdj({
                        ...editingAdj,
                        institutionId: selected?.id,
                        institutionName: selected?.name,
                        independent: !selected,
                        conflicts: selected
                          ? [{ institutionId: selected.id, type: "institution" }]
                          : [],
                      });
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs bg-white"
                  >
                    <option value="">-- Select Institution --</option>
                    {institutions.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.name} ({inst.code})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[11px] text-gray-500 italic">Independent / Unaffiliated Adjudicator</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Base Rating (1-10)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="10"
                    value={editingAdj.baseScore}
                    onChange={(e) => setEditingAdj({ ...editingAdj, baseScore: parseFloat(e.target.value) || 5.0 })}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                  />
                </div>
                <div className="flex items-center pt-5">
                  <label className="flex items-center space-x-2 cursor-pointer text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={editingAdj.trainee}
                      onChange={(e) => setEditingAdj({ ...editingAdj, trainee: e.target.checked })}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                    <span>Trainee Judge</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingAdj(null)}
                  className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-xs"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showCsvModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-lg w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-2 flex items-center space-x-2">
              <Upload className="w-5 h-5 text-blue-600" />
              <span>
                Import{" "}
                {activeTab === "institutions"
                  ? "Institutions"
                  : activeTab === "teams"
                  ? "Teams"
                  : "Adjudicators"}{" "}
                from CSV
              </span>
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              {activeTab === "institutions"
                ? "Upload a Google Sheets .csv file or paste CSV text with columns: name, code, region. Commas in institution names are supported."
                : activeTab === "teams"
                ? "Paste CSV text formatted with columns: name, institution, speaker1, speaker2"
                : "Paste CSV text formatted with columns: name, institution, score, trainee"}
            </p>

            <div className="mb-3">
              <label className="inline-flex cursor-pointer items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-100 border border-gray-300 rounded text-xs font-semibold text-gray-800 shadow-2xs">
                <Upload className="w-3.5 h-3.5 text-blue-600" />
                <span>Choose CSV File</span>
                <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} className="sr-only" />
              </label>
              {csvText && <span className="ml-2 text-xs text-gray-500">CSV loaded</span>}
            </div>

            <textarea
              rows={8}
              placeholder={
                activeTab === "institutions"
                  ? "name,code,region\nOxford Union Society,Oxford,UK\nHarvard Debating Union,Harvard,USA"
                  : activeTab === "teams"
                  ? "name,institution,speaker1,speaker2\nOxford A,Oxford,Jane Doe,John Smith\nCambridge B,Cambridge,Alice,Bob"
                  : "name,institution,score,trainee\nEleanor Vance,Oxford,8.5,false\nDavid Kim,Independent,6.0,true"
              }
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setCsvImportError("");
              }}
              className="w-full border border-gray-300 rounded p-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />

            {csvImportError && <p role="alert" className="text-xs text-red-700 mb-3">{csvImportError}</p>}

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowCsvModal(false);
                  setCsvImportError("");
                }}
                className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCsvImport}
                disabled={!csvText.trim() || isImportingCsv}
                className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs disabled:opacity-50"
              >
                {isImportingCsv ? "Importing..." : "Import CSV Data"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
