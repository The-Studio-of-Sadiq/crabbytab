"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, ExternalLink, Hash, ShieldAlert } from "lucide-react";
import { PublicAuditEvent } from "@/types";
import { verifyAuditChain } from "@/lib/auditLog";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

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
    <main className="mx-auto max-w-4xl space-y-5 py-6">
      <header className="flex flex-col gap-3 border-b border-[#d0d7de] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{t("publicAudit.eyebrow")}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">
            {t("publicAudit.heading", { tournament: release?.tournamentName || t("common.tournament") })}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {t("publicAudit.description")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/${encodeURIComponent(slug)}/audit`}
            className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-900"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t("publicAudit.admin")}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      {loading ? (
        <p role="status" className="py-10 text-center text-sm text-gray-500">{t("publicAudit.loading")}</p>
      ) : error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
          <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-amber-600" />
          <p className="text-sm text-gray-700">{error === LOAD_ERROR ? t("publicAudit.loadError") : error}</p>
        </div>
      ) : release ? (
        <>
          <section
            className={`flex items-start gap-3 rounded-lg border p-4 ${
              verification?.valid
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
            role="status"
          >
            {verification?.valid ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <div>
              <p className="text-sm font-semibold">
                {verification?.valid
                  ? t("publicAudit.verified")
                  : verification?.invalidSequence
                    ? t("publicAudit.failedAt", { entry: verification.invalidSequence })
                    : t("publicAudit.failed")}
              </p>
              <p className="mt-1 text-xs">
                {plural("publicAudit.snapshot", release.eventCount, { time: formatDateTime(release.releasedAt) })}
              </p>
            </div>
          </section>

          {release.events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
              {t("publicAudit.empty")}
            </p>
          ) : (
            <ol className="space-y-3">
              {[...release.events].reverse().map((event) => (
                <li
                  key={event.sequence}
                  className="rounded-lg border border-[#d0d7de] bg-white p-4 shadow-xs"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{event.summary}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {t("publicAudit.entry", { category: event.category, action: event.action, sequence: event.sequence })}
                      </p>
                    </div>
                    <time
                      className="shrink-0 text-xs text-gray-500"
                      dateTime={event.timestamp}
                    >
                      {formatDateTime(event.timestamp)}
                    </time>
                  </div>
                  <div className="mt-3 flex items-start gap-2 rounded bg-gray-50 p-2">
                    <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
                    <div className="min-w-0 space-y-1 font-mono text-[10px] text-gray-600">
                      <p className="break-all">{t("publicAudit.hash", { hash: event.hash })}</p>
                      <p className="break-all">{t("publicAudit.previousHash", { hash: event.previousHash })}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : null}
    </main>
  );
}
