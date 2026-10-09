import { GripVertical, Layers } from "lucide-react";
import type { DragEvent } from "react";
import type { DebateSide, Team } from "@/types";

export interface TeamDragPayload {
  type: "team";
  sourceType: "debate" | "unassigned";
  debateId?: string;
  side?: DebateSide;
  teamId: string;
  teamName: string;
  institutionId?: string;
  institutionName?: string;
}

interface UnassignedTeamsPoolProps {
  teams: Team[];
  expanded: boolean;
  dragOverTarget: string | null;
  onToggle: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, target: string) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>, target: string) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, payload: TeamDragPayload) => void;
}

export function UnassignedTeamsPool({
  teams,
  expanded,
  dragOverTarget,
  onToggle,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
}: UnassignedTeamsPoolProps) {
  return (
    <div
      onDragOver={(event) => onDragOver(event, "unassigned-pool")}
      onDragLeave={(event) => onDragLeave(event, "unassigned-pool")}
      onDrop={onDrop}
      className={`p-3 rounded-lg border transition ${
        dragOverTarget === "unassigned-pool"
          ? "bg-amber-50 border-amber-500 border-dashed ring-2 ring-amber-300"
          : "bg-slate-50 border-slate-200"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-bold text-gray-800 uppercase tracking-wide flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            <span>Unassigned Teams Pool ({teams.length})</span>
          </span>
          <span className="text-[11px] text-gray-500">
            (Drag teams to/from rooms below to re-pair manually)
          </span>
        </div>
        <button
          onClick={onToggle}
          className="text-xs text-blue-600 hover:underline font-semibold"
        >
          {expanded ? "Hide" : "Show"}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-wrap gap-2 pt-1">
          {teams.map((team) => (
            <div
              key={team.id}
              draggable
              onDragStart={(event) =>
                onDragStart(event, {
                  type: "team",
                  sourceType: "unassigned",
                  teamId: team.id,
                  teamName: team.name,
                  institutionId: team.institutionId,
                  institutionName: team.institutionName,
                })
              }
              className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-white border border-gray-300 rounded shadow-2xs hover:border-blue-500 hover:shadow-xs cursor-grab active:cursor-grabbing text-xs text-gray-900 transition"
            >
              <GripVertical className="w-3 h-3 text-gray-400" />
              <span className="font-bold">{team.name}</span>
              {team.institutionName && (
                <span className="text-[10px] text-gray-500">({team.institutionName})</span>
              )}
            </div>
          ))}

          {teams.length === 0 && (
            <span className="text-xs text-gray-400 italic">
              All eligible teams are currently allocated to debate rooms.
            </span>
          )}
        </div>
      )}
    </div>
  );
}