"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTournament } from "@/contexts/TournamentContext";
import { useAuth } from "@/contexts/AuthContext";
import { BackupRestoreDialog } from "@/features/tournament/components/BackupRestoreDialog";
import { SyncConflictsDialog } from "@/features/tournament/components/SyncConflictsDialog";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { Button, iconButtonClasses, IconButton } from "@/components/ui/Button";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select } from "@/components/ui/Field";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";
import { ThemeMenuItems, ThemeToggle, useThemePreference } from "@/components/ui/ThemeToggle";
import { LanguageMenuItems } from "@/components/ui/LanguageSwitcher";
import { describeRoundStatus } from "@/components/layout/roundStatus";
import {
  AlertTriangle,
  ChevronsUpDown,
  Cloud,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Download,
  ExternalLink,
  FilePlus2,
  Import,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
  Menu,
  Plus,
  Shield,
  Upload,
} from "lucide-react";

type RoundStage = "preliminary" | "elimination";

function SyncStatus({ isOnline, onOpenConflicts }: { isOnline: boolean; onOpenConflicts: () => void }) {
  const { cloudSyncState, cloudSyncMessage, localSaveError, divergedRecords } = useTournament();

  const pill = localSaveError ? (
    <StatusPill tone="danger" title={localSaveError}>
      <span className="max-sm:sr-only">Not saved</span>
    </StatusPill>
  ) : cloudSyncState === "syncing" ? (
    <StatusPill tone="info" icon={<Loader2 className="animate-spin" aria-hidden="true" />}>
      <span className="max-sm:sr-only">Syncing…</span>
    </StatusPill>
  ) : cloudSyncState === "error" ? (
    <StatusPill tone="danger" title={cloudSyncMessage}>
      <span className="max-sm:sr-only">Sync failed</span>
    </StatusPill>
  ) : divergedRecords.length > 0 ? (
    <button
      type="button"
      onClick={onOpenConflicts}
      className={cn("rounded-full", focusRing)}
      title="Records changed both on this device and in the cloud. Choose which version to keep."
    >
      <StatusPill tone="warning" icon={<AlertTriangle aria-hidden="true" />}>
        <span className="max-sm:sr-only">
          {divergedRecords.length} sync conflict{divergedRecords.length === 1 ? "" : "s"}
        </span>
      </StatusPill>
    </button>
  ) : !isOnline ? (
    <StatusPill tone="warning" icon={<CloudOff aria-hidden="true" />} title="Offline; changes are saved locally">
      <span className="max-sm:sr-only">Offline</span>
    </StatusPill>
  ) : (
    <StatusPill tone="neutral" icon={<Cloud aria-hidden="true" />} title="Offline-first; changes are saved locally">
      <span className="max-sm:sr-only">Local copy</span>
    </StatusPill>
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      {pill}
      {cloudSyncMessage && (
        <span
          role="status"
          className={`hidden max-w-[220px] truncate text-xs xl:inline ${cloudSyncState === "error" ? "text-danger" : "text-fg-muted"}`}
          title={cloudSyncMessage}
        >
          {cloudSyncMessage}
        </span>
      )}
      {localSaveError && (
        <span role="alert" className="hidden max-w-[220px] truncate text-xs text-danger xl:inline" title={localSaveError}>
          {localSaveError}
        </span>
      )}
    </div>
  );
}

export function Navbar({
  tournamentSlug,
  onOpenNav,
  navOpen,
}: {
  tournamentSlug: string;
  onOpenNav: () => void;
  navOpen: boolean;
}) {
  const router = useRouter();
  const {
    tournament,
    rounds,
    activeRound,
    setActiveRound,
    createRound,
    cloudSyncState,
    isOwnerOrAdmin,
    isDataEntryAssistant,
    uploadToCloud,
    publishPublicView,
    downloadFromCloud,
    exportSyncRecovery,
    divergedRecords,
    exportTournamentBackup,
    exportTournamentArchive,
    syncDataEntry,
  } = useTournament();
  const { user, logout } = useAuth();
  const { preference, setPreference } = useThemePreference();
  const [isOnline, setIsOnline] = useState(true);
  const [showRoundModal, setShowRoundModal] = useState(false);
  const [newRoundName, setNewRoundName] = useState("");
  const [newRoundAbbr, setNewRoundAbbr] = useState("");
  const [newRoundStage, setNewRoundStage] = useState<RoundStage>("preliminary");
  const [isCreatingRound, setIsCreatingRound] = useState(false);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const [showConflictsDialog, setShowConflictsDialog] = useState(false);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  const isSyncing = cloudSyncState === "syncing";

  const handleUpload = async () => {
    if (!window.confirm(
      "Merge this device's records into Firestore? Cloud-only records are retained. Different cloud versions are archived before replacement. Local deletions are not applied to cloud."
    )) {
      return;
    }
    try {
      await uploadToCloud();
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const handleDownload = async () => {
    if (
      !window.confirm(
        "Merge Firestore records into this device? Records not changed here since the last sync take the cloud version. Records changed here are kept, and flagged as conflicts if the cloud changed them too. No cloud records are deleted."
      )
    ) {
      return;
    }
    try {
      await downloadFromCloud();
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const handleRepublish = async () => {
    try {
      await publishPublicView(true);
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const handleExportRecovery = async () => {
    try {
      await exportSyncRecovery();
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const handleStaffSync = async () => {
    if (!window.confirm(
      "Upload participant, ballot, feedback, and result changes? Tournament settings, draw pairings, and allocations will not be uploaded."
    )) {
      return;
    }
    try {
      await syncDataEntry();
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const handleCreateRound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoundName.trim()) return;
    setIsCreatingRound(true);
    try {
      await createRound(
        newRoundName.trim(),
        newRoundAbbr.trim() || `R${rounds.length + 1}`,
        newRoundStage
      );
      setNewRoundName("");
      setNewRoundAbbr("");
      setShowRoundModal(false);
    } finally {
      setIsCreatingRound(false);
    }
  };

  const tournamentName = tournament?.shortName || tournament?.name || tournamentSlug;
  const formatLabel = tournament?.format === "bp" ? "BP (4-Team)" : "UADC (2-Team)";
  const activeStatus = activeRound ? describeRoundStatus(activeRound) : null;
  const userInitial = user?.displayName ? user.displayName.charAt(0).toUpperCase() : "T";

  return (
    <header className="sticky top-0 z-50 h-topbar shrink-0 border-b border-border bg-surface">
      {showRestoreDialog && <BackupRestoreDialog onClose={() => setShowRestoreDialog(false)} />}
      <SyncConflictsDialog open={showConflictsDialog} onClose={() => setShowConflictsDialog(false)} />
      <div className="flex h-full items-center gap-1 px-2 sm:gap-2 sm:px-3">
        <IconButton
          label="Open navigation"
          icon={<Menu />}
          onClick={onOpenNav}
          aria-expanded={navOpen}
          aria-controls="tournament-navigation"
          className="lg:hidden"
        />

        <Link
          href="/"
          className={iconButtonClasses({ className: "max-sm:hidden" })}
          aria-label="CrabbyTab home"
          title="CrabbyTab home"
        >
          <Image src="/crabbytab.svg" alt="" width={24} height={24} className="h-6 w-6" />
        </Link>

        {/* Tournament switcher */}
        <DropdownMenu
          triggerLabel={`Tournament: ${tournamentName}`}
          triggerClassName="h-8 min-w-0 max-w-[30vw] px-2 sm:max-w-[320px]"
          trigger={
            <>
              <span className="truncate font-semibold">{tournamentName}</span>
              <Badge className="max-md:hidden">{formatLabel}</Badge>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            </>
          }
        >
          <DropdownMenuLabel>{formatLabel}</DropdownMenuLabel>
          <DropdownMenuItem href="/" icon={<Layers />}>All tournaments</DropdownMenuItem>
          <DropdownMenuItem href="/tournaments/new" icon={<FilePlus2 />}>New tournament</DropdownMenuItem>
          <DropdownMenuItem href="/tournaments/import" icon={<Import />}>Import tournament</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem href={`/${tournamentSlug}/public`} external icon={<ExternalLink />}>
            Open public tab
          </DropdownMenuItem>
        </DropdownMenu>

        <span className="text-fg-subtle max-sm:hidden" aria-hidden="true">/</span>

        {/* Round switcher (visible at every width so rounds can be changed and created on mobile) */}
        <DropdownMenu
          triggerLabel={activeRound ? `Round: ${activeRound.name}` : "Select round"}
          triggerClassName="h-8 shrink-0 px-2"
          menuClassName="w-64"
          trigger={
            <>
              <span className="font-medium">
                {activeRound ? (
                  activeRound.abbreviation || `R${activeRound.seq}`
                ) : rounds.length ? (
                  "Round"
                ) : (
                  <>
                    <span className="sm:hidden">Rounds</span>
                    <span className="max-sm:hidden">No rounds</span>
                  </>
                )}
              </span>
              {activeStatus && (
                <StatusPill tone={activeStatus.tone} className="max-md:hidden">
                  {activeStatus.short}
                </StatusPill>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            </>
          }
        >
          {rounds.length > 0 && <DropdownMenuLabel>Rounds</DropdownMenuLabel>}
          {rounds.map((round) => (
            <DropdownMenuRadioItem
              key={round.id}
              checked={activeRound?.id === round.id}
              onSelect={() => setActiveRound(round)}
              description={describeRoundStatus(round).label}
            >
              <span className="font-medium">{round.abbreviation || `R${round.seq}`}</span>
              <span className="text-fg-muted"> · {round.name}</span>
            </DropdownMenuRadioItem>
          ))}
          {rounds.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-fg-muted">No rounds have been created yet.</p>
          )}
          {isOwnerOrAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Plus />} onSelect={() => setShowRoundModal(true)}>
                New round…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenu>

        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          <SyncStatus isOnline={isOnline} onOpenConflicts={() => setShowConflictsDialog(true)} />

          {user && isOwnerOrAdmin ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDownload}
                disabled={!isOnline || isSyncing}
                title="Merge cloud records with this device's local copy"
              >
                <CloudDownload aria-hidden="true" />
                <span className="sr-only md:not-sr-only">{isSyncing ? "Syncing…" : "Download"}</span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleUpload}
                disabled={!isOnline || isSyncing}
                title="Merge this device's records into Firestore; archive any conflicting cloud versions"
              >
                <Upload aria-hidden="true" />
                <span className="sr-only md:not-sr-only">{isSyncing ? "Syncing…" : "Upload"}</span>
              </Button>
            </>
          ) : user && isDataEntryAssistant ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleStaffSync}
              disabled={!isOnline || isSyncing}
              title="Upload approved participant, ballot, feedback, and result records"
            >
              <Upload aria-hidden="true" />
              <span>{isSyncing ? "Uploading…" : "Upload"}</span>
            </Button>
          ) : !user ? (
            <Link
              href={`/login?next=${encodeURIComponent(`/${tournamentSlug}`)}`}
              title="Sign in only when you want to upload your local copy"
              className="whitespace-nowrap text-xs text-accent-text max-sm:hidden underline-offset-2 hover:underline"
            >
              Sign in to upload
            </Link>
          ) : null}

          <Link
            href={`/${tournamentSlug}/public`}
            target="_blank"
            rel="noreferrer"
            className={iconButtonClasses({ className: "max-md:hidden" })}
            aria-label="Open public tab in a new tab"
            title="Public tab"
          >
            <ExternalLink aria-hidden="true" />
          </Link>

          <ThemeToggle preference={preference} onChange={setPreference} className="max-sm:hidden" />

          {/* User menu */}
          <DropdownMenu
            align="end"
            triggerLabel="Account menu"
            triggerClassName="h-8 px-1"
            menuClassName="w-64"
            trigger={
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-fg"
                aria-hidden="true"
              >
                {userInitial}
              </span>
            }
          >
            <div role="presentation" className="-mx-1 mb-1 border-b border-border px-3 pb-2 pt-1.5">
              <p className="truncate text-[13px] font-medium text-fg">{user?.displayName || "Tab Director"}</p>
              <p className="truncate text-xs text-fg-muted">{user?.email || "director@tabbycat.local"}</p>
            </div>
            <DropdownMenuItem href="/" icon={<Layers />}>All tournaments</DropdownMenuItem>
            <DropdownMenuItem href={`/${tournamentSlug}/config/draw`} icon={<Shield />}>Tournament settings</DropdownMenuItem>
            {isOwnerOrAdmin && (
              <DropdownMenuItem href={`/${tournamentSlug}/api`} icon={<KeyRound />}>API access</DropdownMenuItem>
            )}
            {isOwnerOrAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon={<Download />}
                  onSelect={() => {
                    try {
                      exportTournamentBackup();
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : "Could not export backup.");
                    }
                  }}
                >
                  Export tournament backup
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<Download />}
                  onSelect={() => {
                    try {
                      exportTournamentArchive();
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : "Could not export DebateXML archive.");
                    }
                  }}
                >
                  Export DebateXML archive
                </DropdownMenuItem>
                <DropdownMenuItem icon={<CloudDownload />} onSelect={() => setShowRestoreDialog(true)}>
                  Restore tournament backup…
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Download />} onSelect={handleExportRecovery} disabled={!isOnline || isSyncing}>
                  Export sync recovery
                </DropdownMenuItem>
                <DropdownMenuItem icon={<CloudUpload />} onSelect={handleRepublish} disabled={!isOnline || isSyncing}>
                  Republish public pages
                </DropdownMenuItem>
              </>
            )}
            {(isOwnerOrAdmin || isDataEntryAssistant) && divergedRecords.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<AlertTriangle />} onSelect={() => setShowConflictsDialog(true)}>
                  Resolve sync conflicts ({divergedRecords.length})…
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <ThemeMenuItems preference={preference} onChange={setPreference} />
            <DropdownMenuSeparator />
            <LanguageMenuItems />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              tone="danger"
              icon={<LogOut />}
              onSelect={async () => {
                await logout();
                router.push("/");
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
      </div>

      <Dialog
        open={showRoundModal}
        onClose={() => setShowRoundModal(false)}
        dismissible={!isCreatingRound}
        title="Create new round"
        description="Rounds are added after the existing ones. You can change their settings later."
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowRoundModal(false)} disabled={isCreatingRound}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="create-round-form" loading={isCreatingRound} loadingText="Creating...">
              Create round
            </Button>
          </>
        }
      >
        <form id="create-round-form" onSubmit={handleCreateRound} className="space-y-4">
          <Input
            label="Round name"
            required
            placeholder={`Round ${rounds.length + 1}`}
            value={newRoundName}
            onChange={(e) => setNewRoundName(e.target.value)}
          />
          <Input
            label="Abbreviation"
            help="For example R4, QF, SF or GF. Defaults to the next round number."
            placeholder={`R${rounds.length + 1}`}
            value={newRoundAbbr}
            onChange={(e) => setNewRoundAbbr(e.target.value)}
          />
          <Select
            label="Round stage"
            value={newRoundStage}
            onChange={(e) => setNewRoundStage(e.target.value === "elimination" ? "elimination" : "preliminary")}
          >
            <option value="preliminary">Preliminary (In-Rounds)</option>
            <option value="elimination">Elimination (Out-Rounds / Break)</option>
          </Select>
        </form>
      </Dialog>
    </header>
  );
}
