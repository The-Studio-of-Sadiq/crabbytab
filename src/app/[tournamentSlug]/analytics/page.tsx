"use client";

import React, { useMemo } from "react";
import { useTournament } from "@/contexts/TournamentContext";
import { SideBadge } from "@/components/ui/SideBadge";
import {
  BarChart3,
  TrendingUp,
  PieChart,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Shield,
} from "lucide-react";
import { DebateSide } from "@/types";
import { analyzeMotionBalance } from "@/lib/motionBalance";

export default function AnalyticsPage() {
  const {
    tournament,
    rounds,
    debates,
    ballots,
    motions,
    teamStandings,
    speakerStandings,
    adjudicators,
  } = useTournament();

  const isBP = tournament?.format === "bp";
  const confirmedBallots = ballots.filter((b) => b.confirmed && !b.discarded);

  // 1. Speaker Score Distribution (Bins from 65 to 85)
  const scoreBins = useMemo(() => {
    const bins: Record<number, number> = {};
    for (let s = 68; s <= 84; s++) bins[s] = 0;

    confirmedBallots.forEach((b) => {
      Object.values(b.speakerScores || {}).forEach((scoreList) => {
        scoreList.forEach((spk) => {
          const rounded = Math.round(spk.score);
          if (bins[rounded] !== undefined) {
            bins[rounded]++;
          }
        });
      });
    });

    const maxCount = Math.max(1, ...Object.values(bins));
    return { bins, maxCount };
  }, [confirmedBallots]);

  // 2. Side Win / Points Balance Analysis
  const sideStats = useMemo(() => {
    const sides: DebateSide[] = isBP ? ["OG", "OO", "CG", "CO"] : ["AFF", "NEG"];
    const stats: Record<string, { totalPoints: number; totalWins: number; count: number }> = {};

    sides.forEach((s) => {
      stats[s] = { totalPoints: 0, totalWins: 0, count: 0 };
    });

    confirmedBallots.forEach((b) => {
      sides.forEach((s) => {
        const teamScore = b.teamScores?.[s];
        if (teamScore) {
          stats[s].totalPoints += teamScore.points || 0;
          if (teamScore.win || (isBP && teamScore.points === 3)) {
            stats[s].totalWins++;
          }
          stats[s].count++;
        }
      });
    });

    return stats;
  }, [confirmedBallots, isBP]);

  // 3. Motion Statistics
  const motionStats = useMemo(() => {
    return motions.map((m) => {
      const motionDebates = debates.filter((d) => d.motionId === m.id);
      const mBallots = confirmedBallots.filter((b) => b.motionId === m.id);

      const ogWins = mBallots.filter((b) => b.teamScores?.OG?.points === 3).length;
      const ooWins = mBallots.filter((b) => b.teamScores?.OO?.points === 3).length;
      const cgWins = mBallots.filter((b) => b.teamScores?.CG?.points === 3).length;
      const coWins = mBallots.filter((b) => b.teamScores?.CO?.points === 3).length;

      const affWins = mBallots.filter((b) => b.teamScores?.AFF?.win).length;
      const negWins = mBallots.filter((b) => b.teamScores?.NEG?.win).length;
      const positionWins = isBP
        ? [ogWins, ooWins, cgWins, coWins]
        : [affWins, negWins];

      return {
        motion: m,
        totalDebates: motionDebates.length,
        completedBallots: mBallots.length,
        ogWins,
        ooWins,
        cgWins,
        coWins,
        affWins,
        negWins,
        balance: analyzeMotionBalance(positionWins),
      };
    });
  }, [motions, debates, confirmedBallots, isBP]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="border-b border-[#d0d7de] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center space-x-2">
            <BarChart3 className="w-6 h-6 text-blue-600" />
            <span>Tournament Analytics & Progression</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Real-time analytics for ballot velocity, speaker score distributions, and motion balance.
          </p>
        </div>
      </div>

      {/* 1. Round-by-Round Progression Tracker */}
      <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs">
        <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center space-x-2">
          <TrendingUp className="w-4 h-4 text-blue-600" />
          <span>Round Progression & Ballot Completion Velocity</span>
        </h3>

        <div className="space-y-4">
          {rounds.map((round) => {
            const rDebates = debates.filter((d) => d.roundId === round.id);
            const rConfirmed = rDebates.filter((d) =>
              d.byeTeamId || confirmedBallots.some((b) => b.debateId === d.id)
            ).length;
            const pct = rDebates.length > 0 ? Math.round((rConfirmed / rDebates.length) * 100) : 0;

            return (
              <div key={round.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-gray-900">{round.name}</span>
                    <span className="text-gray-500 font-mono">
                      ({rConfirmed} / {rDebates.length} results)
                    </span>
                  </div>
                  <span className="font-mono font-bold text-gray-700">{pct}%</span>
                </div>
                <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      pct === 100 ? "bg-emerald-500" : pct > 0 ? "bg-blue-600" : "bg-gray-300"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Speaker Score Distribution Histogram */}
      <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
            <BarChart3 className="w-4 h-4 text-indigo-600" />
            <span>Speaker Score Distribution (Bell Curve)</span>
          </h3>
          <span className="text-xs text-gray-500 font-medium">
            Sample size: {confirmedBallots.length * (isBP ? 8 : 6)} speeches
          </span>
        </div>

        <div className="pt-4 pb-2">
          <div className="h-44 flex items-end justify-between gap-1 sm:gap-2 px-2 border-b border-gray-200">
            {Object.entries(scoreBins.bins).map(([scoreStr, count]) => {
              const heightPct = Math.round((count / scoreBins.maxCount) * 100);

              return (
                <div key={scoreStr} className="flex-1 flex flex-col items-center group relative">
                  <div
                    className="w-full bg-indigo-500 hover:bg-indigo-600 rounded-t transition-all"
                    style={{ height: `${Math.max(4, heightPct)}%` }}
                  />
                  <span className="text-[10px] font-mono text-gray-500 mt-2">{scoreStr}</span>

                  {/* Tooltip */}
                  <div className="absolute -top-7 bg-gray-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition pointer-events-none">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. Side Balance & Win Rates */}
      <div className="bg-white border border-[#d0d7de] rounded-lg p-5 shadow-xs">
        <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center space-x-2">
          <PieChart className="w-4 h-4 text-emerald-600" />
          <span>Side Balance & Win Rate Statistics</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(sideStats).map(([sideKey, data]) => {
            const avgPts = data.count > 0 ? (data.totalPoints / data.count).toFixed(2) : "0.00";
            const winPct = data.count > 0 ? Math.round((data.totalWins / data.count) * 100) : 0;

            return (
              <div
                key={sideKey}
                className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex flex-col justify-between"
              >
                <div>
                  <SideBadge side={sideKey as DebateSide} />
                  <div className="mt-3">
                    <div className="text-2xl font-bold font-mono text-gray-900">{avgPts}</div>
                    <span className="text-[11px] text-gray-500 font-semibold">Average Points / Debate</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-200 flex items-center justify-between text-xs">
                  <span className="text-gray-600">1st Place / Wins:</span>
                  <span className="font-bold text-emerald-700 font-mono">
                    {data.totalWins} ({winPct}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Motion Statistics Table */}
      <div className="bg-white border border-[#d0d7de] rounded-lg shadow-xs overflow-hidden">
        <div className="p-4 bg-[#f6f8fa] border-b border-[#d0d7de]">
          <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            <span>Motion Balance Analysis</span>
          </h3>
          <p className="mt-1 text-xs text-gray-600">
            Chi-squared compares observed wins with an equal-win expectation across positions; it does not establish cause.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left tabby-table">
            <thead>
              <tr>
                <th>Motion</th>
                <th className="w-24 text-center">Debates</th>
                {isBP ? (
                  <>
                    <th className="w-20 text-center text-rose-700 font-bold">OG Wins</th>
                    <th className="w-20 text-center text-sky-700 font-bold">OO Wins</th>
                    <th className="w-20 text-center text-amber-700 font-bold">CG Wins</th>
                    <th className="w-20 text-center text-purple-700 font-bold">CO Wins</th>
                  </>
                ) : (
                  <>
                    <th className="w-24 text-center text-emerald-700 font-bold">AFF Wins</th>
                    <th className="w-24 text-center text-slate-700 font-bold">NEG Wins</th>
                  </>
                )}
                <th className="w-32 text-center">Chi-squared (p)</th>
              </tr>
            </thead>
            <tbody>
              {motionStats.map((ms) => (
                <tr key={ms.motion.id} className="hover:bg-gray-50">
                  <td className="text-xs font-bold text-gray-900">
                    <span className="text-amber-700 block font-semibold text-[11px] mb-0.5">
                      {ms.motion.reference}
                    </span>
                    &ldquo;{ms.motion.text}&rdquo;
                  </td>
                  <td className="text-center font-mono text-xs text-gray-700">{ms.completedBallots}</td>
                  {isBP ? (
                    <>
                      <td className="text-center font-mono text-xs font-bold text-rose-700">
                        {ms.ogWins}
                      </td>
                      <td className="text-center font-mono text-xs font-bold text-sky-700">
                        {ms.ooWins}
                      </td>
                      <td className="text-center font-mono text-xs font-bold text-amber-700">
                        {ms.cgWins}
                      </td>
                      <td className="text-center font-mono text-xs font-bold text-purple-700">
                        {ms.coWins}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="text-center font-mono text-xs font-bold text-emerald-700">
                        {ms.affWins}
                      </td>
                      <td className="text-center font-mono text-xs font-bold text-slate-700">
                        {ms.negWins}
                      </td>
                    </>
                  )}
                  <td className="text-center text-xs">
                    {ms.balance.chiSquared === null || ms.balance.pValue === null ? (
                      <span className="text-gray-500">Insufficient data</span>
                    ) : (
                      <>
                        <span className="block font-mono font-semibold text-gray-800">
                          {ms.balance.chiSquared.toFixed(2)} (p={ms.balance.pValue.toFixed(3)})
                        </span>
                        <span className="text-[10px] text-gray-500">
                          n={ms.balance.observations}, df={ms.balance.degreesOfFreedom}
                        </span>
                        {ms.balance.lowExpectedCount && (
                          <span className="block text-[10px] text-amber-700">Low expected count</span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
