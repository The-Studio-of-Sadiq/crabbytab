"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import { ExternalLink, Globe, Hash, History } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/components/ui/cn";
import { focusRing } from "@/components/ui/focus";
import type { MessageKey } from "@/lib/i18n/messages";

interface AuditReleaseStatus {
  releasedAt: string;
  eventCount: number;
}

/** A server-supplied message (shown verbatim), a translated error, or the publish confirmation. */
type ReleaseNotice = { text: string } | { key: MessageKey } | { published: number };

function errorNotice(caught: unknown, fallback: MessageKey): ReleaseNotice {
  return caught instanceof Error && caught.message ? { text: caught.message } : { key: fallback };
}

export default function AuditPage() {
  const { t, plural, formatDateTime } = useI18n();
  const { auditEvents, isOwnerOrAdmin, loading, tournament, releaseAuditLog } = useTournament();
  const [release, setRelease] = useState<AuditReleaseStatus | null>(null);
  const [releaseStatusLoading, setReleaseStatusLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [releaseMessage, setReleaseMessage] = useState<ReleaseNotice | null>(null);
  const orderedAuditEvents = [...auditEvents].sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)
  );

  useEffect(() => {
    if (!tournament?.slug) return;
    let active = true;
    setReleaseStatusLoading(true);
    fetch(`/api/public/tournaments/${encodeURIComponent(tournament.slug)}/audit?status=1`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!active) return;
        if (response.status === 404) {
          setRelease(null);
        } else if (!response.ok) {
          throw new Error(result.error || "");
        } else {
          setRelease({
            releasedAt: result.releasedAt,
            eventCount: result.eventCount,
          });
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        setReleaseMessage(errorNotice(error, "setup.staff.audit.statusError"));
      })
      .finally(() => {
        if (active) setReleaseStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tournament?.slug]);

  const publishAuditLog = async () => {
    setReleasing(true);
    setReleaseMessage(null);
    try {
      const result = await releaseAuditLog();
      setRelease(result);
      setReleaseMessage({ published: result.eventCount });
    } catch (error) {
      setReleaseMessage(errorNotice(error, "setup.staff.audit.releaseError"));
    } finally {
      setReleasing(false);
    }
  };

  const renderReleaseMessage = (notice: ReleaseNotice) => {
    if ("text" in notice) return notice.text;
    if ("published" in notice) return plural("setup.staff.audit.published", notice.published);
    return t(notice.key);
  };

  if (!loading && !isOwnerOrAdmin) {
    return (
      <div className="mx-auto my-12 max-w-xl space-y-4">
        <PageHeader title={t("setup.staff.audit.title")} />
        <Alert tone="warning" title={t("setup.staff.audit.unavailableTitle")}>
          {t("setup.staff.audit.unavailableBody")}
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <History className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
            {t("setup.staff.audit.title")}
          </span>
        }
        description={t("setup.staff.audit.description")}
        actions={<Badge className="font-mono">{plural("setup.staff.audit.eventCount", auditEvents.length)}</Badge>}
      />

      {!loading && isOwnerOrAdmin && (
        <Card>
          <CardHeader
            icon={<Globe aria-hidden="true" />}
            title={t("setup.staff.audit.publicTitle")}
            description={t("setup.staff.audit.publicDescription")}
            actions={
              <>
                {release && (
                  <Link
                    href={`/${encodeURIComponent(tournament?.slug || "")}/audit/public`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClasses({ variant: "secondary", size: "sm" })}
                  >
                    <ExternalLink aria-hidden="true" />
                    {t("setup.staff.audit.viewPublic")}
                  </Link>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={publishAuditLog}
                  disabled={releasing || releaseStatusLoading}
                >
                  {releasing
                    ? t("setup.staff.audit.releasing")
                    : release
                      ? t("setup.staff.audit.updateSnapshot")
                      : t("setup.staff.audit.release")}
                </Button>
              </>
            }
          />
          {(release || releaseMessage) && (
            <CardBody className="space-y-1 py-3">
              {release && (
                <p className="text-xs text-fg-muted">
                  {plural("setup.staff.audit.lastReleased", release.eventCount, {
                    time: formatDateTime(release.releasedAt),
                  })}
                </p>
              )}
              {releaseMessage && (
                <p className="text-xs text-fg" role="status">{renderReleaseMessage(releaseMessage)}</p>
              )}
            </CardBody>
          )}
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">
          <p role="status" className="text-[13px] text-fg-muted">{t("setup.staff.audit.loading")}</p>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : orderedAuditEvents.length === 0 ? (
        <EmptyState icon={<History aria-hidden="true" />} title={t("setup.staff.audit.empty")} />
      ) : (
        <ol className="space-y-3">
          {orderedAuditEvents.map((event) => (
            <li key={event.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  {/* Audit summaries are recorded data: shown as written, never translated. */}
                  <p className="text-[13px] font-medium text-fg">{event.summary}</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    {event.actorName ||
                      (event.actorType === "system" ? t("setup.staff.audit.actorSystem") : t("setup.staff.audit.actorPublic"))}
                    {" · "}
                    <span className="font-mono">{event.category}</span>
                    {" · "}
                    <span className="font-mono">{event.action}</span>
                  </p>
                </div>
                <time className="shrink-0 text-xs text-fg-muted" dateTime={event.timestamp}>
                  {formatDateTime(event.timestamp)}
                </time>
              </div>
              {event.hash && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-muted p-2">
                  <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                  <span className="sr-only">{t("setup.staff.audit.hashLabel")}</span>
                  <p className="break-all font-mono text-[11px] text-fg-muted">{event.hash}</p>
                </div>
              )}
              {!event.hash && release && (
                <Alert tone="warning" className="mt-2 p-2 text-xs">
                  {t("setup.staff.audit.unreleased")}
                </Alert>
              )}
              {(event.roundId || event.debateId) && (
                <p className="mt-2 text-[11px] text-fg-muted">
                  {event.roundId && <span>{t("setup.staff.audit.round", { id: event.roundId })}</span>}
                  {event.roundId && event.debateId && " · "}
                  {event.debateId && <span>{t("setup.staff.audit.debate", { id: event.debateId })}</span>}
                </p>
              )}
              {event.details && Object.keys(event.details).length > 0 && (
                <details className="mt-3">
                  <summary className={cn("cursor-pointer rounded-sm text-xs font-medium text-accent-text", focusRing)}>
                    {t("setup.staff.audit.details")}
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] text-fg">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
