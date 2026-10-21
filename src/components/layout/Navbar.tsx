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
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { useToast } from "@/components/ui/Toast";
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
import { describeRoundStatus, tournamentFormatLabel } from "@/components/layout/roundStatus";
import { useBeforeUnloadWarning } from "@/components/layout/useBeforeUnloadWarning";
import { useI18n } from "@/components/i18n/I18nProvider";
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
  const { t, plural } = useI18n();
  const isSyncing = cloudSyncState === "syncing";

  if (localSaveError) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <StatusPill tone="danger" title={localSaveError}>
          <span className="max-sm:sr-only">{t("setup.shell.syncNotSaved")}</span>
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
        <span className="max-sm:sr-only">{t("setup.shell.syncSyncing")}</span>
      </StatusPill>
    ) : divergedRecords.length > 0 ? (
      <button
        type="button"
        onClick={onOpenConflicts}
        className={cn("rounded-full", focusRing)}
        title={t("setup.shell.syncConflictsHint")}
      >
        <StatusPill tone="warning" icon={<AlertTriangle aria-hidden="true" />}>
          <span className="max-sm:sr-only">{plural("setup.shell.syncConflicts", divergedRecords.length)}</span>
        </StatusPill>
      </button>
    ) : !isOnline ? (
      <StatusPill tone="warning" icon={<CloudOff aria-hidden="true" />} title={t("setup.shell.syncOfflineLocalHint")}>
        <span className="max-sm:sr-only">{t("setup.shell.syncOffline")}</span>
      </StatusPill>
    ) : (
      <StatusPill tone="neutral" icon={<Cloud aria-hidden="true" />} title={t("setup.shell.syncLocalCopyHint")}>
        <span className="max-sm:sr-only">{t("setup.shell.syncLocalCopy")}</span>
      </StatusPill>
    );
    return <div className="flex min-w-0 items-center gap-2">{pill}</div>;
  }

  const pendingLabel = plural("setup.shell.syncPending", pendingChanges.total);
  const pill = isSyncing ? (
    <StatusPill tone="info" icon={<Loader2 className="animate-spin" aria-hidden="true" />}>
      <span className="max-sm:sr-only">{t("setup.shell.syncSyncing")}</span>
    </StatusPill>
  ) : uploadIssue ? (
    <StatusPill tone="warning" icon={<AlertTriangle aria-hidden="true" />}>
      <span className="max-sm:sr-only">
        {uploadIssue.kind === "conflicts"
          ? plural("setup.shell.syncUploadConflicts", uploadIssue.count)
          : t("setup.shell.syncUploadIncomplete")}
      </span>
    </StatusPill>
  ) : divergedRecords.length > 0 ? (
    <StatusPill tone="warning" icon={<AlertTriangle aria-hidden="true" />}>
      <span className="max-sm:sr-only">{plural("setup.shell.syncConflicts", divergedRecords.length)}</span>
    </StatusPill>
  ) : cloudSyncState === "error" ? (
    <StatusPill tone="danger">
      <span className="max-sm:sr-only">{t("setup.shell.syncFailed")}</span>
    </StatusPill>
  ) : ballotConfirmationConflicts.length > 0 ? (
    <StatusPill tone="warning" icon={<AlertTriangle aria-hidden="true" />}>
      <span className="max-sm:sr-only">
        {plural("setup.shell.syncDoubleConfirmations", ballotConfirmationConflicts.length)}
      </span>
    </StatusPill>
  ) : liveSync.mode === "error" ? (
    <StatusPill tone="danger" icon={<AlertTriangle aria-hidden="true" />} title={describeLiveSyncStatus(liveSync)}>
      <span className="max-sm:sr-only">{t("setup.shell.syncLiveStopped")}</span>
    </StatusPill>
  ) : liveSync.mode === "offline" ? (
    <StatusPill tone="warning" icon={<CloudOff aria-hidden="true" />} title={describeLiveSyncStatus(liveSync)}>
      <span className="max-sm:sr-only">
        {liveSync.queuedWrites > 0
          ? t("setup.shell.syncOfflineQueued", { count: liveSync.queuedWrites })
          : t("setup.shell.syncOffline")}
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
      <span className="max-sm:sr-only">{liveSync.mode === "live" ? t("setup.shell.syncLive") : t("setup.shell.syncConnecting")}</span>
    </StatusPill>
  ) : !isOnline ? (
    <StatusPill tone="warning" icon={<CloudOff aria-hidden="true" />}>
      <span className="max-sm:sr-only">{t("setup.shell.syncOffline")}</span>
    </StatusPill>
  ) : (
    <StatusPill tone="success" icon={<Cloud aria-hidden="true" />}>
      <span className="max-sm:sr-only">{t("setup.shell.syncUploaded")}</span>
    </StatusPill>
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      <DropdownMenu
        align="end"
        triggerLabel={t("setup.shell.syncMenuTrigger")}
        triggerClassName="h-8 px-1"
        menuClassName="w-80 max-w-[calc(100vw-2rem)]"
        trigger={pill}
      >
        <DropdownMenuLabel>{t("setup.shell.syncMenuHeading")}</DropdownMenuLabel>
        <div role="presentation" className="space-y-2 px-2 pb-2 text-xs text-fg-muted">
          {uploadIssue && (
            <p className="text-warning">{describeUploadIssue(uploadIssue)}</p>
          )}
          {divergedRecords.length > 0 && (
            <p className="text-warning">{plural("setup.shell.syncDivergedDetail", divergedRecords.length)}</p>
          )}
          {ballotConfirmationConflicts.length > 0 && (
            <p className="text-warning">
              {plural("setup.shell.syncDoubleConfirmDetail", ballotConfirmationConflicts.length)}
            </p>
          )}
          {liveSync.mode !== "off" ? (
            <p className={liveSync.mode === "error" ? "text-danger" : liveSync.mode === "offline" ? "text-warning" : undefined}>
              {t("setup.shell.syncLiveDetail", { status: describeLiveSyncStatus(liveSync) })}
            </p>
          ) : isOwnerOrAdmin && !liveSyncEnabled ? (
            <p>{t("setup.shell.syncLivePaused")}</p>
          ) : null}
          {pendingChanges.total > 0 ? (
            <>
              <p>{plural("setup.shell.syncPendingDetail", pendingChanges.total)}</p>
              <ul className="list-disc space-y-0.5 ps-4">
                {pendingChanges.collections.map((item) => (
                  <li key={item.collection}>{describePendingCollection(item)}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t("setup.shell.syncAllUploaded")}</p>
          )}
          {!isOnline && liveSync.mode === "off" && <p>{t("setup.shell.syncOfflineDetail")}</p>}
          {cloudSyncMessage && (
            <p className={cloudSyncState === "error" ? "text-danger" : undefined}>
              {t("setup.shell.syncLastResult", { message: cloudSyncMessage })}
            </p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Upload />} onSelect={onUpload} disabled={!isOnline || isSyncing}>
          {t("setup.shell.uploadNow")}
        </DropdownMenuItem>
        {onDownload && (
          <DropdownMenuItem icon={<CloudDownload />} onSelect={onDownload} disabled={!isOnline || isSyncing}>
            {t("setup.shell.downloadAndCompare")}
          </DropdownMenuItem>
        )}
        {divergedRecords.length > 0 && (
          <DropdownMenuItem icon={<AlertTriangle />} onSelect={onOpenConflicts}>
            {t("setup.shell.resolveConflicts", { count: divergedRecords.length })}
          </DropdownMenuItem>
        )}
        {isOwnerOrAdmin && (
          <DropdownMenuItem
            icon={liveSyncEnabled ? <Pause /> : <Play />}
            onSelect={() => setLiveSyncEnabled(!liveSyncEnabled)}
          >
            {liveSyncEnabled ? t("setup.shell.pauseLive") : t("setup.shell.resumeLive")}
          </DropdownMenuItem>
        )}
        {onExportRecovery && (uploadIssue?.kind === "conflicts" || divergedRecords.length > 0) && (
          <DropdownMenuItem icon={<Download />} onSelect={onExportRecovery} disabled={!isOnline || isSyncing}>
            {t("setup.shell.exportArchivedVersions")}
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
  const { t, plural } = useI18n();
  const { toast } = useToast();
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

  // Upload, download and staff sync are confirmed in an in-page dialog rather than window.confirm,
  // which blocks the page's script (and browser automation) and cannot be translated or styled.
  const [pendingSync, setPendingSync] = useState<"upload" | "download" | "staffSync" | null>(null);

  const runUpload = async () => {
    try {
      await uploadToCloud();
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const runDownload = async () => {
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

  const runStaffSync = async () => {
    try {
      await syncDataEntry();
    } catch {
      // The sync state displays the specific failure.
    }
  };

  const handleUpload = () => setPendingSync("upload");
  const handleDownload = () => setPendingSync("download");
  const handleStaffSync = () => setPendingSync("staffSync");
  const confirmPendingSync = () => {
    const action = pendingSync;
    setPendingSync(null);
    if (action === "upload") void runUpload();
    else if (action === "download") void runDownload();
    else if (action === "staffSync") void runStaffSync();
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
  const formatLabel = tournament ? tournamentFormatLabel(tournament.format, t) : "";
  const activeStatus = activeRound ? describeRoundStatus(activeRound, t) : null;
  const userInitial = user?.displayName ? user.displayName.charAt(0).toUpperCase() : "T";

  return (
    <header className="sticky top-0 z-50 h-topbar shrink-0 border-b border-border bg-surface">
      {showRestoreDialog && <BackupRestoreDialog onClose={() => setShowRestoreDialog(false)} />}
      <SyncConflictsDialog open={showConflictsDialog} onClose={() => setShowConflictsDialog(false)} />
      <div className="flex h-full items-center gap-1 px-2 sm:gap-2 sm:px-3">
        <IconButton
          label={t("setup.shell.openNavigation")}
          icon={<Menu />}
          onClick={onOpenNav}
          aria-expanded={navOpen}
          aria-controls="tournament-navigation"
          className="lg:hidden"
        />

        <Link
          href="/"
          className={iconButtonClasses({ className: "max-sm:hidden" })}
          aria-label={t("setup.shell.home")}
          title={t("setup.shell.home")}
        >
          <Image src="/crabbytab.svg" alt="" width={24} height={24} className="h-6 w-6" />
        </Link>

        {/* Tournament switcher */}
        <DropdownMenu
          triggerLabel={t("setup.shell.tournamentMenuTrigger", { name: tournamentName })}
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
          <DropdownMenuItem href="/" icon={<Layers />}>{t("setup.shell.allTournaments")}</DropdownMenuItem>
          <DropdownMenuItem href="/tournaments/new" icon={<FilePlus2 />}>{t("setup.shell.newTournament")}</DropdownMenuItem>
          <DropdownMenuItem href="/tournaments/import" icon={<Import />}>{t("setup.shell.importTournament")}</DropdownMenuItem>
          <DropdownMenuItem href="/tournaments/demo" icon={<FlaskConical />}>{t("setup.shell.loadDemo")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem href={`/${tournamentSlug}/public`} external icon={<ExternalLink />}>
            {t("setup.shell.openPublicTab")}
          </DropdownMenuItem>
        </DropdownMenu>

        <span className="text-fg-subtle max-sm:hidden" aria-hidden="true">/</span>

        {/* Round switcher (visible at every width so rounds can be changed and created on mobile) */}
        <DropdownMenu
          triggerLabel={activeRound ? t("setup.shell.roundMenuTrigger", { name: activeRound.name }) : t("setup.shell.selectRound")}
          triggerClassName="h-8 shrink-0 px-2"
          menuClassName="w-64"
          trigger={
            <>
              <span className="font-medium">
                {activeRound ? (
                  activeRound.abbreviation || `R${activeRound.seq}`
                ) : rounds.length ? (
                  t("setup.shell.roundButton")
                ) : (
                  <>
                    <span className="sm:hidden">{t("setup.shell.groupRounds")}</span>
                    <span className="max-sm:hidden">{t("setup.shell.noRounds")}</span>
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
          {rounds.length > 0 && <DropdownMenuLabel>{t("setup.shell.groupRounds")}</DropdownMenuLabel>}
          {rounds.map((round) => (
            <DropdownMenuRadioItem
              key={round.id}
              checked={activeRound?.id === round.id}
              onSelect={() => setActiveRound(round)}
              description={describeRoundStatus(round, t).label}
            >
              <span className="font-medium">{round.abbreviation || `R${round.seq}`}</span>
              <span className="text-fg-muted"> · {round.name}</span>
            </DropdownMenuRadioItem>
          ))}
          {rounds.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-fg-muted">{t("setup.shell.noRoundsYet")}</p>
          )}
          {isOwnerOrAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Plus />} onSelect={() => setShowRoundModal(true)}>
                {t("setup.shell.newRoundMenu")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenu>

        <div className="ms-auto flex min-w-0 items-center gap-1 sm:gap-2">
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
                title={t("setup.shell.downloadHint")}
              >
                <CloudDownload aria-hidden="true" />
                <span className="sr-only md:not-sr-only">{isSyncing ? t("setup.shell.syncSyncing") : t("setup.shell.download")}</span>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleUpload}
                disabled={!isOnline || isSyncing}
                title={t("setup.shell.uploadHint")}
              >
                <Upload aria-hidden="true" />
                <span className="sr-only md:not-sr-only">{isSyncing ? t("setup.shell.syncSyncing") : t("setup.shell.upload")}</span>
              </Button>
            </>
          ) : user && isDataEntryAssistant ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleStaffSync}
              disabled={!isOnline || isSyncing}
              title={t("setup.shell.staffUploadHint")}
            >
              <Upload aria-hidden="true" />
              <span>{isSyncing ? t("setup.shell.uploading") : t("setup.shell.upload")}</span>
            </Button>
          ) : !user ? (
            <Link
              href={`/login?next=${encodeURIComponent(`/${tournamentSlug}`)}`}
              title={t("setup.shell.signInHint")}
              className="whitespace-nowrap text-xs text-accent-text max-sm:hidden underline-offset-2 hover:underline"
            >
              {t("setup.shell.signInToUpload")}
            </Link>
          ) : null}

          <Link
            href={`/${tournamentSlug}/public`}
            target="_blank"
            rel="noreferrer"
            className={iconButtonClasses({ className: "max-md:hidden" })}
            aria-label={t("setup.shell.openPublicTabNewTab")}
            title={t("setup.shell.navPublicTab")}
          >
            <ExternalLink aria-hidden="true" />
          </Link>

          <ThemeToggle preference={preference} onChange={setPreference} className="max-sm:hidden" />

          {/* User menu */}
          <DropdownMenu
            align="end"
            triggerLabel={t("setup.shell.accountMenu")}
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
              <p className="truncate text-[13px] font-medium text-fg">{user?.displayName || t("setup.shell.defaultUserName")}</p>
              <p className="truncate text-xs text-fg-muted">{user?.email || "director@tabbycat.local"}</p>
            </div>
            <DropdownMenuItem href="/" icon={<Layers />}>{t("setup.shell.allTournaments")}</DropdownMenuItem>
            <DropdownMenuItem href={`/${tournamentSlug}/config/draw`} icon={<Shield />}>
              {t("setup.shell.tournamentSettings")}
            </DropdownMenuItem>
            {isOwnerOrAdmin && (
              <DropdownMenuItem href={`/${tournamentSlug}/api`} icon={<KeyRound />}>{t("setup.shell.navApiAccess")}</DropdownMenuItem>
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
                      toast({
                        tone: "danger",
                        title: t("setup.shell.exportBackupFailed"),
                        description: error instanceof Error ? error.message : undefined,
                      });
                    }
                  }}
                >
                  {t("setup.shell.exportBackup")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<Download />}
                  onSelect={() => {
                    try {
                      exportTournamentArchive();
                    } catch (error) {
                      toast({
                        tone: "danger",
                        title: t("setup.shell.exportArchiveFailed"),
                        description: error instanceof Error ? error.message : undefined,
                      });
                    }
                  }}
                >
                  {t("setup.shell.exportArchive")}
                </DropdownMenuItem>
                <DropdownMenuItem icon={<CloudDownload />} onSelect={() => setShowRestoreDialog(true)}>
                  {t("setup.shell.restoreBackup")}
                </DropdownMenuItem>
                <DropdownMenuItem icon={<Download />} onSelect={handleExportRecovery} disabled={!isOnline || isSyncing}>
                  {t("setup.shell.exportSyncRecovery")}
                </DropdownMenuItem>
                <DropdownMenuItem icon={<CloudUpload />} onSelect={handleRepublish} disabled={!isOnline || isSyncing}>
                  {t("setup.shell.republish")}
                </DropdownMenuItem>
              </>
            )}
            {(isOwnerOrAdmin || isDataEntryAssistant) && divergedRecords.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<AlertTriangle />} onSelect={() => setShowConflictsDialog(true)}>
                  {t("setup.shell.resolveConflicts", { count: divergedRecords.length })}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <ThemeMenuItems preference={preference} onChange={setPreference} />
            <DropdownMenuSeparator />
            <LanguageMenuItems />
            <DropdownMenuSeparator />
            <DropdownMenuItem href="/account/password" icon={<KeyRound />}>{t("setup.entry.account.changePassword")}</DropdownMenuItem>
            <DropdownMenuItem
              tone="danger"
              icon={<LogOut />}
              onSelect={async () => {
                await logout();
                router.push("/");
              }}
            >
              {t("setup.shell.signOut")}
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
      </div>

      <Dialog
        open={republishPlan !== null}
        onClose={() => setRepublishPlan(null)}
        role="alertdialog"
        title={republishPlan?.kind === "blocked" ? t("setup.shell.republishBlockedTitle") : t("setup.shell.republishConfirmTitle")}
        description={
          republishPlan?.kind === "blocked"
            ? republishPlan.reason
            : plural("setup.shell.republishPending", republishPlan?.kind === "confirm-pending" ? republishPlan.pendingTotal : 0)
        }
        icon={<AlertTriangle className="text-warning" aria-hidden="true" />}
        footer={
          republishPlan?.kind === "blocked" ? (
            <>
              <Button variant="secondary" onClick={() => setRepublishPlan(null)}>{t("setup.common.close")}</Button>
              {uploadIssue?.kind === "partial" ? (
                <Button variant="primary" onClick={uploadFromRepublish}>{t("setup.shell.uploadAgain")}</Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => {
                    setRepublishPlan(null);
                    handleDownload();
                  }}
                >
                  {t("setup.shell.downloadAndCompare")}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setRepublishPlan(null)}>{t("setup.common.cancel")}</Button>
              <Button variant="secondary" onClick={() => republish(true)}>{t("setup.shell.publishAnyway")}</Button>
              <Button variant="primary" onClick={uploadFromRepublish}>{t("setup.shell.uploadAndPublish")}</Button>
            </>
          )
        }
      />

      {pendingSync && (
        <ConfirmActionDialog
          title={pendingSync === "download"
            ? t("setup.shell.downloadAndCompare")
            : pendingSync === "upload" ? t("setup.shell.uploadNow") : t("setup.shell.upload")}
          description={pendingSync === "download"
            ? t("setup.shell.confirmDownload")
            : pendingSync === "upload" ? t("setup.shell.confirmUpload") : t("setup.shell.confirmStaffSync")}
          confirmLabel={pendingSync === "download"
            ? t("setup.shell.downloadAndCompare")
            : pendingSync === "upload" ? t("setup.shell.uploadNow") : t("setup.shell.upload")}
          cancelLabel={t("setup.common.cancel")}
          onConfirm={confirmPendingSync}
          onCancel={() => setPendingSync(null)}
        />
      )}

      <Dialog
        open={showRoundModal}
        onClose={() => setShowRoundModal(false)}
        dismissible={!isCreatingRound}
        title={t("setup.shell.createRoundTitle")}
        description={t("setup.shell.createRoundDescription")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowRoundModal(false)} disabled={isCreatingRound}>
              {t("setup.common.cancel")}
            </Button>
            <Button variant="primary" type="submit" form="create-round-form" loading={isCreatingRound} loadingText={t("setup.shell.creating")}>
              {t("setup.shell.createRound")}
            </Button>
          </>
        }
      >
        <form id="create-round-form" onSubmit={handleCreateRound} className="space-y-4">
          <Input
            label={t("setup.shell.roundName")}
            required
            placeholder={t("setup.shell.roundNamePlaceholder", { number: rounds.length + 1 })}
            value={newRoundName}
            onChange={(e) => setNewRoundName(e.target.value)}
          />
          <Input
            label={t("setup.shell.abbreviation")}
            help={t("setup.shell.abbreviationHelp")}
            placeholder={`R${rounds.length + 1}`}
            value={newRoundAbbr}
            onChange={(e) => setNewRoundAbbr(e.target.value)}
          />
          <Select
            label={t("setup.shell.roundStage")}
            value={newRoundStage}
            onChange={(e) => setNewRoundStage(e.target.value === "elimination" ? "elimination" : "preliminary")}
          >
            <option value="preliminary">{t("setup.shell.stagePreliminary")}</option>
            <option value="elimination">{t("setup.shell.stageElimination")}</option>
          </Select>
        </form>
      </Dialog>
    </header>
  );
}
