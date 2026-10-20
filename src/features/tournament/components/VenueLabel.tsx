"use client";

import React from "react";
import { ExternalLink } from "lucide-react";
import type { Debate, Venue, VenueCategoryInfo } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { safeVenueUrl, venueDisplayName, venueTooltip } from "@/lib/venues/venues";

/**
 * A debate's room: its display name (with the category prefix/suffix when configured), the
 * category description as a tooltip, and the room link (online meeting or map) when it has one.
 */
export function VenueLabel({
  debate,
  venues,
  categories,
  audience,
  fallback,
}: {
  debate: Pick<Debate, "venueId" | "venueName">;
  venues: Array<Pick<Venue, "id" | "name" | "category" | "url">>;
  categories: VenueCategoryInfo[] | undefined;
  audience: "admin" | "public";
  fallback?: string;
}) {
  const { t } = useI18n();
  const venue = debate.venueId ? venues.find((item) => item.id === debate.venueId) : undefined;
  const name = venue ? venueDisplayName(venue, categories) : debate.venueName || fallback || "";
  const url = safeVenueUrl(venue?.url);
  return (
    <span className="inline-flex items-center gap-1" title={venue ? venueTooltip(venue, categories, audience) : undefined}>
      <span>{name}</span>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 text-blue-700 underline hover:text-blue-900 dark:text-blue-300"
          aria-label={t("venue.openLink", { name })}
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          <span className="text-[11px] font-semibold">{t("venue.joinMap")}</span>
        </a>
      )}
    </span>
  );
}
