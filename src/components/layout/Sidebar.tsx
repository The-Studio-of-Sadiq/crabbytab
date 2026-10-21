"use client";

import React, { useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/Button";
import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { describeRoundStatus } from "@/components/layout/roundStatus";
import { useI18n } from "@/components/i18n/I18nProvider";
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
  FileDown,
  FlaskConical,
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
  Scale,
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
  const { t } = useI18n();
  const isActive = useIsActive(href, exact);
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
        nested && "h-7 ps-3",
        isActive ? "bg-muted font-medium text-fg" : "text-fg-muted hover:bg-muted/70 hover:text-fg",
        focusRing,
        "focus-visible:ring-offset-0"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-fg" : "text-fg-subtle")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {external && <ExternalLink className="h-3 w-3 shrink-0 text-fg-subtle" aria-hidden />}
      {external && <span className="sr-only">{t("setup.shell.opensInNewTab")}</span>}
      {badge}
    </Link>
  );
}

function NavGroup({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  const headingId = useId();
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
          "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-start text-[13px] transition-colors",
          active ? "font-medium text-fg" : "text-fg-muted hover:bg-muted/70 hover:text-fg",
          focusRing,
          "focus-visible:ring-offset-0"
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-fg" : "text-fg-subtle")} aria-hidden />
        <span className="flex-1">{label}</span>
        <ChevronRight className={cn("h-3.5 w-3.5 text-fg-subtle transition-transform", isOpen ? "rotate-90" : "rtl:-scale-x-100")} aria-hidden />
      </button>
      {isOpen && <div className="ms-4 mt-0.5 space-y-0.5 border-s border-border ps-1">{children}</div>}
    </div>
  );
}

/** The grouped navigation shared by the desktop sidebar and the mobile drawer. */
function SidebarNav({ tournamentSlug }: { tournamentSlug: string }) {
  const pathname = usePathname();
  const { t, plural } = useI18n();
  const { tournament, activeRound, debates, ballots, isOwnerOrAdmin, isDataEntryAssistant, staffPermissions } = useTournament();
  // Data-entry staff see only what their permissions cover (docs/staff-access.md); the server
  // refuses the rest anyway.
  const staffMay = (permission: string) => !isDataEntryAssistant || staffPermissions.includes(permission);
  const base = `/${tournamentSlug}`;
  const feedbackEnabled = tournament?.preferences?.feedbackEnabled !== false;
  const isConfigPage = pathname?.startsWith(`${base}/config/`) ?? false;

  const roundDebates = activeRound ? debates.filter((debate) => debate.roundId === activeRound.id) : [];
  const confirmedBallots = activeRound
    ? ballots.filter((ballot) => ballot.roundId === activeRound.id && ballot.confirmed)
    : [];
  const completedDebates = confirmedBallots.length + roundDebates.filter((debate) => debate.byeTeamId).length;
  const roundComplete = roundDebates.length > 0 && completedDebates === roundDebates.length;
  const roundStatus = activeRound ? describeRoundStatus(activeRound, t) : null;

  return (
    <nav aria-label={t("setup.shell.navLabel")} className="px-2 pb-4">
      <div className="space-y-0.5 pt-2">
        <NavLink href={base} icon={LayoutDashboard} label={t("setup.shell.navOverview")} exact />
      </div>

      <NavGroup title={t("setup.shell.groupSetup")}>
        <NavLink href={`${base}/imports/institutions`} icon={Building2} label={t("setup.shell.navInstitutions")} />
        <NavLink href={`${base}/imports/teams`} icon={Users2} label={t("setup.shell.navTeams")} />
        <NavLink href={`${base}/imports/adjudicators`} icon={UserCheck} label={t("setup.shell.navAdjudicators")} />
        <NavLink href={`${base}/imports/diversity`} icon={Users} label={t("setup.shell.navDiversity")} />
        {isOwnerOrAdmin && <NavLink href={`${base}/registration`} icon={ClipboardList} label={t("setup.shell.navRegistration")} />}
        {staffMay("conflicts.view") && (
          <NavLink href={`${base}/imports/conflicts`} icon={ShieldAlert} label={t("setup.shell.navConflicts")} />
        )}
        {/* Tabbycat's assistant interface has the code-name decoder too. */}
        <NavLink href={`${base}/imports/code-names`} icon={Tags} label={t("setup.shell.navCodeNames")} />
        {!isDataEntryAssistant && (
          <>
            <NavLink href={`${base}/imports/speaker-categories`} icon={Tags} label={t("setup.shell.navSpeakerCategories")} />
            <NavLink href={`${base}/imports/adjudicator-requirements`} icon={Scale} label={t("setup.shell.navAdjRequirement")} />
            <NavLink href={`${base}/imports/venues`} icon={MapPin} label={t("setup.shell.navVenues")} />
            <NavLink href={`${base}/imports/venue-constraints`} icon={MapPin} label={t("setup.shell.navRoomPreferences")} />
            <NavLink href={`${base}/imports/motions`} icon={Lightbulb} label={t("setup.shell.navMotions")} />
            <NavLink href={`${base}/schedule`} icon={CalendarDays} label={t("setup.shell.navSchedule")} />
          </>
        )}
      </NavGroup>

      <NavGroup
        title={activeRound ? t("setup.shell.groupRound", { round: activeRound.abbreviation || `R${activeRound.seq}` }) : t("setup.shell.groupRounds")}
        aside={roundStatus && <span className="truncate text-[11px] text-fg-subtle">{roundStatus.short}</span>}
      >
        {activeRound ? (
          <>
            {staffMay("checkins.edit") && <NavLink href={`${base}/checkins`} icon={Clock} label={t("setup.shell.navAvailability")} />}
            {isOwnerOrAdmin && (
              <>
                <NavLink
                  href={`${base}/draw`}
                  icon={Shuffle}
                  label={t("setup.shell.navDraw")}
                  badge={
                    roundDebates.length > 0 ? (
                      <Badge title={plural("setup.shell.debateCount", roundDebates.length)}>
                        <span aria-hidden="true">{roundDebates.length}</span>
                        <span className="sr-only">{plural("setup.shell.debateCount", roundDebates.length)}</span>
                      </Badge>
                    ) : undefined
                  }
                />
              </>
            )}
            {staffMay("allocation.edit") && (
              <NavLink href={`${base}/allocation`} icon={Users2} label={t("setup.shell.navAllocation")} />
            )}
            {staffMay("draw.display") && <NavLink href={`${base}/display`} icon={Monitor} label={t("setup.shell.navDisplay")} />}
          </>
        ) : (
          <p className="px-2 py-1 text-xs text-fg-muted">
            {isOwnerOrAdmin ? t("setup.shell.noRoundAdmin") : t("setup.shell.noRoundStaff")}
          </p>
        )}
      </NavGroup>

      <NavGroup title={t("setup.shell.groupResults")}>
        <NavLink
          href={`${base}/results`}
          icon={FileCheck2}
          label={t("setup.shell.navResults")}
          badge={
            roundDebates.length > 0 ? (
              <Badge
                tone={roundComplete ? "success" : "neutral"}
                title={t("setup.shell.resultsComplete", { done: completedDebates, total: roundDebates.length })}
              >
                {roundComplete && <CheckCircle2 className="h-3 w-3" aria-hidden />}
                <span aria-hidden="true">{completedDebates}/{roundDebates.length}</span>
                <span className="sr-only">
                  {t("setup.shell.resultsComplete", { done: completedDebates, total: roundDebates.length })}
                </span>
              </Badge>
            ) : undefined
          }
        />
        {feedbackEnabled && (staffMay("feedback.enter") || staffMay("feedback.view")) && <NavLink href={`${base}/feedback`} icon={MessageSquareHeart} label={t("setup.shell.navFeedback")} />}
        {staffMay("standings.view") && (
          <>
            <NavLink href={`${base}/standings`} icon={Trophy} label={t("setup.shell.navStandings")} />
            <NavLink href={`${base}/break`} icon={Award} label={t("setup.shell.navBreak")} />
            <NavLink href={`${base}/analytics`} icon={BarChart3} label={t("setup.shell.navAnalytics")} />
          </>
        )}
      </NavGroup>

      <NavGroup title={t("setup.shell.groupPublic")}>
        <NavLink href={`${base}/public`} icon={Eye} label={t("setup.shell.navPublicTab")} external />
        {isOwnerOrAdmin && <NavLink href={`${base}/private-urls`} icon={Key} label={t("setup.shell.navPrivateUrls")} />}
        {isOwnerOrAdmin && <NavLink href={`${base}/email`} icon={Mail} label={t("setup.shell.navEmail")} />}
      </NavGroup>

      {isOwnerOrAdmin && (
        <NavGroup title={t("setup.shell.groupAdmin")}>
          <NavDisclosure label={t("setup.shell.navConfiguration")} icon={Sliders} active={isConfigPage} defaultOpen={false}>
            <NavLink nested href={`${base}/config/draw`} icon={Shuffle} label={t("setup.shell.navDrawRules")} />
            <NavLink nested href={`${base}/config/rounds`} icon={Clock} label={t("setup.shell.navRoundSettings")} />
            <NavLink nested href={`${base}/config/format`} icon={Shield} label={t("setup.shell.navFormatTeams")} />
            <NavLink nested href={`${base}/config/scoring`} icon={FileCheck2} label={t("setup.shell.navScoringBallots")} />
            <NavLink nested href={`${base}/config/standings`} icon={Trophy} label={t("setup.shell.navStandingsRules")} />
            <NavLink nested href={`${base}/config/visibility`} icon={Eye} label={t("setup.shell.navPublicVisibility")} />
          </NavDisclosure>
          <NavLink href={`${base}/imports/assistants`} icon={Shield} label={t("setup.shell.navAssistants")} />
          <NavLink href={`${base}/audit`} icon={History} label={t("setup.shell.navAuditLog")} />
          <NavLink href={`${base}/exports`} icon={FileDown} label={t("setup.shell.navDataExports")} />
          <NavLink href={`${base}/rehearsal`} icon={FlaskConical} label={t("setup.shell.navRehearsal")} />
          <NavLink href={`${base}/api`} icon={KeyRound} label={t("setup.shell.navApiAccess")} />
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
  const { t } = useI18n();
  const drawerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(drawerRef, { active: mobileOpen, onEscape: onMobileClose });

  return (
    <>
      <aside
        aria-label={t("setup.shell.navRegionLabel")}
        className="sticky top-topbar hidden h-[calc(100vh-var(--topbar-height))] w-sidebar shrink-0 overflow-y-auto border-e border-border bg-background lg:block"
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
            aria-label={t("setup.shell.navRegionLabel")}
            tabIndex={-1}
            className="absolute inset-y-0 start-0 flex w-[min(18rem,85vw)] flex-col border-e border-border bg-background shadow-lg focus:outline-none"
          >
            <div className="flex h-topbar shrink-0 items-center justify-between border-b border-border px-3">
              <span className="text-[13px] font-semibold text-fg">{t("setup.shell.navDrawerTitle")}</span>
              <IconButton label={t("setup.shell.closeNavigation")} icon={<X />} size="sm" onClick={onMobileClose} />
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
