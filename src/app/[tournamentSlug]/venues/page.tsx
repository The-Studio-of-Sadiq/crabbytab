"use client";

import React, { useState, useRef } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { parseVenuesCsv } from "@/lib/csv/importer";
import {
  MapPin,
  Plus,
  Trash2,
  Upload,
  CheckCircle2,
  XCircle,
  Search,
  FileSpreadsheet,
  X,
  Pencil,
} from "lucide-react";
import { Venue } from "@/types";

export default function VenuesPage() {
  const { tournament, venues, addVenue, addVenues, updateVenue, deleteVenue } = useTournament();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPriority, setNewPriority] = useState(10);
  const [newCategory, setNewCategory] = useState("");
  const [newCapacity, setNewCapacity] = useState("");
  const [newAccessible, setNewAccessible] = useState(false);
  const [newOnline, setNewOnline] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvPreview, setCsvPreview] = useState<Venue[]>([]);
  const [csvError, setCsvError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredVenues = venues.filter((v) =>
    v.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const venueFields = {
      name: newName.trim(),
      priority: newPriority,
      category: newCategory.trim() || undefined,
      capacity: newCapacity ? Number(newCapacity) : undefined,
      accessible: newAccessible,
      online: newOnline,
    };
    if (editingVenue) {
      await updateVenue({ ...editingVenue, ...venueFields });
    } else {
      await addVenue({ ...venueFields, available: true });
    }

    setNewName("");
    setNewPriority(10);
    setNewCategory("");
    setNewCapacity("");
    setNewAccessible(false);
    setNewOnline(false);
    setEditingVenue(null);
    setShowAddModal(false);
  };

  const openEditVenue = (venue: Venue) => {
    setEditingVenue(venue);
    setNewName(venue.name);
    setNewPriority(venue.priority || 10);
    setNewCategory(venue.category || "");
    setNewCapacity(venue.capacity === undefined ? "" : String(venue.capacity));
    setNewAccessible(venue.accessible === true);
    setNewOnline(venue.online === true);
    setShowAddModal(true);
  };

  const openAddVenue = () => {
    setEditingVenue(null);
    setNewName("");
    setNewPriority(10);
    setNewCategory("");
    setNewCapacity("");
    setNewAccessible(false);
    setNewOnline(false);
    setShowAddModal(true);
  };

  const toggleAvailability = async (venue: Venue) => {
    await updateVenue({ ...venue, available: venue.available === false });
  };

  // ─── CSV Import Handlers ───
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      parseCsvPreview(text);
    };
    reader.readAsText(file);
  };

  const parseCsvPreview = (text: string) => {
    setCsvError("");
    if (!text.trim()) {
      setCsvPreview([]);
      return;
    }
    try {
      const parsed = parseVenuesCsv(text, tournament?.id || "");
      if (parsed.length === 0) {
        setCsvError("No venues found in CSV. Ensure headers include: name, priority, category");
      }
      setCsvPreview(parsed);
    } catch (err: any) {
      setCsvError(err.message || "Failed to parse CSV");
      setCsvPreview([]);
    }
  };

  const handleCsvTextChange = (text: string) => {
    setCsvText(text);
    parseCsvPreview(text);
  };

  const handleCsvImport = async () => {
    if (csvPreview.length === 0) return;
    setIsImporting(true);
    try {
      await addVenues(csvPreview.map(({ available: _available, ...venue }) => ({
        ...venue,
        available: true,
      })));
      setCsvText("");
      setCsvPreview([]);
      setShowCsvModal(false);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <MapPin className="w-6 h-6 text-emerald-600" />
            <span>Debate Venues &amp; Rooms</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Manage physical and online debate rooms, priority weights, and availability status.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowCsvModal(true)}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 font-semibold border border-gray-300 rounded text-xs shadow-2xs transition"
          >
            <Upload className="w-3.5 h-3.5 text-gray-500" />
            <span>Import CSV</span>
          </button>
          <button
            onClick={openAddVenue}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-xs shadow-xs transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Venue</span>
          </button>
        </div>
      </div>

      {/* Venues Table */}
      <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
        <div className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] flex items-center justify-between">
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400" />
            <input
              type="text"
              placeholder="Search venues..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
            />
          </div>
          <span className="text-xs text-gray-500 font-medium">
            {venues.filter((v) => v.available !== false).length} Active of {venues.length} Total
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left tabby-table">
            <thead>
              <tr>
                <th className="w-12 text-center">#</th>
                <th>Venue / Room Name</th>
                <th>Category</th>
                <th className="w-24 text-center">Capacity</th>
                <th className="w-24 text-center">Capabilities</th>
                <th className="w-24 text-center">Priority</th>
                <th className="w-28 text-center">Availability</th>
                <th className="w-20 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredVenues.map((venue, idx) => (
                <tr key={venue.id} className="hover:bg-gray-50">
                  <td className="text-center font-mono text-xs text-gray-500">{idx + 1}</td>
                  <td className="font-bold text-gray-900 text-xs">{venue.name}</td>
                  <td className="text-xs text-gray-500">
                    <input
                      aria-label={`${venue.name} category`}
                      defaultValue={venue.category || ""}
                      placeholder="General"
                      onBlur={(e) => {
                        const category = e.currentTarget.value.trim() || undefined;
                        if (category !== venue.category) void updateVenue({ ...venue, category });
                      }}
                      className="w-full min-w-24 border border-transparent hover:border-gray-300 focus:border-blue-400 rounded px-1 py-0.5 text-xs"
                    />
                  </td>
                  <td className="text-center">
                    <input
                      aria-label={`${venue.name} capacity`}
                      type="number"
                      min="0"
                      defaultValue={venue.capacity ?? ""}
                      placeholder="—"
                      onBlur={(e) => {
                        const value = e.currentTarget.value.trim();
                        const capacity = value ? Number(value) : undefined;
                        if (capacity !== undefined && (!Number.isFinite(capacity) || capacity < 0)) {
                          e.currentTarget.reportValidity();
                          return;
                        }
                        if (capacity !== venue.capacity) void updateVenue({ ...venue, capacity });
                      }}
                      className="w-16 border border-gray-200 rounded px-1 py-0.5 text-center text-xs"
                    />
                  </td>
                  <td className="text-center text-[10px]">
                    <div className="flex flex-col items-start gap-1">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={venue.accessible === true}
                          onChange={(e) => void updateVenue({ ...venue, accessible: e.target.checked })}
                        />
                        Accessible
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={venue.online === true}
                          onChange={(e) => void updateVenue({ ...venue, online: e.target.checked })}
                        />
                        Online
                      </label>
                    </div>
                  </td>
                  <td className="text-center font-mono font-bold text-xs text-blue-600">
                    {venue.priority || 10}
                  </td>
                  <td className="text-center">
                    <button
                      onClick={() => toggleAvailability(venue)}
                      className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase transition ${
                        venue.available !== false
                          ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                          : "bg-red-100 text-red-800 hover:bg-red-200"
                      }`}
                    >
                      {venue.available !== false ? "Available" : "Unavailable"}
                    </button>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => openEditVenue(venue)}
                      className="p-1 text-gray-400 hover:text-blue-600 rounded transition"
                      title={`Edit ${venue.name}`}
                      aria-label={`Edit ${venue.name}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete venue ${venue.name}?`)) deleteVenue(venue.id);
                      }}
                      className="p-1 text-gray-400 hover:text-red-600 rounded transition"
                      title="Delete Venue"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Venue Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center space-x-2">
              <MapPin className="w-5 h-5 text-emerald-600" />
              <span>{editingVenue ? "Edit Venue" : "Add New Venue"}</span>
            </h3>
            <form onSubmit={handleCreateVenue} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Room Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Lecture Theatre 1"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Priority Rank (Higher = Better room used for top bracket debates)
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={newPriority}
                  onChange={(e) => setNewPriority(parseInt(e.target.value, 10))}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Category (e.g. Accessible, Online, Main Hall)
                </label>
                <input
                  type="text"
                  placeholder="General"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Capacity (seats)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="No capacity limit"
                  value={newCapacity}
                  onChange={(e) => setNewCapacity(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-xs"
                />
              </div>

              <div className="flex gap-4 text-xs">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={newAccessible} onChange={(e) => setNewAccessible(e.target.checked)} />
                  Accessible
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={newOnline} onChange={(e) => setNewOnline(e.target.checked)} />
                  Online-capable
                </label>
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
                  {editingVenue ? "Save Changes" : "Add Room"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showCsvModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white text-gray-900 rounded-lg shadow-xl max-w-2xl w-full p-6 border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900 flex items-center space-x-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <span>Import Venues from CSV</span>
              </h3>
              <button
                onClick={() => {
                  setShowCsvModal(false);
                  setCsvText("");
                  setCsvPreview([]);
                  setCsvError("");
                }}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              {/* File picker */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Upload CSV File
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.tsv"
                  onChange={handleFileUpload}
                  className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 border border-gray-300 rounded cursor-pointer"
                />
              </div>

              <div className="text-xs text-gray-400 text-center">— or paste CSV text —</div>

              {/* Paste area */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  CSV Content
                </label>
                <textarea
                  rows={6}
                  placeholder={`name,priority,category,capacity,accessible,online\nLecture Theatre 1,20,Main,200,yes,no\nSeminar Room A,10,General,30,no,no\nOnline Room 1,5,Online,50,yes,yes`}
                  value={csvText}
                  onChange={(e) => handleCsvTextChange(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                />
              </div>

              {/* CSV format help */}
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <p className="text-[11px] font-semibold text-gray-700 mb-1">Expected CSV Columns:</p>
                <ul className="text-[10px] text-gray-500 space-y-0.5">
                  <li><strong>name</strong> (required) — Venue/room name. Aliases: Name, room, Room, venue, Venue</li>
                  <li><strong>priority</strong> — Priority weight (1-100, default 10). Higher = more important room</li>
                  <li><strong>category</strong> — Category label (e.g. Main, Online, Accessible)</li>
                  <li><strong>capacity</strong> — Maximum seating capacity</li>
                  <li><strong>accessible</strong> — Whether the venue is accessible (yes/no)</li>
                  <li><strong>online</strong> — Whether the venue supports online debates (yes/no)</li>
                </ul>
              </div>

              {/* Error */}
              {csvError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center space-x-2">
                  <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{csvError}</span>
                </div>
              )}

              {/* Preview */}
              {csvPreview.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center space-x-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Preview: {csvPreview.length} venues found</span>
                  </p>
                  <div className="overflow-x-auto max-h-48 overflow-y-auto border border-gray-200 rounded">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-1.5 text-[10px] font-bold text-gray-600 uppercase">#</th>
                          <th className="px-3 py-1.5 text-[10px] font-bold text-gray-600 uppercase">Name</th>
                          <th className="px-3 py-1.5 text-[10px] font-bold text-gray-600 uppercase">Priority</th>
                          <th className="px-3 py-1.5 text-[10px] font-bold text-gray-600 uppercase">Category</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {csvPreview.map((v, idx) => (
                          <tr key={idx} className="text-xs hover:bg-gray-50">
                            <td className="px-3 py-1 font-mono text-gray-400">{idx + 1}</td>
                            <td className="px-3 py-1 font-semibold text-gray-900">{v.name}</td>
                            <td className="px-3 py-1 font-mono text-blue-600">{v.priority}</td>
                            <td className="px-3 py-1 text-gray-500">{v.category || "General"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end space-x-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowCsvModal(false);
                    setCsvText("");
                    setCsvPreview([]);
                    setCsvError("");
                  }}
                  className="px-4 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCsvImport}
                  disabled={csvPreview.length === 0 || isImporting}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded shadow-xs disabled:opacity-50 transition inline-flex items-center space-x-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{isImporting ? "Importing..." : `Import ${csvPreview.length} Venues`}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
