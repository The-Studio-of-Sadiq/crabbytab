"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import {
  LayoutDashboard,
  Shuffle,
  Users2,
  FileCheck2,
  Trophy,
  Award,
  Lightbulb,
  UserCheck,
  MapPin,
  MessageSquareHeart,
  BarChart3,
  Sliders,
  Clock,
  Monitor,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

function NavLink({
  href,
  icon: Icon,
  label,
  badge,
  badgeColor,
  exact,
  nested,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: string;
  badgeColor?: string;
  exact?: boolean;
  nested?: boolean;
}) {
  const pathname = usePathname();
  const isActive = exact
    ? pathname === href
    : pathname === href || Boolean(pathname?.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      className={`flex items-center justify-between text-xs font-medium rounded-md transition ${
        nested ? "px-3 py-1.5" : "px-3 py-2"
      } ${
        isActive
          ? "bg-blue-50 text-blue-700 font-semibold"
          : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      <div className="flex items-center space-x-2.5">
        <Icon className={`w-4 h-4 ${isActive ? "text-blue-600" : "text-gray-500"}`} />
        <span>{label}</span>
      </div>
      {badge && (
        <span className={`text-[10px] font-semibold px-1.5 rounded ${badgeColor || "bg-gray-200 text-gray-700"}`}>
          {badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({ tournamentSlug }: { tournamentSlug: string }) {
  const { activeRound, rounds, setActiveRound, debates, ballots, teams } = useTournament();
  const [openRounds, setOpenRounds] = useState<Record<string, boolean>>({});

  const expandedRoundId = useMemo(() => {
    if (activeRound?.id) return activeRound.id;
    return rounds[0]?.id;
  }, [activeRound, rounds]);

  const isRoundOpen = (id: string) => openRounds[id] ?? id === expandedRoundId;

  return (
    <aside className="w-64 bg-[#f6f8fa] border-r border-[#d0d7de] flex flex-col shrink-0 min-h-[calc(100vh-3.5rem)] select-none">
      <div className="p-3 border-b border-[#d0d7de] bg-white">
        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
          Current round
        </div>
        <div className="flex items-center justify-between">
          <span className="font-bold text-gray-900 text-sm">
            {activeRound ? activeRound.name : "No round active"}
          </span>
          {activeRound && (
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase ${
                activeRound.drawStatus === "confirmed"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : activeRound.drawStatus === "draft"
                  ? "bg-amber-100 text-amber-800 border border-amber-300"
                  : "bg-gray-100 text-gray-600 border border-gray-300"
              }`}
            >
              {activeRound.drawStatus === "confirmed"
                ? "Released"
                : activeRound.drawStatus === "draft"
                ? "Draft"
                : "None"}
            </span>
          )}
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-4 overflow-y-auto">
        <div className="space-y-0.5">
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Tournament
          </div>
          <NavLink
            href={`/${tournamentSlug}`}
            icon={LayoutDashboard}
            label="Overview"
            exact
          />
          <NavLink href={`/${tournamentSlug}/feedback`} icon={MessageSquareHeart} label="Feedback" />
          <NavLink href={`/${tournamentSlug}/standings`} icon={Trophy} label="Standings" />
          <NavLink href={`/${tournamentSlug}/break`} icon={Award} label="Break" />
          <NavLink href={`/${tournamentSlug}/analytics`} icon={BarChart3} label="Analytics" />
        </div>

        <div className="space-y-1">
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Rounds
          </div>
          {rounds.length === 0 && (
            <p className="px-3 text-[11px] text-gray-500">Create a round from the top bar.</p>
          )}
          {rounds.map((round) => {
            const open = isRoundOpen(round.id);
            const isCurrent = activeRound?.id === round.id;
            const rDebates = debates.filter((d) => d.roundId === round.id);
            const rBallots = ballots.filter((b) => b.roundId === round.id && b.confirmed);
            return (
              <div key={round.id} className="rounded-md">
                <button
                  type="button"
                  onClick={() => {
                    setActiveRound(round);
                    setOpenRounds((prev) => ({ ...prev, [round.id]: !open }));
                  }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-xs font-semibold rounded-md ${
                    isCurrent ? "bg-gray-200 text-gray-900" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  <span className="flex items-center space-x-1.5">
                    {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span>{round.abbreviation || `R${round.seq}`}</span>
                  </span>
                  <span className="text-[10px] font-medium text-gray-500">
                    {rBallots.length}/{rDebates.length || 0}
                  </span>
                </button>
                {open && (
                  <div className="ml-2 mt-0.5 space-y-0.5 border-l border-gray-200 pl-1">
                    <NavLink
                      nested
                      href={`/${tournamentSlug}/checkins`}
                      icon={Clock}
                      label="Availability"
                    />
                    <NavLink
                      nested
                      href={`/${tournamentSlug}/draw`}
                      icon={Shuffle}
                      label="Draw"
                      badge={rDebates.length > 0 ? `${rDebates.length}` : undefined}
                    />
                    <NavLink nested href={`/${tournamentSlug}/allocation`} icon={Users2} label="Allocation" />
                    <NavLink nested href={`/${tournamentSlug}/display`} icon={Monitor} label="Display" />
                    <NavLink nested href={`/${tournamentSlug}/motions`} icon={Lightbulb} label="Motions" />
                    <NavLink
                      nested
                      href={`/${tournamentSlug}/results`}
                      icon={FileCheck2}
                      label="Results"
                      badge={rDebates.length > 0 ? `${rBallots.length}/${rDebates.length}` : undefined}
                      badgeColor={
                        rBallots.length === rDebates.length && rDebates.length > 0
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-0.5">
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Setup
          </div>
          <NavLink
            href={`/${tournamentSlug}/participants`}
            icon={UserCheck}
            label="Participants"
            badge={`${teams.length} teams`}
          />
          <NavLink href={`/${tournamentSlug}/venues`} icon={MapPin} label="Venues" />
          <NavLink href={`/${tournamentSlug}/config`} icon={Sliders} label="Configuration" />
        </div>
      </nav>

      <div className="p-3 border-t border-[#d0d7de] bg-white text-[11px] text-gray-500 flex items-center justify-between">
        <span>Host-side pairing</span>
        <span className="flex items-center space-x-1 text-emerald-600 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>Local compute</span>
        </span>
      </div>
    </aside>
  );
}
