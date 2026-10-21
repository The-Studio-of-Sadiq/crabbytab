import { describe, expect, it } from "vitest";
import {
  meetsRouteRequirement,
  routeRequirement,
  sharedRouteKind,
  tournamentSubpathSegments,
} from "./tournamentRoutes";

const kindOf = (pathname: string, slug: string) => sharedRouteKind(tournamentSubpathSegments(pathname, slug));

describe("shared route detection", () => {
  it("matches the segments after the slug, not substrings of the slug", () => {
    // Regression: `pathname.includes("/public")` made every page of this tournament public.
    expect(kindOf("/public-speaking-open/standings", "public-speaking-open")).toBeNull();
    expect(kindOf("/public-speaking-open", "public-speaking-open")).toBeNull();
    expect(kindOf("/display-cup/draw", "display-cup")).toBeNull();
    expect(kindOf("/private-league/results", "private-league")).toBeNull();
  });

  it("recognises the public site, projector and private portals", () => {
    expect(kindOf("/wudc/public", "wudc")).toBe("public");
    expect(kindOf("/wudc/public/team/t1", "wudc")).toBe("public");
    expect(kindOf("/wudc/schedule/public", "wudc")).toBe("public");
    expect(kindOf("/wudc/checkins/public", "wudc")).toBe("public");
    expect(kindOf("/wudc/audit/public", "wudc")).toBe("public");
    expect(kindOf("/wudc/display", "wudc")).toBe("display");
    expect(kindOf("/wudc/private/team/abc", "wudc")).toBe("private");
    expect(kindOf("/public-speaking-open/public", "public-speaking-open")).toBe("public");
  });

  it("keeps staff pages staff pages", () => {
    expect(kindOf("/wudc/private-urls", "wudc")).toBeNull();
    expect(kindOf("/wudc/schedule", "wudc")).toBeNull();
    expect(kindOf("/wudc/imports/teams", "wudc")).toBeNull();
    expect(kindOf("/other/public", "wudc")).toBeNull();
  });
});

describe("staff route requirements", () => {
  const assistant = (...permissions: string[]) => ({ isOwnerOrAdmin: false, permissions });
  const may = (path: string, access: { isOwnerOrAdmin: boolean; permissions: string[] }) =>
    meetsRouteRequirement(routeRequirement(tournamentSubpathSegments(path, "wudc") ?? []), access);

  it("lets staff with allocation.edit open the allocation editor (Sidebar offers it)", () => {
    expect(may("/wudc/allocation", assistant("allocation.edit"))).toBe(true);
    expect(may("/wudc/allocation", assistant("results.enter"))).toBe(false);
    // Preformed panels are stored on the round, which only administrators write.
    expect(may("/wudc/allocation/panels", assistant("allocation.edit"))).toBe(false);
  });

  it("gates the break, standings and analytics by standings.view", () => {
    for (const path of ["/wudc/break", "/wudc/break/eligibility", "/wudc/standings", "/wudc/analytics"]) {
      expect(may(path, assistant("standings.view"))).toBe(true);
      expect(may(path, assistant("results.enter", "draw.display"))).toBe(false);
    }
    expect(may("/wudc/break/adjudicators", assistant("feedback.view"))).toBe(true);
    expect(may("/wudc/break/adjudicators", assistant("adjudicators.scores_edit"))).toBe(true);
  });

  it("keeps administrator pages for administrators", () => {
    for (const path of ["/wudc/draw", "/wudc/config/draw", "/wudc/staff", "/wudc/private-urls", "/wudc/email",
      "/wudc/audit", "/wudc/imports/venues", "/wudc/imports/motions", "/wudc/imports/assistants"]) {
      expect(may(path, assistant("results.enter", "allocation.edit", "standings.view"))).toBe(false);
      expect(may(path, { isOwnerOrAdmin: true, permissions: [] })).toBe(true);
    }
  });

  it("gates the remaining permission pages and leaves shared staff pages open", () => {
    expect(may("/wudc/checkins", assistant("checkins.edit"))).toBe(true);
    expect(may("/wudc/checkins", assistant("results.enter"))).toBe(false);
    expect(may("/wudc/feedback", assistant("feedback.enter"))).toBe(true);
    expect(may("/wudc/feedback/adjudicator/a1", assistant("feedback.enter"))).toBe(false);
    expect(may("/wudc/feedback/adjudicator/a1", assistant("feedback.view"))).toBe(true);
    expect(may("/wudc/imports/conflicts", assistant("conflicts.view"))).toBe(true);
    expect(may("/wudc/imports/code-names", assistant())).toBe(true);
    expect(may("/wudc/results", assistant())).toBe(true);
    expect(may("/wudc", assistant())).toBe(true);
  });
});
