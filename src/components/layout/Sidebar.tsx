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
  Shield,
  Eye,
  Key,
  Mail,
  History,
  Menu,
  X,
  Building2,
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

function SidebarDropdown({
  label,
  icon: Icon,
  isActive,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between rounded-md">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className={`flex-1 flex items-center justify-between text-xs font-medium rounded-md px-3 py-2 transition ${
            isActive
              ? "bg-blue-50 text-blue-700 font-semibold"
              : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          }`}
        >
          <div className="flex items-center space-x-2.5">
            <Icon className={`w-4 h-4 ${isActive ? "text-blue-600" : "text-gray-500"}`} />
            <span>{label}</span>
          </div>
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isOpen && (
        <div className="ml-3 pl-2.5 border-l border-gray-200 space-y-0.5 pt-0.5">
          {children}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ tournamentSlug }: { tournamentSlug: string }) {
  const pathname = usePathname();
  const {
    tournament,
    activeRound,
    rounds,
    setActiveRound,
    debates,
    ballots,
    isOwnerOrAdmin,
    isDataEntryAssistant,
  } = useTournament();
  const [openRounds, setOpenRounds] = useState<Record<string, boolean>>({});
  const [importsOpen, setImportsOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;

  const expandedRoundId = useMemo(() => {
    if (activeRound?.id) return activeRound.id;
    return rounds[0]?.id;
  }, [activeRound, rounds]);

  const isRoundOpen = (id: string) => openRounds[id] ?? id === expandedRoundId;
  const isImportsPage = pathname?.startsWith(`/${tournamentSlug}/imports/`) ?? false;
  const isConfigPage = pathname?.startsWith(`/${tournamentSlug}/config/`) ?? false;
  const isInfoPage = ["/standings", "/break", "/analytics", "/audit"].some((path) =>
    pathname?.startsWith(`/${tournamentSlug}${path}`)
  );

  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (isImportsPage) setImportsOpen(true);
    if (isConfigPage) setConfigOpen(true);
    if (isInfoPage) setInfoOpen(true);
  }, [isImportsPage, isConfigPage, isInfoPage]);

  return (
    <aside className="w-64 bg-[#f6f8fa] border-r border-[#d0d7de] flex flex-col shrink-0 min-h-[calc(100vh-3.5rem)] select-none max-md:w-full max-md:min-h-0 max-md:border-r-0 max-md:border-b">
      <div className="hidden max-md:flex items-center justify-between gap-3 px-4 py-2 bg-white">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Current round</p>
          <p className="text-xs font-bold text-gray-900 truncate">
            {activeRound ? activeRound.name : "No round active"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen((open) => !open)}
          aria-expanded={mobileNavOpen}
          aria-controls="tournament-navigation"
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
        >
          {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          {mobileNavOpen ? "Close menu" : "Menu"}
        </button>
      </div>
      <div className="p-3 border-b border-[#d0d7de] bg-white max-md:hidden">
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

      <nav
        id="tournament-navigation"
        className={`flex-1 px-2 py-3 space-y-4 overflow-y-auto max-md:flex-none max-md:max-h-[65vh] ${
          mobileNavOpen ? "max-md:block" : "max-md:hidden"
        }`}
      >
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
          {feedbackEnabled && (
            <NavLink href={`/${tournamentSlug}/feedback`} icon={MessageSquareHeart} label="Feedback" />
          )}
        </div>

        <div className="space-y-0.5">
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Setup
          </div>
          <SidebarDropdown
            label="Imports"
            icon={UserCheck}
            isActive={isImportsPage}
            isOpen={importsOpen}
            onToggle={() => setImportsOpen((open) => !open)}
          >
            <NavLink nested href={`/${tournamentSlug}/imports/institutions`} icon={Building2} label="Institutions" />
            <NavLink nested href={`/${tournamentSlug}/imports/teams`} icon={Users2} label="Teams" />
            <NavLink nested href={`/${tournamentSlug}/imports/adjudicators`} icon={UserCheck} label="Adjudicators" />
            {!isDataEntryAssistant && (
              <>
                <NavLink nested href={`/${tournamentSlug}/imports/venues`} icon={MapPin} label="Venues" />
                <NavLink nested href={`/${tournamentSlug}/imports/motions`} icon={Lightbulb} label="Motions" />
              </>
            )}
          </SidebarDropdown>
          {isOwnerOrAdmin && (
            <>
              <NavLink href={`/${tournamentSlug}/private-urls`} icon={Key} label="Private URLs" />
              <NavLink href={`/${tournamentSlug}/staff`} icon={Shield} label="Manage Staff" />
            </>
          )}
          {isOwnerOrAdmin && (
            <NavLink href={`/${tournamentSlug}/email`} icon={Mail} label="Email" />
          )}
          {isOwnerOrAdmin && (
            <SidebarDropdown
              label="Configuration"
              icon={Sliders}
              isActive={isConfigPage}
              isOpen={configOpen}
              onToggle={() => setConfigOpen((open) => !open)}
            >
              <NavLink nested href={`/${tournamentSlug}/config/draw`} icon={Shuffle} label="Draw rules" />
              <NavLink nested href={`/${tournamentSlug}/config/rounds`} icon={Clock} label="Round settings" />
              <NavLink nested href={`/${tournamentSlug}/config/format`} icon={Shield} label="Format & Teams" />
              <NavLink nested href={`/${tournamentSlug}/config/scoring`} icon={FileCheck2} label="Scoring & Ballots" />
              <NavLink nested href={`/${tournamentSlug}/config/standings`} icon={Trophy} label="Standings rules" />
              <NavLink nested href={`/${tournamentSlug}/config/visibility`} icon={Eye} label="Public visibility" />
            </SidebarDropdown>
          )}
        </div>

        <div className="space-y-0.5">
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Information
          </div>
          <SidebarDropdown
            label="Info"
            icon={FileCheck2}
            isActive={isInfoPage}
            isOpen={infoOpen}
            onToggle={() => setInfoOpen((open) => !open)}
          >
            <NavLink nested href={`/${tournamentSlug}/standings`} icon={Trophy} label="Standings" />
            <NavLink nested href={`/${tournamentSlug}/break`} icon={Award} label="Break" />
            <NavLink nested href={`/${tournamentSlug}/analytics`} icon={BarChart3} label="Analytics" />
            {isOwnerOrAdmin && <NavLink nested href={`/${tournamentSlug}/audit`} icon={History} label="Audit log" />}
          </SidebarDropdown>
        </div>

        <div className="space-y-1">
          <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Rounds
          </div>
          {rounds.length === 0 && isOwnerOrAdmin && (
            <p className="px-3 text-[11px] text-gray-500">Create a round from the top bar.</p>
          )}
          {rounds.map((round) => {
            const open = isRoundOpen(round.id);
            const isCurrent = activeRound?.id === round.id;
            const rDebates = debates.filter((d) => d.roundId === round.id);
            const rBallots = ballots.filter((b) => b.roundId === round.id && b.confirmed);
            const completedDebates = rBallots.length + rDebates.filter((debate) => debate.byeTeamId).length;
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
                    {completedDebates}/{rDebates.length || 0}
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
                    {isOwnerOrAdmin && (
                      <>
                        <NavLink
                          nested
                          href={`/${tournamentSlug}/draw`}
                          icon={Shuffle}
                          label="Draw"
                          badge={rDebates.length > 0 ? `${rDebates.length}` : undefined}
                        />
                        <NavLink nested href={`/${tournamentSlug}/allocation`} icon={Users2} label="Allocation" />
                      </>
                    )}
                    <NavLink nested href={`/${tournamentSlug}/display`} icon={Monitor} label="Display" />
                    <NavLink
                      nested
                      href={`/${tournamentSlug}/results`}
                      icon={FileCheck2}
                      label="Results"
                      badge={rDebates.length > 0 ? `${completedDebates}/${rDebates.length}` : undefined}
                      badgeColor={
                        completedDebates === rDebates.length && rDebates.length > 0
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
      </nav>

      <div className="p-3 border-t border-[#d0d7de] bg-white text-[11px] text-gray-500 flex items-center justify-between max-md:hidden">
        <span>Host-side pairing</span>
        <span className="flex items-center space-x-1 text-emerald-600 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span>Local compute</span>
        </span>
      </div>
    </aside>
  );
}
