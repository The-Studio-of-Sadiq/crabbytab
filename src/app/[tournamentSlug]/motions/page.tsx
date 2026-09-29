"use client";

import React, { useState, useMemo, useRef } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { parseMotionsCsv } from "@/lib/csv/importer";
import {
  Lightbulb,
  Plus,
  Upload,
  Edit2,
  Trash2,
  CheckCircle2,
  Lock,
  Search,
  FileText,
  X,
  Sparkles,
  HelpCircle,
  FileSpreadsheet,
} from "lucide-react";
import { Motion } from "@/types";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";

export default function MotionsPage() {
  const { tournament, motions, rounds, addMotion, updateMotion, deleteMotion } = useTournament();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterRoundId, setFilterRoundId] = useState("");

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMotion, setEditingMotion] = useState<Motion | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // New Motion Form State
  const [newText, setNewText] = useState("");
  const [newInfoSlide, setNewInfoSlide] = useState("");
  const [newRef, setNewRef] = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [motionPendingRelease, setMotionPendingRelease] = useState<Motion | null>(null);
  const [isSavingRelease, setIsSavingRelease] = useState(false);
  const [releaseError, setReleaseError] = useState("");

  const filteredMotions = useMemo(() => {
    return motions.filter((m) => {
      const matchesSearch =
        m.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.reference || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.infoSlide || "").toLowerCase().includes(searchQuery.toLowerCase());

      const matchesRound = !filterRoundId || (m.rounds && m.rounds.includes(filterRoundId));

      return matchesSearch && matchesRound;
    });
  }, [motions, searchQuery, filterRoundId]);

  // Create Motion (Private by default)
  const handleCreateMotion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    await addMotion({
      text: newText.trim(),
      infoSlide: newInfoSlide.trim() || undefined,
      reference: newRef.trim() || `Motion ${motions.length + 1}`,
      rounds: selectedRoundId ? [selectedRoundId] : [],
      released: false, // Don't make them public by default!
      seq: motions.length + 1,
    });

    setNewText("");
    setNewInfoSlide("");
    setNewRef("");
    setSelectedRoundId("");
    setShowAddModal(false);
  };

  // Update Motion
  const handleUpdateMotion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMotion || !editingMotion.text.trim()) return;

    await updateMotion(editingMotion);
    setEditingMotion(null);
  };

  // Toggle Release
  const toggleMotionRelease = async (motion: Motion) => {
    setMotionPendingRelease(motion);
    setReleaseError("");
  };

  const confirmMotionRelease = async () => {
    if (!motionPendingRelease) return;
    setIsSavingRelease(true);
    setReleaseError("");
    try {
      await updateMotion({ ...motionPendingRelease, released: !motionPendingRelease.released });
      setMotionPendingRelease(null);
    } catch {
      setReleaseError("The motion visibility change could not be saved. Please try again.");
    } finally {
      setIsSavingRelease(false);
    }
  };

  // CSV File Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setCsvText(content);
      }
    };
    reader.readAsText(file);
  };

  // CSV Import Process
  const handleCsvImport = async () => {
    if (!csvText.trim()) return;

    const parsedMotions = parseMotionsCsv(csvText, tournament?.id || "", rounds);
    for (const m of parsedMotions) {
      // Ensure released is explicitly false
      await addMotion({
        text: m.text,
        infoSlide: m.infoSlide,
        reference: m.reference,
        rounds: m.rounds,
        released: false, // Private by default
        seq: motions.length + 1,
      });
    }

    setCsvText("");
    setSelectedFileName("");
    setShowCsvModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <Lightbulb className="w-6 h-6 text-amber-500" />
            <span>Tournament Motions</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Manage debate motions, information slides, CSV batch imports, and per-round public release.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowCsvModal(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold border border-gray-300 rounded text-xs shadow-2xs transition"
          >
            <Upload className="w-3.5 h-3.5 text-gray-500" />
            <span>Upload CSV</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-xs shadow-xs transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Motion</span>
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <select
            value={filterRoundId}
            onChange={(e) => setFilterRoundId(e.target.value)}
            className="bg-white border border-gray-300 rounded px-2.5 py-1.5 text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Rounds</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search motions or topic tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
          />
        </div>
      </div>

      {/* Motions List */}
      <div className="space-y-4">
        {filteredMotions.map((motion, idx) => {
          const assignedRound = rounds.find((r) => motion.rounds && motion.rounds.includes(r.id));

          return (
            <div
              key={motion.id}
              className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-2xs hover:border-blue-400 transition"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-300">
                    {motion.reference || `Motion ${idx + 1}`}
                  </span>
                  {assignedRound ? (
                    <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                      Allocated to: {assignedRound.name}
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-400 italic">Unassigned round</span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  {/* Public Release Toggle Button */}
                  <button
                    onClick={() => toggleMotionRelease(motion)}
                    className={`inline-flex items-center space-x-1 text-xs font-semibold px-2.5 py-1 rounded border transition ${
                      motion.released
                        ? "bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100"
                        : "bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200"
                    }`}
                  >
                    {motion.released ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Released to Public</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5 text-gray-500" />
                        <span>Release Motion to Public</span>
                      </>
                    )}
                  </button>

                  {/* Edit Motion Button */}
                  <button
                    onClick={() => setEditingMotion(motion)}
                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-gray-100 rounded transition"
                    title="Edit Motion Info"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Delete Motion Button */}
                  <button
                    onClick={() => {
                      if (confirm(`Delete motion "${motion.reference || motion.text.substring(0, 30)}..."?`)) {
                        deleteMotion(motion.id);
                      }
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 rounded transition"
                    title="Delete Motion"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Motion Text */}
              <blockquote className="text-base font-bold text-gray-900 my-3 pl-3 border-l-4 border-amber-500">
                &ldquo;{motion.text}&rdquo;
              </blockquote>

              {/* Info Slide if present */}
              {motion.infoSlide && (
                <div className="mt-3 p-3 bg-amber-50/60 border border-amber-200 rounded text-xs text-amber-900">
                  <strong className="block font-bold mb-0.5 uppercase tracking-wide text-[10px] text-amber-800">
                    Infoslide / Context
                  </strong>
                  <p className="whitespace-pre-line">{motion.infoSlide}</p>
                </div>
              )}
            </div>
          );
        })}

        {filteredMotions.length === 0 && (
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-10 text-center">
            <Lightbulb className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <h3 className="text-base font-bold text-gray-800 mb-1">No Motions Found</h3>
            <p className="text-xs text-gray-500 max-w-md mx-auto mb-4">
              Add debate motions manually or upload a CSV file with round assignments and info slides.
            </p>
            <div className="flex justify-center items-center gap-2">
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-xs transition"
              >
                <Plus className="w-4 h-4" />
                <span>Add Motion</span>
              </button>
              <button
                onClick={() => setShowCsvModal(true)}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 rounded text-xs font-bold shadow-xs transition"
              >
                <Upload className="w-4 h-4 text-gray-500" />
                <span>Upload CSV</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {releaseError && <p role="alert" className="text-xs text-red-700">{releaseError}</p>}

      {/* Add Motion Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-lg w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Lightbulb className="w-5 h-5 text-amber-500" />
              <span>Create Debate Motion</span>
            </h3>
            <form onSubmit={handleCreateMotion} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Motion Reference / Topic Tag
                </label>
                <input
                  type="text"
                  placeholder="e.g. Round 1: International Relations"
                  value={newRef}
                  onChange={(e) => setNewRef(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Motion Text</label>
                <textarea
                  rows={3}
                  required
                  placeholder="This House would..."
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Infoslide (Optional context notes)
                </label>
                <textarea
                  rows={2}
                  placeholder="Infoslide details..."
                  value={newInfoSlide}
                  onChange={(e) => setNewInfoSlide(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Assign to Round (Optional)</label>
                <select
                  value={selectedRoundId}
                  onChange={(e) => setSelectedRoundId(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs bg-white"
                >
                  <option value="">-- No specific round --</option>
                  {rounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-2.5 bg-gray-50 border border-gray-200 rounded text-[11px] text-gray-600 flex items-center space-x-2">
                <Lock className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span>Motions remain <strong>private</strong> by default until manually released before round start.</span>
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs"
                >
                  Save Motion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Motion Modal */}
      {editingMotion && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-lg w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <Edit2 className="w-5 h-5 text-blue-600" />
              <span>Edit Motion Info</span>
            </h3>
            <form onSubmit={handleUpdateMotion} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Motion Reference / Topic Tag
                </label>
                <input
                  type="text"
                  value={editingMotion.reference || ""}
                  onChange={(e) => setEditingMotion({ ...editingMotion, reference: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Motion Text</label>
                <textarea
                  rows={3}
                  required
                  value={editingMotion.text}
                  onChange={(e) => setEditingMotion({ ...editingMotion, text: e.target.value })}
                  className="w-full border border-gray-300 rounded p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Infoslide (Optional context notes)
                </label>
                <textarea
                  rows={3}
                  value={editingMotion.infoSlide || ""}
                  onChange={(e) => setEditingMotion({ ...editingMotion, infoSlide: e.target.value })}
                  className="w-full border border-gray-300 rounded p-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Assign to Round</label>
                <select
                  value={editingMotion.rounds?.[0] || ""}
                  onChange={(e) => {
                    const rId = e.target.value;
                    setEditingMotion({
                      ...editingMotion,
                      rounds: rId ? [rId] : [],
                    });
                  }}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs bg-white"
                >
                  <option value="">-- No specific round --</option>
                  {rounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingMotion(null)}
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

      {/* CSV Upload / Import Modal */}
      {showCsvModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-lg w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-2 flex items-center space-x-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              <span>Import Motions from CSV</span>
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Upload a <code>.csv</code> file or paste CSV text with columns: <code>text, reference, infoslide, round</code>.
            </p>

            {/* File Upload Selector */}
            <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-100 border border-gray-300 rounded text-xs font-semibold text-gray-800 shadow-2xs"
                >
                  <Upload className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Choose CSV File</span>
                </button>
                <span className="text-xs text-gray-600 truncate max-w-[200px]">
                  {selectedFileName || "No file chosen"}
                </span>
              </div>
            </div>

            {/* Direct Text Area */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Or paste CSV text directly:
              </label>
              <textarea
                rows={6}
                placeholder={"text,reference,infoslide,round\n\"This House would ban algorithmic feeds.\",\"R1: Tech\",\"Chronological feeds only.\",\"Round 1\"\n\"This House regrets the glorification of work ethic.\",\"R2: Culture\",\"\",\"Round 2\""}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="w-full border border-gray-300 rounded p-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              />
            </div>

            <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-[11px] text-emerald-800 mb-4">
              All imported motions will remain <strong>private (unreleased)</strong> by default.
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowCsvModal(false);
                  setCsvText("");
                  setSelectedFileName("");
                }}
                className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCsvImport}
                disabled={!csvText.trim()}
                className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded shadow-xs disabled:opacity-50"
              >
                Import Motions
              </button>
            </div>
          </div>
        </div>
      )}
      {motionPendingRelease && (
        <ConfirmActionDialog
          title={motionPendingRelease.released ? "Unpublish this motion?" : "Publish this motion?"}
          description={motionPendingRelease.released
            ? `Unpublishing ${motionPendingRelease.reference || "this motion"} immediately removes it from the public motions page and presentation.`
            : `Publishing ${motionPendingRelease.reference || "this motion"} makes it visible on the public motions page and presentation.`}
          confirmLabel={motionPendingRelease.released ? "Yes, unpublish motion" : "Yes, publish motion"}
          onConfirm={confirmMotionRelease}
          onCancel={() => setMotionPendingRelease(null)}
          isBusy={isSavingRelease}
          error={releaseError}
        />
      )}
    </div>
  );
}
