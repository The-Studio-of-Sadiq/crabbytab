/**
 * Links from the public tournament index to the public pages that live outside its tabs (Tabbycat
 * tournament-public-index): the schedule and its calendar feed, the check-in status, the released
 * audit log and the registration form. Each appears only while that page is switched on, so
 * visitors never follow a link to a "disabled" page.
 */

export type PublicSiteLinkKey = "schedule" | "calendar" | "checkins" | "audit" | "registration";

export interface PublicSiteLink {
  key: PublicSiteLinkKey;
  href: string;
}

export function publicSiteLinks(input: {
  slug: string;
  /** `preferences.publicSchedule` */
  schedule: boolean;
  /** `preferences.publicCheckInStatus` */
  checkins: boolean;
  /** An audit log release exists. */
  auditReleased: boolean;
  /** The registration form is open (or opens later). */
  registration: boolean;
}): PublicSiteLink[] {
  const slug = encodeURIComponent(input.slug);
  const links: PublicSiteLink[] = [];
  if (input.schedule) {
    links.push({ key: "schedule", href: `/${slug}/schedule/public` });
    links.push({ key: "calendar", href: `/api/public/tournaments/${slug}/schedule/ical` });
  }
  if (input.checkins) links.push({ key: "checkins", href: `/${slug}/checkins/public` });
  if (input.auditReleased) links.push({ key: "audit", href: `/${slug}/audit/public` });
  if (input.registration) links.push({ key: "registration", href: `/register/${slug}` });
  return links;
}

/** Registration form states worth linking to: open now, or opening later. */
export function registrationLinkable(state: unknown): boolean {
  return state === "open" || state === "not_open";
}
