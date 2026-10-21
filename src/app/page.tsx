"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  ArrowRight,
  Layers,
  RefreshCw,
  Trash2,
  ExternalLink,
  Shield,
  CheckCircle2,
  Clock,
  User as UserIcon,
} from "lucide-react";
import type { TournamentFormat } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { safeJsonParse } from "@/lib/safeJson";
import { getLocalStore, readLocalTournamentMetas, tournamentKeyPrefix } from "@/lib/offline/localStore";
import { useI18n } from "@/components/i18n/I18nProvider";
import { EntryBrandLink, EntryPreferenceControls } from "@/components/setup/SetupShell";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Button, IconButton, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

interface StoredTournamentSummary {
  id: string;
  slug: string;
  name: string;
  format: TournamentFormat;
  createdAt: string;
  ownerId?: string;
  ownerEmail?: string;
  isOwner?: boolean;
  isLocal?: boolean;
  accessRole?: "admin" | "dataEntry";
}

export default function HomePage() {
  const router = useRouter();
  const { t, formatDateTime } = useI18n();
  const { user, loading: authLoading, logout, isGlobalAdmin } = useAuth();
  const [tournaments, setTournaments] = useState<StoredTournamentSummary[]>([]);
  const [loadingTournaments, setLoadingTournaments] = useState(true);
  const [filterTab, setFilterTab] = useState<"all" | "mine">("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  // A flag rather than text, so changing language does not re-create the loader and refetch.
  const [cloudError, setCloudError] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StoredTournamentSummary | null>(null);
  const [deletedName, setDeletedName] = useState("");

  // Tournament creation is reserved for global administrators.
  const goCreate = () => router.push("/tournaments/new");

  // Tournaments saved on this device
  const getLocalTournaments = useCallback(async (): Promise<StoredTournamentSummary[]> => {
    const list: StoredTournamentSummary[] = [];

    if (typeof window === "undefined") return list;

    let metas: Array<{ key: string; raw: string }> = [];
    try {
      metas = await readLocalTournamentMetas(getLocalStore());
    } catch (error) {
      console.warn("Could not read tournaments saved on this device:", error);
    }
    for (const { raw } of metas) {
      const item = safeJsonParse<Record<string, any> | null>(raw, null);
      if (item && typeof item === "object" && item.slug) {
        list.push({
          id: item.id || `tourn-${item.slug}`,
          slug: item.slug,
          name: item.name || item.slug,
          format: item.format || "bp",
          createdAt: item.createdAt || new Date().toISOString(),
          ownerId: item.ownerId,
          ownerEmail: item.ownerEmail,
          isLocal: true,
        });
      }
    }

    return list;
  }, []);

  // Local data remains available offline; signed-in accounts load only authorized cloud tournaments.
  const loadTournaments = useCallback(async () => {
    const localList = await getLocalTournaments();
    setTournaments(localList.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ));
    setLoadingTournaments(false);
  }, [getLocalTournaments]);

  const refreshCloudTournaments = useCallback(async () => {
    if (!user) {
      await loadTournaments();
      return;
    }
    setLoadingTournaments(true);
    setIsRefreshing(true);
    setCloudError(false);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/tournaments", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json() as {
        error?: string;
        tournaments?: StoredTournamentSummary[];
      };
      if (!response.ok) throw new Error(result.error || "Could not load your tournaments.");

      const localItems = await getLocalTournaments();
      const cloudItems = (result.tournaments || []).map((item) => ({
        ...item,
        isOwner: isGlobalAdmin || item.accessRole === "admin",
        isLocal: localItems.some((local) => local.slug === item.slug),
      }));
      const accessibleSlugs = new Set(cloudItems.map((item) => item.slug));
      const cloudBySlug = new Map<string, StoredTournamentSummary>(
        cloudItems.map((item) => [item.slug, item])
      );
      localItems
        .filter((item) => isGlobalAdmin || accessibleSlugs.has(item.slug))
        .forEach((item) => {
          if (!cloudBySlug.has(item.slug)) cloudBySlug.set(item.slug, item);
        });
      setTournaments([...cloudBySlug.values()].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ));
    } catch (error) {
      console.error("Could not refresh cloud tournaments:", error);
      setCloudError(true);
    } finally {
      setLoadingTournaments(false);
      setIsRefreshing(false);
    }
  }, [getLocalTournaments, isGlobalAdmin, loadTournaments, user]);

  useEffect(() => {
    if (authLoading) return;
    setTournaments([]);
    setLoadingTournaments(true);
    if (user) void refreshCloudTournaments();
    else void loadTournaments();
  }, [authLoading, loadTournaments, refreshCloudTournaments, user]);

  const handleDelete = async (tournament: StoredTournamentSummary) => {
    setPendingDelete(null);

    // 1. Remove from this device (only this slug: "spring" must not delete "springfield")
    try {
      await getLocalStore().removePrefix(tournamentKeyPrefix(tournament.slug));
    } catch (e) {
      console.warn("Could not delete the tournament from this device:", e);
    }

    // Refresh list
    setTournaments((prev) => prev.filter((item) => item.slug !== tournament.slug));
    setDeletedName(tournament.name);
  };

  const filteredTournaments = tournaments.filter((t) => {
    if (filterTab === "mine") {
      if (!user) return false;
      if (isGlobalAdmin) return true;
      return t.accessRole === "admin" || t.accessRole === "dataEntry";
    }
    return true;
  });

  const myTournamentsCount = user
    ? isGlobalAdmin
      ? tournaments.length
      : tournaments.filter((t) => t.accessRole === "admin" || t.accessRole === "dataEntry").length
    : 0;

  const filterOptions = [
    { value: "all" as const, label: t("setup.entry.home.filterAll", { count: tournaments.length }) },
    ...(user ? [{ value: "mine" as const, label: t("setup.entry.home.filterAssigned", { count: myTournamentsCount }) }] : []),
  ];

  const emptyTitle = user && !isGlobalAdmin
    ? t("setup.entry.home.emptyAssignedTitle")
    : filterTab === "mine"
      ? t("setup.entry.home.emptyMineTitle")
      : t("setup.entry.home.emptyAllTitle");

  return (
    <div className="themed flex min-h-screen flex-col bg-background text-fg">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-surface px-6 py-2.5 max-sm:px-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <EntryBrandLink href="/" className="shrink-0" />
            <p className="truncate text-xs text-fg-muted max-md:hidden">{t("setup.entry.home.tagline")}</p>
          </div>

          <div className="flex shrink-0 items-center gap-2 max-sm:gap-1">
            {authLoading ? null : user ? (
              <>
                <span
                  className="hidden items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs text-fg-muted sm:inline-flex"
                  title={t("setup.entry.signedInAs", { email: user.email || "" })}
                >
                  <UserIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-[160px] truncate font-medium">{user.email}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => logout()}>
                  {t("setup.entry.signOut")}
                </Button>
              </>
            ) : (
              <Link href="/login" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                <span className="max-sm:hidden">{t("setup.entry.home.signInToUpload")}</span>
                <span className="sm:hidden">{t("setup.entry.home.signIn")}</span>
              </Link>
            )}
            <EntryPreferenceControls />
            {isGlobalAdmin && (
              <Button variant="primary" size="sm" onClick={goCreate}>
                <Plus aria-hidden="true" />
                <span className="max-sm:hidden">{t("setup.entry.home.createTournament")}</span>
                <span className="hidden max-sm:inline">{t("setup.entry.home.createShort")}</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-6 py-8 max-sm:px-4 max-sm:py-5">
        <Card className="p-6 max-sm:p-4">
          <PageHeader
            title={t("setup.entry.home.welcomeTitle")}
            description={t("setup.entry.home.welcomeBody")}
            meta={
              <StatusPill tone="success" icon={<CheckCircle2 aria-hidden="true" />}>
                {t("setup.entry.home.offlineBadge")}
              </StatusPill>
            }
          />
        </Card>

        <section aria-labelledby="home-tournaments-heading" className="space-y-4">
          {/* Tournaments header & filters */}
          <div className="flex flex-col justify-between gap-3 border-b border-border pb-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="home-tournaments-heading" className="flex items-center gap-2 text-[15px] font-semibold text-fg">
                <Layers className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
                {t("setup.entry.home.tournamentsHeading")}
              </h2>
              <SegmentedControl
                label={t("setup.entry.home.filterLabel")}
                size="sm"
                value={filterTab}
                options={filterOptions}
                onChange={setFilterTab}
              />
            </div>

            <Button
              size="sm"
              onClick={refreshCloudTournaments}
              loading={isRefreshing}
              loadingText={t("setup.common.loading")}
              title={t("setup.entry.home.refreshHelp")}
            >
              <RefreshCw aria-hidden="true" />
              {t("setup.entry.home.refreshCloud")}
            </Button>
          </div>

          {cloudError && (
            <Alert tone="warning" role="alert">
              {t("setup.entry.home.cloudError")}
            </Alert>
          )}
          {deletedName && (
            <p role="status" className="text-[13px] text-fg-muted">
              {t("setup.entry.home.deleted", { name: deletedName })}
            </p>
          )}

          {/* Tournaments grid */}
          {loadingTournaments ? (
            <div>
              <p role="status" className="sr-only">{t("setup.entry.home.loadingTournaments")}</p>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="space-y-4 p-5">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-8 w-full" />
                  </Card>
                ))}
              </div>
            </div>
          ) : filteredTournaments.length === 0 ? (
            <EmptyState
              className="bg-surface"
              icon={<Layers aria-hidden="true" />}
              title={emptyTitle}
              description={isGlobalAdmin ? t("setup.entry.home.emptyAdminHelp") : t("setup.entry.home.emptyStaffHelp")}
              action={
                isGlobalAdmin ? (
                  <Button variant="primary" onClick={goCreate}>
                    <Plus aria-hidden="true" />
                    {t("setup.entry.home.createTournament")}
                  </Button>
                ) : !user ? (
                  <Link href="/login" className={buttonClasses({ variant: "primary" })}>
                    {t("setup.entry.home.signIn")}
                  </Link>
                ) : null
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filteredTournaments.map((item) => {
                const isMine = Boolean(user && (isGlobalAdmin || item.isOwner));
                return (
                  <li key={item.slug}>
                    <Card
                      className={cn(
                        "flex h-full flex-col justify-between p-5 transition-colors",
                        isMine ? "border-accent/40 hover:border-accent" : "hover:border-border-strong"
                      )}
                    >
                      <div>
                        <div className="mb-2.5 flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone="accent">
                              {item.format === "bp"
                                ? t("setup.entry.home.formatBp")
                                : item.format === "poly" ? t("format.poly") : t("setup.entry.home.formatTwoTeam")}
                            </Badge>
                            {isMine && (
                              <StatusPill tone="success" icon={<Shield aria-hidden="true" />}>
                                {t("setup.entry.home.director")}
                              </StatusPill>
                            )}
                          </div>
                          <span className="truncate font-mono text-xs text-fg-subtle">/{item.slug}</span>
                        </div>

                        <h3 className="mb-1 line-clamp-2 text-base font-semibold leading-snug text-fg">{item.name}</h3>

                        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
                          <Clock className="h-3 w-3 text-fg-subtle" aria-hidden="true" />
                          <span>{t("setup.entry.home.createdOn", { date: formatDateTime(item.createdAt, { dateStyle: "medium" }) })}</span>
                          {item.ownerEmail && (
                            <>
                              <span aria-hidden="true">&bull;</span>
                              <span className="max-w-[160px] truncate">{item.ownerEmail}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                        <div className="flex items-center gap-1">
                          {item.isLocal && (
                            <Link
                              href={`/${item.slug}/public`}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-sm text-xs font-medium text-fg-muted hover:text-fg",
                                focusRing
                              )}
                              aria-label={t("setup.entry.home.publicTabLabel", { name: item.name })}
                            >
                              <span>{t("setup.entry.home.publicTab")}</span>
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </Link>
                          )}

                          {item.isLocal && (
                            <IconButton
                              size="sm"
                              className="hover:text-danger"
                              label={t("setup.entry.home.deleteLabel", { name: item.name })}
                              icon={<Trash2 aria-hidden="true" />}
                              onClick={() => setPendingDelete(item)}
                            />
                          )}
                        </div>

                        <Link href={`/${item.slug}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                          {item.isLocal ? t("setup.entry.home.enterTabRoom") : t("setup.entry.home.openTournament")}
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-surface px-6 py-4 text-center text-xs text-fg-muted">
        {t("setup.entry.home.footer")}
      </footer>

      {pendingDelete && (
        <ConfirmActionDialog
          variant="danger"
          title={t("setup.entry.home.deleteTitle")}
          description={t("setup.entry.home.deleteBody", { name: pendingDelete.name })}
          confirmLabel={t("setup.entry.home.deleteConfirm")}
          onConfirm={() => void handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

