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
import { useBeforeUnloadWarning } from "@/components/layout/useBeforeUnloadWarning";
import { db } from "@/lib/firebase";
import {
  describePendingCollection,
  describeUploadIssue,
  planRepublish,
  shouldWarnBeforeUnload,
} from "@/features/tournament/application/syncStatus";
import { describeLiveSyncStatus } from "@/features/tournament/application/liveSync";
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
  FlaskConical,
  Import,
  KeyRound,
  Layers,
  Loader2,
  LogOut,
  Pause,
  Play,
  RadioTower,
  Menu,
  Plus,
  Shield,
  Upload,
} from "lucide-react";

type RoundStage = "preliminary" | "elimination";

function SyncStatus({
  isOnline,
  cloudSyncEnabled,
  onOpenConflicts,
  onUpload,
  onDownload,
  onExportRecovery,
}: {
  isOnline: boolean;
  /** Signed in as tournament staff with Firebase configured, so this device syncs with the cloud. */
  cloudSyncEnabled: boolean;
  onOpenConflicts: () => void;
  onUpload: () => void;
  onDownload?: () => void;
  onExportRecovery?: () => void;
}) {
  const {
    cloudSyncState,
    cloudSyncMessage,
    localSaveError,
    divergedRecords,
    pendingChanges,
    uploadIssue,
    liveSync,
    liveSyncEnabled,
    setLiveSyncEnabled,
    ballotConfirmationConflicts,
    isOwnerOrAdmin,
  } = useTournament();
  const isSyncing = cloudSyncState === "syncing";

  if (localSaveError) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <StatusPill tone="danger" title={localSaveError}>
          <span className="max-sm:sr-only">Not saved</span>
        </StatusPill>
        <span role="alert" className="hidden max-w-[220px] truncate text-xs text-danger xl:inline" title={localSaveError}>
          {localSaveError}
        </span>
      </div>
    );
  }

  if (!cloudSyncEnabled) {
    const pill = isSyncing ? (
      <StatusPill tone="info" icon={<Loader2 className="animate-spin" aria-hidden="true" />}>
        <span className="max-sm:sr-only">Syncing…</span>
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
      <StatusPill tone="neutral" icon={<Cloud aria-hidden="true" />} title="Offline-first; changes are saved on this device">
        <span className="max-sm:sr-only">Local copy</span>
      </StatusPill>
    );
    return <div className="flex min-w-0 items-center gap-2">{pill}</div>;
  }

  const pendingLabel = `${pendingChanges.total} change${pendingChanges.total === 1 ? "" : "s"} not uploaded`;
  const pill = isSyncing ? (
    <StatusPill tone="info" icon={<Loader2 className="animate-spin" aria-hidden="true" />}>
      <span className="max-sm:sr-only">Syncing…</span>
    </StatusPill>
  ) : uploadIssue ? (
    <StatusPill tone="warning" icon={<AlertTriangle aria-hidden="true" />}>
      <span className="max-sm:sr-only">
        {uploadIssue.kind === "conflicts"
          ? `${uploadIssue.count} upload conflict${uploadIssue.count === 1 ? "" : "s"}`
          : "Upload incomplete"}
      </span>
    </StatusPill>
  ) : divergedRecords.length > 0 ? (
    <StatusPill tone="warning" icon={<AlertTriangle aria-hidden="true" />}>
      <span className="max-sm:sr-only">
        {divergedRecords.length} sync conflict{divergedRecords.length === 1 ? "" : "s"}
      </span>
    </StatusPill>
  ) : cloudSyncState === "error" ? (
    <StatusPill tone="danger">
      <span className="max-sm:sr-only">Sync failed</span>
    </StatusPill>
  ) : ballotConfirmationConflicts.length > 0 ? (
    <StatusPill tone="warning" icon={<AlertTriangle aria-hidden="true" />}>
      <span className="max-sm:sr-only">
        {ballotConfirmationConflicts.length} double confirmation{ballotConfirmationConflicts.length === 1 ? "" : "s"}
      </span>
    </StatusPill>
  ) : liveSync.mode === "error" ? (
    <StatusPill tone="danger" icon={<AlertTriangle aria-hidden="true" />} title={describeLiveSyncStatus(liveSync)}>
      <span className="max-sm:sr-only">Live updates stopped</span>
    </StatusPill>
  ) : liveSync.mode === "offline" ? (
    <StatusPill tone="warning" icon={<CloudOff aria-hidden="true" />} title={describeLiveSyncStatus(liveSync)}>
      <span className="max-sm:sr-only">
        {liveSync.queuedWrites > 0 ? `Offline — ${liveSync.queuedWrites} queued` : "Offline"}
      </span>
    </StatusPill>
  ) : pendingChanges.total > 0 ? (
    <StatusPill tone="warning" icon={<CloudUpload aria-hidden="true" />}>
      <span className="max-sm:sr-only">{pendingLabel}</span>
    </StatusPill>
  ) : liveSync.mode === "live" || liveSync.mode === "connecting" ? (
    <StatusPill
      tone={liveSync.mode === "live" ? "success" : "info"}
      icon={liveSync.queuedWrites > 0 || liveSync.mode === "connecting"
        ? <Loader2 className="animate-spin" aria-hidden="true" />
        : <RadioTower aria-hidden="true" />}
      title={describeLiveSyncStatus(liveSync)}
    >
      <span className="max-sm:sr-only">{liveSync.mode === "live" ? "Live" : "Connecting…"}</span>
    </StatusPill>
  ) : !isOnline ? (
    <StatusPill tone="warning" icon={<CloudOff aria-hidden="true" />}>
      <span className="max-sm:sr-only">Offline</span>
    </StatusPill>
  ) : (
    <StatusPill tone="success" icon={<Cloud aria-hidden="true" />}>
      <span className="max-sm:sr-only">Uploaded</span>
    </StatusPill>
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      <DropdownMenu
        align="end"
        triggerLabel="Cloud sync status"
        triggerClassName="h-8 px-1"
        menuClassName="w-80 max-w-[calc(100vw-2rem)]"
        trigger={pill}
      >
        <DropdownMenuLabel>Cloud sync</DropdownMenuLabel>
        <div role="presentation" className="space-y-2 px-2 pb-2 text-xs text-fg-muted">
          {uploadIssue && (
            <p className="text-warning">{describeUploadIssue(uploadIssue)}</p>
          )}
          {divergedRecords.length > 0 && (
            <p className="text-warning">
              {divergedRecords.length} record(s) changed both here and in the cloud. Choose which version to keep before uploading.
            </p>
          )}
          {ballotConfirmationConflicts.length > 0 && (
            <p className="text-warning">
              {ballotConfirmationConflicts.length} debate(s) have more than one confirmed ballot, confirmed on
              different devices. Open the debate&apos;s ballots and discard the version that should not count.
            </p>
          )}
          {liveSync.mode !== "off" ? (
            <p className={liveSync.mode === "error" ? "text-danger" : liveSync.mode === "offline" ? "text-warning" : undefined}>
              {describeLiveSyncStatus(liveSync)} Ballots, check-ins, draws and allocations sync live; settings,
              rounds, motions, rooms, breaks and feedback still upload with Upload now.
            </p>
          ) : isOwnerOrAdmin && !liveSyncEnabled ? (
            <p>Live updates are paused on this device; every change waits for Upload now.</p>
          ) : null}
          {pendingChanges.total > 0 ? (
            <>
              <p>
                {pendingLabel}. They are saved on this device, but the cloud and public pages do not have them yet.
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {pendingChanges.collections.map((item) => (
                  <li key={item.collection}>{describePendingCollection(item)}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>Everything on this device has been uploaded.</p>
          )}
          {!isOnline && liveSync.mode === "off" && <p>You are offline. Changes stay on this device until you upload.</p>}
          {cloudSyncMessage && (
            <p className={cloudSyncState === "error" ? "text-danger" : undefined}>
              Last result: {cloudSyncMessage}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Upload />} onSelect={onUpload} disabled={!isOnline || isSyncing}>
          Upload now
        </DropdownMenuItem>
        {onDownload && (
          <DropdownMenuItem icon={<CloudDownload />} onSelect={onDownload} disabled={!isOnline || isSyncing}>
            Download and compare
          </DropdownMenuItem>
        )}
        {divergedRecords.length > 0 && (
          <DropdownMenuItem icon={<AlertTriangle />} onSelect={onOpenConflicts}>
            Resolve sync conflicts ({divergedRecords.length})…
          </DropdownMenuItem>
        )}
        {isOwnerOrAdmin && (
          <DropdownMenuItem
            icon={liveSyncEnabled ? <Pause /> : <Play />}
            onSelect={() => setLiveSyncEnabled(!liveSyncEnabled)}
          >
            {liveSyncEnabled ? "Pause live updates on this device" : "Resume live updates"}
          </DropdownMenuItem>
        )}
        {onExportRecovery && (uploadIssue?.kind === "conflicts" || divergedRecords.length > 0) && (
          <DropdownMenuItem icon={<Download />} onSelect={onExportRecovery} disabled={!isOnline || isSyncing}>
            Export archived cloud versions
          </DropdownMenuItem>
        )}
      </DropdownMenu>
      {cloudSyncMessage && (
        <span
          className={`hidden max-w-[220px] truncate text-xs xl:inline ${cloudSyncState === "error" ? "text-danger" : "text-fg-muted"}`}
          title={cloudSyncMessage}
          role="status"
        >
          {cloudSyncMessage}
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
    pendingChanges,
    uploadIssue,
    liveSync,
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
  const cloudSyncEnabled = Boolean(db && user && (isOwnerOrAdmin || isDataEntryAssistant));
  const [republishPlan, setRepublishPlan] = useState<ReturnType<typeof planRepublish> | null>(null);

  useBeforeUnloadWarning(
    shouldWarnBeforeUnload({
      cloudSyncEnabled,
      pendingTotal: pendingChanges.total + liveSync.queuedWrites,
      cloudBusy: isSyncing,
    })
  );

  const handleUpload = async () => {
    if (!window.confirm(
      "Upload this device's changes and publish public pages? Cloud-only records are retained. Different cloud versions are archived before replacement. If any record conflicts with a newer cloud version, public pages are not updated until you resolve it."
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

  const handleRepublish = () => {
    const plan = planRepublish({ pendingTotal: pendingChanges.total, uploadIssue });
    if (plan.kind === "publish") {
      void republish(false);
      return;
    }
    setRepublishPlan(plan);
  };

  const republish = async (publishWithPendingChanges: boolean) => {
    setRepublishPlan(null);
    try {
      await publishPublicView(true, { publishWithPendingChanges });
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const uploadFromRepublish = async () => {
    setRepublishPlan(null);
    try {
      await uploadToCloud();
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
          <DropdownMenuItem href="/tournaments/demo" icon={<FlaskConical />}>Load demo tournament</DropdownMenuItem>
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
          <SyncStatus
            isOnline={isOnline}
            cloudSyncEnabled={cloudSyncEnabled}
            onOpenConflicts={() => setShowConflictsDialog(true)}
            onUpload={isOwnerOrAdmin ? handleUpload : handleStaffSync}
            onDownload={isOwnerOrAdmin ? handleDownload : undefined}
            onExportRecovery={isOwnerOrAdmin ? handleExportRecovery : undefined}
          />

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
        open={republishPlan !== null}
        onClose={() => setRepublishPlan(null)}
        role="alertdialog"
        title={republishPlan?.kind === "blocked" ? "Public pages cannot be republished yet" : "Upload changes before republishing?"}
        description={
          republishPlan?.kind === "blocked"
            ? republishPlan.reason
            : `Republishing publishes the cloud copy. ${republishPlan?.kind === "confirm-pending" ? republishPlan.pendingTotal : 0} change(s) on this device are not uploaded, so the public would see an older version.`
        }
        icon={<AlertTriangle className="text-warning" aria-hidden="true" />}
        footer={
          republishPlan?.kind === "blocked" ? (
            <>
              <Button variant="secondary" onClick={() => setRepublishPlan(null)}>Close</Button>
              {uploadIssue?.kind === "partial" ? (
                <Button variant="primary" onClick={uploadFromRepublish}>Upload again</Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => {
                    setRepublishPlan(null);
                    void handleDownload();
                  }}
                >
                  Download and compare
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setRepublishPlan(null)}>Cancel</Button>
              <Button variant="secondary" onClick={() => republish(true)}>Publish cloud copy anyway</Button>
              <Button variant="primary" onClick={uploadFromRepublish}>Upload and publish</Button>
            </>
          )
        }
      />

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
