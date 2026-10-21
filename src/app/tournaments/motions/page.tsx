"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { BallotSubmission, Debate, Motion, Tournament } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { SetupShell } from "@/components/setup/SetupShell";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Checkbox } from "@/components/ui/Field";
import { Card, CardBody } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/PageHeader";
import { CrossTournamentMotionTable } from "@/features/tournament/components/CrossTournamentMotionTable";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import { getLocalStore, readLocalTournamentMetas, tournamentKeyPrefix } from "@/lib/offline/localStore";
import { safeJsonParse } from "@/lib/safeJson";
import {
  crossTournamentMotionStatistics,
  type TournamentMotionData,
} from "@/lib/motions/crossTournament";

type Meta = Pick<Tournament, "id" | "name" | "slug" | "format" | "ownerId">;

async function readDeviceMetas(): Promise<Meta[]> {
  const metas: Meta[] = [];
  for (const { raw } of await readLocalTournamentMetas(getLocalStore())) {
    const value = safeJsonParse<Partial<Tournament> | null>(raw, null);
    if (value?.id && value.slug && value.name && value.format) {
      metas.push({ id: value.id, slug: value.slug, name: value.name, format: value.format, ownerId: value.ownerId ?? "" });
    }
  }
  return metas;
}

async function readWorkingCopy(meta: Meta): Promise<TournamentMotionData> {
  const store = getLocalStore();
  const prefix = tournamentKeyPrefix(meta.slug);
  const [motions, debates, ballots] = await Promise.all([
    store.read(`${prefix}motions`),
    store.read(`${prefix}debates`),
    store.read(`${prefix}ballots`),
  ]);
  return {
    tournament: meta,
    motions: safeJsonParse<Motion[]>(motions, []),
    debates: safeJsonParse<Debate[]>(debates, []),
    ballots: safeJsonParse<BallotSubmission[]>(ballots, []),
  };
}

/**
 * Motion statistics across the tournaments you run, computed from their working copies on this
 * device: no cloud reads, and nothing from tournaments where you are not an administrator.
 */
export default function CrossTournamentMotionsPage() {
  const { user, loading: authLoading } = useAuth();
  const { t, formatList } = useI18n();
  const [data, setData] = useState<TournamentMotionData[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // Error text from the server, or a message key; resolved at render so a language change does not reload.
  const [error, setError] = useState<{ message: string } | { key: "adminCheckFailed" | "loadFailed" } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const metas = await readDeviceMetas();
        let adminIds = new Set<string>();
        const notOnDevice: string[] = [];
        if (user) {
          const token = await user.getIdToken();
          const response = await fetch("/api/tournaments", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
          const result = (await response.json()) as { error?: string; tournaments?: Array<{ id: string; name: string; accessRole?: string }> };
          if (!response.ok) {
            if (active) setError(result.error ? { message: result.error } : { key: "adminCheckFailed" });
            return;
          }
          const administered = (result.tournaments || []).filter((item) => item.accessRole === "admin");
          adminIds = new Set(administered.map((item) => item.id));
          const local = new Set(metas.map((meta) => meta.id));
          notOnDevice.push(...administered.filter((item) => !local.has(item.id)).map((item) => item.name));
        }
        // Device-only tournaments (created signed out) belong to whoever runs this device.
        const allowed = metas.filter((meta) => adminIds.has(meta.id) || meta.ownerId === "local");
        const copies = await Promise.all(allowed.map(readWorkingCopy));
        if (!active) return;
        const withMotions = copies.filter((copy) => copy.motions.length > 0);
        setData(withMotions);
        setSelected(new Set(withMotions.map((copy) => copy.tournament.id)));
        setMissing(notOnDevice);
      } catch (caught) {
        if (active) setError(caught instanceof Error && caught.message ? { message: caught.message } : { key: "loadFailed" });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authLoading, user]);

  const statistics = useMemo(
    () => crossTournamentMotionStatistics(data.filter((copy) => selected.has(copy.tournament.id))),
    [data, selected]
  );

  const errorText = error === null
    ? ""
    : "message" in error
      ? error.message
      : t(error.key === "adminCheckFailed" ? "setup.entry.motions.adminCheckFailed" : "setup.entry.motions.loadFailed");

  return (
    <SetupShell maxWidth="max-w-5xl">
      <div className="space-y-6">
        <PageHeader
          title={t("setup.entry.motions.title")}
          description={t("setup.entry.motions.intro")}
          actions={
            <Link href="/tournaments/motions/public" className={cn("rounded-sm text-sm font-medium text-accent-text hover:underline", focusRing)}>
              {t("setup.entry.motions.publicLink")}
            </Link>
          }
        />

        {errorText && <Alert tone="danger" role="alert">{errorText}</Alert>}
        {loading && (
          <div className="space-y-3">
            <p role="status" className="text-[13px] text-fg-muted">{t("setup.entry.motions.loading")}</p>
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {!loading && data.length === 0 && !error && (
          <EmptyState title={t("setup.entry.motions.emptyTitle")} description={t("setup.entry.motions.emptyBody")} />
        )}

        {data.length > 0 && (
          <Card>
            <CardBody>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-fg">{t("setup.entry.motions.tournamentsLegend")}</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {data.map((copy) => (
                    <Checkbox
                      key={copy.tournament.id}
                      checked={selected.has(copy.tournament.id)}
                      onChange={(event) => setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(copy.tournament.id);
                        else next.delete(copy.tournament.id);
                        return next;
                      })}
                      label={
                        <span className="inline-flex items-center gap-2">
                          {copy.tournament.name}
                          <span className="text-xs uppercase text-fg-muted">
                            {copy.tournament.format === "bp" ? t("setup.entry.motions.formatBp") : t("setup.entry.motions.formatTwoTeam")}
                          </span>
                        </span>
                      }
                    />
                  ))}
                </div>
                {missing.length > 0 && (
                  <p className="mt-3 text-xs text-fg-muted">
                    {t("setup.entry.motions.notOnDevice", { names: formatList(missing) })}
                  </p>
                )}
              </fieldset>
            </CardBody>
          </Card>
        )}

        {statistics.length > 0 && <CrossTournamentMotionTable statistics={statistics} />}

        <Link
          href="/tournaments"
          className={cn("inline-block rounded-sm text-sm font-medium text-accent-text hover:underline", focusRing)}
        >
          {t("setup.entry.motions.backLink")}
        </Link>
      </div>
    </SetupShell>
  );
}
