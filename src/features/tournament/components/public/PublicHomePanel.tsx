"use client";

import React from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LazyMarkdown } from "@/components/markdown/LazyMarkdown";
import { buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";

/**
 * The public page's Home tab: the organiser's homepage (Markdown, rendered safely and loaded only
 * here), or the plain-text welcome message when there is no homepage, the staff credits, and a
 * Register button while public registration is open.
 */
export function PublicHomePanel({
  slug,
  homepage,
  welcomeMessage,
  staff,
  registrationOpen,
  nothingElsePublished,
}: {
  slug: string;
  homepage: string;
  welcomeMessage: string;
  staff: string;
  registrationOpen: boolean;
  /** No other tab is public yet. */
  nothingElsePublished: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      {registrationOpen && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-subtle px-4 py-3">
          <p className="text-sm font-medium text-fg">{t("public.home.registrationOpen")}</p>
          <Link href={`/register/${encodeURIComponent(slug)}`} className={buttonClasses({ variant: "primary", size: "lg" })}>
            <ClipboardList aria-hidden="true" />
            {t("public.home.register")}
          </Link>
        </div>
      )}
      {homepage ? (
        <Card className="p-4 sm:p-6">
          <LazyMarkdown source={homepage} videoTitle={t("public.home.videoTitle")} />
        </Card>
      ) : welcomeMessage ? (
        <Card className="overflow-hidden">
          <CardHeader title={t("public.welcomeTitle")} />
          <p className="whitespace-pre-line p-4 text-sm text-fg">{welcomeMessage}</p>
        </Card>
      ) : (
        <p className="text-sm text-fg-muted">{nothingElsePublished ? t("public.nothingPublished") : t("public.home.intro")}</p>
      )}
      {staff && (
        <Card className="overflow-hidden">
          <CardHeader title={t("public.staffTitle")} />
          <p className="whitespace-pre-line p-4 text-sm text-fg">{staff}</p>
        </Card>
      )}
    </div>
  );
}
