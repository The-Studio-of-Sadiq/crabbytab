import { describe, expect, it } from "vitest";
import { publicSiteLinks, registrationLinkable } from "./siteLinks";

describe("public site links", () => {
  // Regression: these public pages existed but nothing on the public site linked to them.
  it("links each enabled public page from the public index", () => {
    const links = publicSiteLinks({ slug: "wudc", schedule: true, checkins: true, auditReleased: true, registration: true });
    expect(links).toEqual([
      { key: "schedule", href: "/wudc/schedule/public" },
      { key: "calendar", href: "/api/public/tournaments/wudc/schedule/ical" },
      { key: "checkins", href: "/wudc/checkins/public" },
      { key: "audit", href: "/wudc/audit/public" },
      { key: "registration", href: "/register/wudc" },
    ]);
  });

  it("leaves out disabled pages", () => {
    expect(publicSiteLinks({ slug: "wudc", schedule: false, checkins: false, auditReleased: false, registration: false })).toEqual([]);
    expect(publicSiteLinks({ slug: "wudc", schedule: false, checkins: true, auditReleased: false, registration: false }).map((link) => link.key))
      .toEqual(["checkins"]);
  });

  it("links registration only while it is open or about to open", () => {
    expect(registrationLinkable("open")).toBe(true);
    expect(registrationLinkable("not_open")).toBe(true);
    expect(registrationLinkable("closed")).toBe(false);
    expect(registrationLinkable("disabled")).toBe(false);
  });
});
