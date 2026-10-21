"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ExternalLink, Hash } from "lucide-react";
import { PublicAuditEvent } from "@/types";
import { verifyAuditChain } from "@/lib/auditLog";
import { useI18n } from "@/components/i18n/I18nProvider";
import { PublicShell } from "@/components/public/PublicShell";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert, EmptyState } from "@/components/ui/Feedback";
import { PageHeader } from "@/components/ui/PageHeader";

// Sentinel for "no server message": translated at render time so a language switch applies to it.
const LOAD_ERROR = "__load_error__";

interface PublicAuditRelease {
  tournamentName: string;
  releasedAt: string;
  eventCount: number;
  events: PublicAuditEvent[];
}

export default function PublicAuditPage() {
  const params = useParams();
  const slug = typeof params.tournamentSlug === "string" ? params.tournamentSlug : "";
  const [release, setRelease] = useState<PublicAuditRelease | null>(null);
  const [verification, setVerification] = useState<
    { valid: boolean; invalidSequence?: number } | undefined
  >();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const { t, plural, formatDateTime } = useI18n();

  useEffect(() => {
    if (!slug) return;
    let active = true;
    async function loadRelease() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/public/tournaments/${encodeURIComponent(slug)}/audit`,
          { cache: "no-store" }
        );
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || LOAD_ERROR);
        }
        const publicRelease = result as PublicAuditRelease;
        const resultOfVerification = await verifyAuditChain(publicRelease.events);
        if (!active) return;
        setRelease(publicRelease);
        setVerification(resultOfVerification);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : LOAD_ERROR);
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadRelease();
    return () => {
      active = false;
    };
  }, [slug]);

  return (
    <PublicShell
      width="narrow"
      title={release?.tournamentName || t("common.tournament")}
      subtitle={t("publicAudit.eyebrow")}
      backHref={`/${encodeURIComponent(slug)}/public`}
      backLabel={t("public.record.back")}
      actions={
        <Link
          href={`/${encodeURIComponent(slug)}/audit`}
          aria-label={t("publicAudit.admin")}
          className={buttonClasses({ variant: "ghost", size: "sm" })}
        >
          <ExternalLink aria-hidden="true" />
          <span className="hidden sm:inline">{t("publicAudit.admin")}</span>
        </Link>
      }
    >
      <PageHeader
        title={t("publicAudit.heading", { tournament: release?.tournamentName || t("common.tournament") })}
        description={t("publicAudit.description")}
      />

      {loading ? (
        <p role="status" className="py-10 text-center text-[13px] text-fg-muted">{t("publicAudit.loading")}</p>
      ) : error ? (
        <Alert role="alert" tone="warning">{error === LOAD_ERROR ? t("publicAudit.loadError") : error}</Alert>
      ) : release ? (
        <>
          <div role="status">
            <Alert
              tone={verification?.valid ? "success" : "danger"}
              title={
                verification?.valid
                  ? t("publicAudit.verified")
                  : verification?.invalidSequence
                    ? t("publicAudit.failedAt", { entry: verification.invalidSequence })
                    : t("publicAudit.failed")
              }
            >
              {plural("publicAudit.snapshot", release.eventCount, { time: formatDateTime(release.releasedAt) })}
            </Alert>
          </div>

          {release.events.length === 0 ? (
            <EmptyState icon={<Hash />} title={t("publicAudit.empty")} />
          ) : (
            <ol className="space-y-3">
              {[...release.events].reverse().map((event) => (
                <li key={event.sequence}>
                  <Card className="p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-fg">{event.summary}</p>
                        <p className="mt-1 text-xs text-fg-muted">
                          {t("publicAudit.entry", { category: event.category, action: event.action, sequence: event.sequence })}
                        </p>
                      </div>
                      <time className="shrink-0 text-xs text-fg-muted" dateTime={event.timestamp}>
                        {formatDateTime(event.timestamp)}
                      </time>
                    </div>
                    <div className="mt-3 flex items-start gap-2 rounded-md bg-muted p-2">
                      <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                      <div className="min-w-0 space-y-1 font-mono text-[11px] text-fg-muted">
                        <p className="break-all">{t("publicAudit.hash", { hash: event.hash })}</p>
                        <p className="break-all">{t("publicAudit.previousHash", { hash: event.previousHash })}</p>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </PublicShell>
  );
}
