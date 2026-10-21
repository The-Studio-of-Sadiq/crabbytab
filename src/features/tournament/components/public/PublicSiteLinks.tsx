"use client";

import React from "react";
import Link from "next/link";
import { CalendarDays, CalendarPlus, ClipboardList, History, UserCheck } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { buttonClasses } from "@/components/ui/Button";
import type { MessageKey } from "@/lib/i18n/messages";
import { publicSiteLinks, registrationLinkable, type PublicSiteLinkKey } from "@/lib/publicView/siteLinks";
import type { PublicSiteStatus } from "./usePublicSiteStatus";

const LABELS: Record<PublicSiteLinkKey, MessageKey> = {
  schedule: "publicSiteLinks.schedule",
  calendar: "publicSiteLinks.calendar",
  checkins: "publicSiteLinks.checkins",
  audit: "publicSiteLinks.audit",
  registration: "publicSiteLinks.registration",
};

const ICONS: Record<PublicSiteLinkKey, React.ReactNode> = {
  schedule: <CalendarDays aria-hidden="true" />,
  calendar: <CalendarPlus aria-hidden="true" />,
  checkins: <UserCheck aria-hidden="true" />,
  audit: <History aria-hidden="true" />,
  registration: <ClipboardList aria-hidden="true" />,
};

/**
 * Links to the public pages outside the index's tabs (schedule, calendar feed, check-in status,
 * audit log, registration). Whether the audit log is released and registration is open comes from
 * usePublicSiteStatus, which the page calls once.
 */
export function PublicSiteLinks({
  slug,
  schedule,
  checkins,
  status,
}: {
  slug: string;
  schedule: boolean;
  checkins: boolean;
  status: PublicSiteStatus;
}) {
  const { t } = useI18n();
  const auditReleased = status.auditReleased;
  const registration = registrationLinkable(status.registrationState);

  const links = publicSiteLinks({ slug, schedule, checkins, auditReleased, registration });
  if (links.length === 0) return null;
  return (
    <nav aria-label={t("publicSiteLinks.label")} className="flex flex-wrap gap-2">
      {links.map((link) =>
        link.key === "calendar" ? (
          // A calendar file, not a page: a plain link so the browser hands it to the calendar app.
          <a key={link.key} href={link.href} className={buttonClasses({ variant: "ghost", size: "md" })}>
            {ICONS[link.key]}
            {t(LABELS[link.key])}
          </a>
        ) : (
          <Link key={link.key} href={link.href} className={buttonClasses({ variant: "secondary", size: "md" })}>
            {ICONS[link.key]}
            {t(LABELS[link.key])}
          </Link>
        )
      )}
    </nav>
  );
}
