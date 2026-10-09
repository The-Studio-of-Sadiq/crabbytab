import { Building2, GripVertical, Search, X } from "lucide-react";
import type { DragEvent } from "react";
import type { Adjudicator } from "@/types";
import { effectiveAdjScore } from "@/lib/draw/allocator";

export interface JudgeDragPayload {
  type: "judge";
  sourceType: "available" | "chair" | "panellist" | "trainee";
  adjId: string;
  adjName: string;
  sourceDebateId?: string;
}

interface AvailableAdjudicatorsPanelProps {
  adjudicators: Adjudicator[];
  availableCount: number;
  feedbackScores: Map<string, number>;
  selectedAdjudicator: Adjudicator | null;
  searchQuery: string;
  dragOverTarget: string | null;
  onSearchChange(value: string): void;
  onClearSelection(): void;
  onSelect(adjudicator: Adjudicator): void;
  onDragStart(event: DragEvent<HTMLDivElement>, payload: JudgeDragPayload): void;
  onDragEnd(): void;
  onDragOver(event: DragEvent<HTMLDivElement>, target: string): void;
  onDragLeave(event: DragEvent<HTMLDivElement>, target: string): void;
  onDrop(event: DragEvent<HTMLDivElement>): void;
}

export function AvailableAdjudicatorsPanel({
  adjudicators,
  availableCount,
  feedbackScores,
  selectedAdjudicator,
  searchQuery,
  dragOverTarget,
  onSearchChange,
  onClearSelection,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: AvailableAdjudicatorsPanelProps) {
  return (
    <div className="lg:col-span-4 space-y-4">
      <div
        onDragOver={(event) => onDragOver(event, "available-drawer")}
        onDragLeave={(event) => onDragLeave(event, "available-drawer")}
        onDrop={onDrop}
        className={`bg-white border rounded-lg p-4 shadow-xs transition ${
          dragOverTarget === "available-drawer"
            ? "border-amber-500 bg-amber-50/50 border-dashed ring-2 ring-amber-300"
            : "border-[#d0d7de]"
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-1.5">
            <span>Available Adjudicators</span>
            <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-0.2 rounded-full font-bold">
              {availableCount}
            </span>
          </h3>
          <span className="text-[11px] text-gray-500">(Drag into rooms)</span>
        </div>

        <div className="relative mb-3">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder="Filter judges or institution..."
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {selectedAdjudicator && (
          <div className="mb-3 p-2.5 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-900 flex items-center justify-between">
            <div>
              <span className="font-bold">Selected: </span>
              <span>{selectedAdjudicator.name}</span>
              <span className="text-[10px] text-indigo-700 block">Click on any room to assign as Chair or Panellist</span>
            </div>
            <button
              onClick={onClearSelection}
              className="p-1 hover:bg-indigo-100 rounded text-indigo-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          {adjudicators.map((adjudicator) => {
            const selected = selectedAdjudicator?.id === adjudicator.id;
            const score = effectiveAdjScore(adjudicator, feedbackScores);

            return (
              <div
                key={adjudicator.id}
                draggable
                onDragEnd={onDragEnd}
                onDragStart={(event) =>
                  onDragStart(event, {
                    type: "judge",
                    sourceType: "available",
                    adjId: adjudicator.id,
                    adjName: adjudicator.name,
                  })
                }
                onClick={() => onSelect(adjudicator)}
                className={`p-2.5 rounded-lg border text-xs cursor-grab active:cursor-grabbing transition flex items-center justify-between ${
                  selected
                    ? "bg-indigo-50 border-indigo-500 shadow-xs ring-1 ring-indigo-400"
                    : "bg-gray-50/70 border-gray-200 hover:border-indigo-300 hover:bg-white"
                }`}
              >
                <div className="flex items-center space-x-2">
                  <GripVertical className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <div>
                    <div className="font-bold text-gray-900 flex items-center space-x-1.5">
                      <span>{adjudicator.name}</span>
                      {adjudicator.trainee && (
                        <span className="bg-amber-100 text-amber-800 text-[9px] px-1.5 py-0.2 rounded font-semibold uppercase">
                          Trainee
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 flex items-center space-x-1">
                      <Building2 className="w-3 h-3 text-gray-400" />
                      <span>{adjudicator.institutionName || "Independent / Unaffiliated"}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                    score >= 7 ? "bg-emerald-100 text-emerald-800" :
                    score >= 4 ? "bg-blue-100 text-blue-800" :
                    "bg-gray-200 text-gray-800"
                  }`}>
                    {score.toFixed(1)}
                  </span>
                </div>
              </div>
            );
          })}
          {adjudicators.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">
              No available adjudicators matching query.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}