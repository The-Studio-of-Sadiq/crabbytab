import { describe, expect, it } from "vitest";
import type { Debate } from "@/types";
import {
  parseVenueCategoryList,
  venueCategoryNames,
  venueDisplayName,
  venueInCategory,
  venueTooltip,
  withVenueCategories,
} from "./venues";
import { getVenueIncompatibilities } from "@/lib/draw/venueAllocator";
import { parseVenuesCsv } from "@/lib/csv/importer";

describe("rooms in several categories", () => {
  it("reads the old single category and the new list together", () => {
    expect(venueCategoryNames({ category: "Large" })).toEqual(["Large"]);
    expect(venueCategoryNames({ category: "Large", categories: ["large", " Accessible ", ""] })).toEqual(["Large", "Accessible"]);
    expect(venueCategoryNames({})).toEqual([]);
  });

  it("matches any of the room's categories, ignoring case", () => {
    const room = { category: "Large", categories: ["Large", "Accessible"] };
    expect(venueInCategory(room, "accessible")).toBe(true);
    expect(venueInCategory(room, "large")).toBe(true);
    expect(venueInCategory(room, "online")).toBe(false);
    expect(venueInCategory({ category: "Large" }, "")).toBe(false);
  });

  it("keeps the first category in the old field and clears the list for one category", () => {
    expect(withVenueCategories({ name: "A" }, ["Accessible", "Large"])).toEqual({
      name: "A",
      category: "Accessible",
      categories: ["Accessible", "Large"],
    });
    expect(withVenueCategories({ name: "A", categories: ["x", "y"] }, ["Large"])).toEqual({ name: "A", category: "Large", categories: undefined });
    expect(withVenueCategories({ name: "A", category: "Large" }, [])).toEqual({ name: "A", category: undefined, categories: undefined });
    expect(parseVenueCategoryList("Accessible; Large, accessible")).toEqual(["Accessible", "Large"]);
  });

  it("satisfies a required category held as a second category", () => {
    const debate = { requiredVenueCategory: "Accessible" } as Debate;
    expect(getVenueIncompatibilities(debate, { id: "v", tournamentId: "t", name: "A", priority: 1, category: "Large", categories: ["Large", "Accessible"] })).toEqual([]);
    expect(getVenueIncompatibilities(debate, { id: "v", tournamentId: "t", name: "A", priority: 1, category: "Large" })).toHaveLength(1);
  });

  it("shows every category's prefix, suffix and description", () => {
    const info = [
      { name: "Large", displayInName: "prefix" as const, description: "has 200 seats" },
      { name: "Accessible", displayInName: "suffix" as const, description: "has step-free access.", publicTooltip: true },
    ];
    const room = { name: "Hall", category: "Large", categories: ["Large", "Accessible"] };
    expect(venueDisplayName(room, info)).toBe("Large Hall Accessible");
    expect(venueTooltip(room, info, "admin")).toBe("This room has 200 seats. This room has step-free access.");
    expect(venueTooltip(room, info, "public")).toBe("This room has step-free access.");
  });

  it("imports several categories from one CSV cell", () => {
    const [venue] = parseVenuesCsv('name,priority,category\nHall,10,"Large; Accessible"\n', "t");
    expect(venue).toMatchObject({ category: "Large", categories: ["Large", "Accessible"] });
    const [single] = parseVenuesCsv("name,priority,category\nRoom,10,Main\n", "t");
    expect(single.category).toBe("Main");
    expect(single.categories).toBeUndefined();
  });
});
