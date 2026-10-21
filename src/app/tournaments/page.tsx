"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileUp, FlaskConical, Loader2, Plus, Search } from "lucide-react";
import {
  FieldPath,
  collection,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  where,
} from "firebase/firestore";
import type { Tournament } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebase";
import { getLocalStore, readLocalTournamentMetas } from "@/lib/offline/localStore";

async function readDeviceTournaments() {
  try {
    return await readLocalTournamentMetas(getLocalStore());
  } catch (error) {
    console.warn("Could not read tournaments saved on this device:", error);
    return [];
  }
}
import { SetupShell } from "@/components/setup/SetupShell";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";

type Summary = Pick<Tournament, "id" | "name" | "slug" | "format" | "createdAt"> & {
  accessRole?: "admin" | "dataEntry";
};

function toSummary(id: string, data: Record<string, any>): Summary {
  const slug: string = data.slug || id.replace(/^tourn-/, "");
  return {
    id,
    slug,
    name: data.name || slug,
    format: data.format || "bp",
    createdAt: data.createdAt || "",
  };
}

function mergeById(lists: Summary[][]): Summary[] {
  const map = new Map<string, Summary>();
  lists.flat().forEach((t) => map.set(t.id, t));
  return Array.from(map.values());
}

function TournamentRow({ t: tournament }: { t: Summary }) {
  const { t } = useI18n();
  const isMine = tournament.accessRole === "admin";
  return (
    <li>
      <Link
        href={`/${tournament.slug}`}
        className={cn("flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted", focusRing, "focus-visible:ring-offset-0")}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{tournament.name}</p>
          <p className="text-xs text-fg-muted">
            <span className="font-mono">/{tournament.slug}</span> · {t(`format.${tournament.format}`)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {isMine && <Badge tone="accent">{t("setup.entry.list.adminBadge")}</Badge>}
          <ArrowRight className="h-4 w-4 text-fg-subtle" aria-hidden="true" />
        </div>
      </Link>
    </li>
  );
}

export default function TournamentsHubPage() {
  const { user, configured, isGlobalAdmin, loading: authLoading } = useAuth();
  const { t, rich } = useI18n();

  const [mine, setMine] = useState<Summary[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);
  // Server error text, or "" for the generic message (kept out of the effect so a language
  // change does not reload the list).
  const [mineError, setMineError] = useState<{ message: string } | null>(null);

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Summary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const searchSeq = useRef(0);

  // Signed-in users only receive their authorized tournaments from the server.
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    setMine([]);
    setMineError(null);
    setLoadingMine(true);
    void (async () => {
      if (!user) {
        if (typeof window !== "undefined") {
          const local: Summary[] = [];
          for (const { key, raw } of await readDeviceTournaments()) {
            try {
              const value = JSON.parse(raw) as Partial<Tournament> | null;
              if (value?.id && value.slug && value.name && value.format && value.createdAt) {
                local.push({
                  id: value.id,
                  slug: value.slug,
                  name: value.name,
                  format: value.format,
                  createdAt: value.createdAt,
                });
              }
            } catch (error) {
              console.warn(`Could not read local tournament at ${key}:`, error);
            }
          }
          if (active) setMine(local.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        }
        if (active) setLoadingMine(false);
        return;
      }

      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/tournaments", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json() as { error?: string; tournaments?: Summary[] };
        if (!response.ok) throw new Error(result.error || "");
        const accessible = result.tournaments || [];
        const merged = new Map(accessible.map((tournament) => [tournament.id, tournament]));
        if (typeof window !== "undefined") {
          for (const { key, raw } of await readDeviceTournaments()) {
            try {
              const value = JSON.parse(raw) as Partial<Tournament> | null;
              if (
                value?.id && value.slug && value.name && value.format && value.createdAt &&
                isGlobalAdmin &&
                !merged.has(value.id)
              ) {
                merged.set(value.id, {
                  id: value.id,
                  slug: value.slug,
                  name: value.name,
                  format: value.format,
                  createdAt: value.createdAt,
                });
              }
            } catch (error) {
              console.warn(`Could not read local tournament at ${key}:`, error);
            }
          }
        }
        if (active) setMine([...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      } catch (error) {
        if (active) setMineError({ message: error instanceof Error ? error.message : "" });
      } finally {
        if (active) setLoadingMine(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authLoading, isGlobalAdmin, user]);

  // Search: prefix match on slug and on the lowercase name, debounced.
  useEffect(() => {
    const q = term.trim().toLowerCase();
    if (!q || (user && !isGlobalAdmin)) {
      setResults(null);
      setSearchError(false);
      setSearching(false);
      return;
    }
    if (!db) return;

    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const col = collection(db!, "tournaments");
        const byField = (field: string) =>
          getDocs(query(col, orderBy(field), startAt(q), endAt(q + "\uf8ff"), limit(20)));
        const [bySlug, byName] = await Promise.all([byField("slug"), byField("nameLower")]);
        if (seq !== searchSeq.current) return; // a newer search superseded this one
        setResults(
          mergeById([
            bySlug.docs.map((d) => toSummary(d.id, d.data())),
            byName.docs.map((d) => toSummary(d.id, d.data())),
          ])
        );
        setSearchError(false);
      } catch (e) {
        console.warn("Search failed:", e);
        if (seq === searchSeq.current) setSearchError(true);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [term, user, isGlobalAdmin]);

  const code = (text: string) => <code className="font-mono">{text}</code>;
  const sideLinkClass = cn(
    "inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-accent-text hover:underline [&_svg]:h-3.5 [&_svg]:w-3.5",
    focusRing
  );

  return (
    <SetupShell>
      <div className="space-y-8">
        <PageHeader
          title={user?.displayName ? t("setup.entry.list.welcomeNamed", { name: user.displayName }) : t("setup.entry.list.welcome")}
          description={t("setup.entry.list.intro")}
        />

        {/* Create */}
        {isGlobalAdmin && (
          <div className="space-y-3">
            <Link
              href="/tournaments/new"
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-5 transition-colors hover:border-accent",
                focusRing
              )}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg">
                  <Plus className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-fg">{t("setup.entry.list.createTitle")}</p>
                  <p className="text-xs text-fg-muted">{t("setup.entry.list.createBody")}</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            </Link>
            <div className="flex flex-col items-start gap-2">
              <Link href="/tournaments/import" className={sideLinkClass}>
                <FileUp aria-hidden="true" />
                {t("setup.entry.list.importLink")}
              </Link>
              <Link href="/tournaments/demo" className={sideLinkClass}>
                <FlaskConical aria-hidden="true" />
                {t("setup.entry.list.demoLink")}
              </Link>
            </div>
          </div>
        )}

        {/* Search */}
        {(!user || isGlobalAdmin) && (
          <Card>
            <CardHeader title={t("setup.entry.list.findHeading")} icon={<Search aria-hidden="true" />} />
            <CardBody className="space-y-3">
              {!configured || !db ? (
                <Alert tone="warning" title={t("setup.entry.firebaseNotConfiguredTitle")}>
                  {rich("setup.entry.list.firebaseNotConfigured", { code })}
                </Alert>
              ) : (
                <>
                  <Input
                    type="search"
                    label={t("setup.entry.list.searchLabel")}
                    help={t("setup.entry.list.searchHelp")}
                    leadingIcon={<Search aria-hidden="true" />}
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    placeholder={t("setup.entry.list.searchPlaceholder")}
                  />
                  <div role="status" className="text-xs text-fg-muted empty:hidden">
                    {searching && (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        {t("setup.entry.list.searching")}
                      </span>
                    )}
                  </div>

                  {searchError && <Alert tone="danger" role="alert">{t("setup.entry.list.searchFailed")}</Alert>}

                  {results && (
                    <div className="rounded-lg border border-border">
                      {results.length === 0 && !searching ? (
                        <p className="px-4 py-6 text-center text-[13px] text-fg-muted">
                          {t("setup.entry.list.noResults", { term: term.trim() })}
                        </p>
                      ) : (
                        <ul aria-label={t("setup.entry.list.searchResults")} className="divide-y divide-border">
                          {results.map((tournament) => (
                            <TournamentRow key={tournament.id} t={tournament} />
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        )}

        {/* Mine */}
        <Card>
          <CardHeader title={user ? t("setup.entry.list.assignedHeading") : t("setup.entry.list.deviceHeading")} />
          {mineError && (
            <div className="border-b border-border p-4">
              <Alert tone="danger" role="alert">{mineError.message || t("setup.entry.list.loadFailed")}</Alert>
            </div>
          )}
          {loadingMine ? (
            <div className="space-y-3 p-4">
              <p role="status" className="sr-only">{t("setup.entry.list.loading")}</p>
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : mine.length === 0 ? (
            <EmptyState
              className="m-4"
              title={user ? t("setup.entry.list.emptyAssigned") : t("setup.entry.list.emptyDevice")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {mine.map((tournament) => (
                <TournamentRow key={tournament.id} t={tournament} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </SetupShell>
  );
}
