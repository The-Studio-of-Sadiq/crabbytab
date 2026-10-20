"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/Button";
import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { describeRoundStatus } from "@/components/layout/roundStatus";
import {
  Award,
  BarChart3,
  Building2,
  CheckCircle2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock,
  ExternalLink,
  Eye,
  FileCheck2,
  History,
  Key,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  Mail,
  MapPin,
  MessageSquareHeart,
  Monitor,
  Shield,
  Shuffle,
  ShieldAlert,
  Sliders,
  Tags,
  Trophy,
  UserCheck,
  Users,
  Users2,
  X,
} from "lucide-react";

type IconType = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function useIsActive(href: string, exact = false) {
  const pathname = usePathname();
  return exact ? pathname === href : pathname === href || Boolean(pathname?.startsWith(`${href}/`));
}

function NavLink({
  href,
  icon: Icon,
  label,
  badge,
  exact,
  external,
  nested,
}: {
  href: string;
  icon: IconType;
  label: string;
  badge?: React.ReactNode;
  exact?: boolean;
  external?: boolean;
  nested?: boolean;
}) {
  const isActive = useIsActive(href, exact);
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
        nested && "h-7 pl-3",
        isActive ? "bg-muted font-medium text-fg" : "text-fg-muted hover:bg-muted/70 hover:text-fg",
        focusRing,
        "focus-visible:ring-offset-0"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-fg" : "text-fg-subtle")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {external && <ExternalLink className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden />}
      {external && <span className="sr-only">(opens in a new tab)</span>}
      {badge}
    </Link>
  );
}

function NavGroup({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  const headingId = `nav-group-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div role="group" aria-labelledby={headingId} className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-3">
        <h2 id={headingId} className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </div>
  );
}

function NavDisclosure({
  label,
  icon: Icon,
  active,
  defaultOpen,
  children,
}: {
  label: string;
  icon: IconType;
  active: boolean;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = open || active;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
        className={cn(
          "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors",
          active ? "font-medium text-fg" : "text-fg-muted hover:bg-muted/70 hover:text-fg",
          focusRing,
          "focus-visible:ring-offset-0"
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-fg" : "text-fg-subtle")} aria-hidden />
        <span className="flex-1">{label}</span>
        <ChevronRight className={cn("h-3.5 w-3.5 text-fg-subtle transition-transform", isOpen && "rotate-90")} aria-hidden />
      </button>
      {isOpen && <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-1">{children}</div>}
    </div>
  );
}

/** The grouped navigation shared by the desktop sidebar and the mobile drawer. */
function SidebarNav({ tournamentSlug }: { tournamentSlug: string }) {
  const pathname = usePathname();
  const { tournament, activeRound, debates, ballots, isOwnerOrAdmin, isDataEntryAssistant } = useTournament();
  const base = `/${tournamentSlug}`;
  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;
  const isConfigPage = pathname?.startsWith(`${base}/config/`) ?? false;

  const roundDebates = activeRound ? debates.filter((debate) => debate.roundId === activeRound.id) : [];
  const confirmedBallots = activeRound
    ? ballots.filter((ballot) => ballot.roundId === activeRound.id && ballot.confirmed)
    : [];
  const completedDebates = confirmedBallots.length + roundDebates.filter((debate) => debate.byeTeamId).length;
  const roundComplete = roundDebates.length > 0 && completedDebates === roundDebates.length;
  const roundStatus = activeRound ? describeRoundStatus(activeRound) : null;

  return (
    <nav aria-label="Tournament" className="px-2 pb-4">
      <div className="space-y-0.5 pt-2">
        <NavLink href={base} icon={LayoutDashboard} label="Overview" exact />
      </div>

      <NavGroup title="Setup">
        <NavLink href={`${base}/imports/institutions`} icon={Building2} label="Institutions" />
        <NavLink href={`${base}/imports/teams`} icon={Users2} label="Teams" />
        <NavLink href={`${base}/imports/adjudicators`} icon={UserCheck} label="Adjudicators" />
        <NavLink href={`${base}/imports/diversity`} icon={Users} label="Diversity" />
        {isOwnerOrAdmin && <NavLink href={`${base}/registration`} icon={ClipboardList} label="Registration" />}
        {!isDataEntryAssistant && (
          <>
            <NavLink href={`${base}/imports/speaker-categories`} icon={Tags} label="Speaker categories" />
            <NavLink href={`${base}/imports/conflicts`} icon={ShieldAlert} label="Conflicts" />
            <NavLink href={`${base}/imports/venues`} icon={MapPin} label="Venues" />
            <NavLink href={`${base}/imports/motions`} icon={Lightbulb} label="Motions" />
            <NavLink href={`${base}/schedule`} icon={CalendarDays} label="Schedule" />
          </>
        )}
      </NavGroup>

      <NavGroup
        title={activeRound ? `Round · ${activeRound.abbreviation || `R${activeRound.seq}`}` : "Rounds"}
        aside={roundStatus && <span className="truncate text-[11px] text-fg-subtle">{roundStatus.short}</span>}
      >
        {activeRound ? (
          <>
            <NavLink href={`${base}/checkins`} icon={Clock} label="Availability" />
            {isOwnerOrAdmin && (
              <>
                <NavLink
                  href={`${base}/draw`}
                  icon={Shuffle}
                  label="Draw"
                  badge={
                    roundDebates.length > 0 ? (
                      <Badge title={`${roundDebates.length} debates`}>
                        {roundDebates.length}
                        <span className="sr-only"> debates</span>
                      </Badge>
                    ) : undefined
                  }
                />
                <NavLink href={`${base}/allocation`} icon={Users2} label="Allocation" />
              </>
            )}
            <NavLink href={`${base}/display`} icon={Monitor} label="Display" />
          </>
        ) : (
          <p className="px-2 py-1 text-xs text-fg-muted">
            {isOwnerOrAdmin ? "Create a round from the round menu in the top bar." : "No round is active yet."}
          </p>
        )}
      </NavGroup>

      <NavGroup title="Results">
        <NavLink
          href={`${base}/results`}
          icon={FileCheck2}
          label="Results"
          badge={
            roundDebates.length > 0 ? (
              <Badge tone={roundComplete ? "success" : "neutral"} title={`${completedDebates} of ${roundDebates.length} results complete`}>
                {roundComplete && <CheckCircle2 className="h-3 w-3" aria-hidden />}
                {completedDebates}/{roundDebates.length}
                <span className="sr-only"> results complete</span>
              </Badge>
            ) : undefined
          }
        />
        {feedbackEnabled && <NavLink href={`${base}/feedback`} icon={MessageSquareHeart} label="Feedback" />}
        <NavLink href={`${base}/standings`} icon={Trophy} label="Standings" />
        <NavLink href={`${base}/break`} icon={Award} label="Break" />
        <NavLink href={`${base}/analytics`} icon={BarChart3} label="Analytics" />
      </NavGroup>

      <NavGroup title="Public">
        <NavLink href={`${base}/public`} icon={Eye} label="Public tab" external />
        {isOwnerOrAdmin && <NavLink href={`${base}/private-urls`} icon={Key} label="Private URLs" />}
        {isOwnerOrAdmin && <NavLink href={`${base}/email`} icon={Mail} label="Email" />}
      </NavGroup>

      {isOwnerOrAdmin && (
        <NavGroup title="Admin">
          <NavDisclosure label="Configuration" icon={Sliders} active={isConfigPage} defaultOpen={false}>
            <NavLink nested href={`${base}/config/draw`} icon={Shuffle} label="Draw rules" />
            <NavLink nested href={`${base}/config/rounds`} icon={Clock} label="Round settings" />
            <NavLink nested href={`${base}/config/format`} icon={Shield} label="Format & teams" />
            <NavLink nested href={`${base}/config/scoring`} icon={FileCheck2} label="Scoring & ballots" />
            <NavLink nested href={`${base}/config/standings`} icon={Trophy} label="Standings rules" />
            <NavLink nested href={`${base}/config/visibility`} icon={Eye} label="Public visibility" />
          </NavDisclosure>
          <NavLink href={`${base}/imports/assistants`} icon={Shield} label="Assistants" />
          <NavLink href={`${base}/audit`} icon={History} label="Audit log" />
          <NavLink href={`${base}/api`} icon={KeyRound} label="API access" />
        </NavGroup>
      )}
    </nav>
  );
}

/**
 * Desktop: a fixed-width column under the top bar.
 * Below `lg`: a modal drawer opened from the top bar's menu button.
 */
export function Sidebar({
  tournamentSlug,
  mobileOpen,
  onMobileClose,
}: {
  tournamentSlug: string;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(drawerRef, { active: mobileOpen, onEscape: onMobileClose });

  return (
    <>
      <aside
        aria-label="Tournament navigation"
        className="sticky top-topbar hidden h-[calc(100vh-var(--topbar-height))] w-sidebar shrink-0 overflow-y-auto border-r border-border bg-background lg:block"
      >
        <SidebarNav tournamentSlug={tournamentSlug} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-overlay/50" aria-hidden="true" onClick={onMobileClose} />
          <div
            ref={drawerRef}
            id="tournament-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Tournament navigation"
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col border-r border-border bg-background shadow-lg focus:outline-none"
          >
            <div className="flex h-topbar shrink-0 items-center justify-between border-b border-border px-3">
              <span className="text-[13px] font-semibold text-fg">Navigation</span>
              <IconButton label="Close navigation" icon={<X />} size="sm" onClick={onMobileClose} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SidebarNav tournamentSlug={tournamentSlug} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
