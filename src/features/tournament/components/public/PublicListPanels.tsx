import React from "react";

import { SideBadge } from "@/components/ui/SideBadge";
import type { PublicAdjudicatorLists, PublicInstitutionRow, PublicParticipants } from "@/lib/publicLists";
import type { MotionStatistic } from "@/lib/motionStatistics";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
      <h2 className="p-3 bg-[#f6f8fa] border-b border-[#d0d7de] font-bold text-xs text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-xs text-gray-500">{children}</p>;
}

export function ParticipantsPanel({ participants }: { participants: PublicParticipants }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title={`Teams (${participants.teams.length})`}>
        {participants.teams.length === 0 ? (
          <Empty>No teams are registered yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left tabby-table">
              <thead>
                <tr>
                  <th scope="col">Team</th>
                  <th scope="col">Institution</th>
                  <th scope="col">Speakers</th>
                </tr>
              </thead>
              <tbody>
                {participants.teams.map((team) => (
                  <tr key={team.id}>
                    <td className="text-xs font-bold text-gray-900">{team.name}</td>
                    <td className="text-xs text-gray-600">{team.institutionName || "—"}</td>
                    <td className="text-xs text-gray-700">{team.speakers.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title={`Adjudicators (${participants.adjudicators.length})`}>
        {participants.adjudicators.length === 0 ? (
          <Empty>No adjudicators are registered yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left tabby-table">
              <thead>
                <tr>
                  <th scope="col">Adjudicator</th>
                  <th scope="col">Institution</th>
                </tr>
              </thead>
              <tbody>
                {participants.adjudicators.map((adjudicator) => (
                  <tr key={adjudicator.id}>
                    <td className="text-xs font-bold text-gray-900">{adjudicator.name}</td>
                    <td className="text-xs text-gray-600">{adjudicator.institutionName || "Independent"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

export function InstitutionsPanel({ institutions }: { institutions: PublicInstitutionRow[] }) {
  const showCounts = institutions.some((row) => row.teams !== undefined);
  const showRegions = institutions.some((row) => row.region);
  return (
    <Panel title={`Institutions (${institutions.length})`}>
      {institutions.length === 0 ? (
        <Empty>No institutions are registered yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left tabby-table">
            <thead>
              <tr>
                <th scope="col">Institution</th>
                <th scope="col">Code</th>
                {showRegions && <th scope="col">Region</th>}
                {showCounts && <th scope="col" className="text-right">Teams</th>}
                {showCounts && <th scope="col" className="text-right">Adjudicators</th>}
              </tr>
            </thead>
            <tbody>
              {institutions.map((row) => (
                <tr key={row.id}>
                  <td className="text-xs font-bold text-gray-900">{row.name}</td>
                  <td className="text-xs font-mono text-gray-600">{row.code}</td>
                  {showRegions && <td className="text-xs text-gray-600">{row.region || "—"}</td>}
                  {showCounts && <td className="text-right text-xs font-mono">{row.teams}</td>}
                  {showCounts && <td className="text-right text-xs font-mono">{row.adjudicators}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AdjudicatorList({ title, rows, empty }: { title: string; rows: PublicAdjudicatorLists["core"]; empty: string }) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
              <span className="font-bold text-gray-900">{row.name}</span>
              <span className="text-gray-600">{row.institutionName || "Independent"}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function AdjudicatorListsPanel({
  lists,
  showCore,
  showBreaking,
}: {
  lists: PublicAdjudicatorLists;
  showCore: boolean;
  showBreaking: boolean;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {showCore && (
        <AdjudicatorList title="Adjudication core" rows={lists.core} empty="The adjudication core has not been announced." />
      )}
      {showBreaking && (
        <AdjudicatorList
          title="Breaking adjudicators"
          rows={lists.breaking}
          empty="No breaking adjudicators have been announced."
        />
      )}
    </div>
  );
}

function formatAverage(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

/** Side results for one motion; only rendered from released (public) ballots. */
export function MotionStatisticsSummary({ statistic, isBP }: { statistic: MotionStatistic; isBP: boolean }) {
  if (statistic.debatesCounted === 0) return null;
  const { balance } = statistic;
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-[11px] font-bold uppercase text-gray-500">
        Results from {statistic.debatesCounted} released debate{statistic.debatesCounted === 1 ? "" : "s"}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {statistic.positions.map((position) => (
          <div key={position.side} className="rounded border border-gray-200 bg-gray-50 p-2">
            <dt>
              <SideBadge side={position.side} />
            </dt>
            <dd className="mt-1 text-xs text-gray-800">
              <span className="font-mono font-bold">{position.wins}</span> {isBP ? "first" : "win"}
              {position.wins === 1 ? "" : "s"}
              {isBP && (
                <span className="block text-[11px] text-gray-500">
                  Avg points <span className="font-mono">{formatAverage(position.averagePoints)}</span>
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {balance.pValue !== null && (
        <p className="mt-2 text-[11px] text-gray-500">
          Side balance: χ² = {balance.chiSquared?.toFixed(2)}, p = {balance.pValue.toFixed(3)}
          {balance.lowExpectedCount ? " (too few debates for a reliable test)" : ""}
        </p>
      )}
    </div>
  );
}
