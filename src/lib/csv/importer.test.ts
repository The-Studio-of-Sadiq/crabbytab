import { describe, it, expect } from "vitest";
import { parseTeamsCsv, parseAdjudicatorsCsv, parseInstitutionsCsv, parseVenuesCsv } from "./importer";

describe("CSV Importer (csv/importer)", () => {
  it("parses teams with standard and alias headers", () => {
    const csvWithStandardHeaders = `name,institution,speaker1,speaker2,category
Harvard A,Harvard,Alice,Bob,ESL
Yale B,Yale,Charlie,David,Novice`;

    const teams1 = parseTeamsCsv(csvWithStandardHeaders, "t1");
    expect(teams1).toHaveLength(2);
    expect(teams1[0].name).toBe("Harvard A");
    expect(teams1[0].institutionName).toBe("Harvard");
    expect(teams1[0].speakers).toHaveLength(2);
    expect(teams1[0].speakers[0].name).toBe("Alice");
    expect(teams1[0].speakers[1].name).toBe("Bob");
    expect(teams1[0].speakerCategories).toEqual(["esl"]);

    // Test alias headers: Team, inst, Speaker 1, Speaker 2
    const csvWithAliasHeaders = `Team,inst,Speaker 1,Speaker 2
Oxford A,Oxford,Emma,Frank`;
    const teams2 = parseTeamsCsv(csvWithAliasHeaders, "t1");
    expect(teams2).toHaveLength(1);
    expect(teams2[0].name).toBe("Oxford A");
    expect(teams2[0].institutionName).toBe("Oxford");
    expect(teams2[0].speakers[0].name).toBe("Emma");
    expect(teams2[0].speakers[1].name).toBe("Frank");
  });

  it("imports team division IDs and names", () => {
    const teams = parseTeamsCsv(
      "name,division_id,division\nTeam A,north,North Division",
      "t1"
    );
    expect(teams[0]).toMatchObject({
      divisionId: "north",
      divisionName: "North Division",
    });
  });

  it("imports standing venue requirements for teams, adjudicators, and institutions", () => {
    const team = parseTeamsCsv(
      "name,requires_accessible_venue,requires_near_tab_room,min_venue_capacity\nTeam A,yes,1,40",
      "t1"
    )[0];
    const adjudicator = parseAdjudicatorsCsv(
      "name,required_venue_category,requires_online_venue\nJudge A,Quiet,no",
      "t1"
    )[0];
    const institution = parseInstitutionsCsv(
      "name,venue_category,venue_accessible\nInstitution A,Quiet,yes",
      "t1"
    )[0];
    expect(team.venueRequirements).toEqual({
      category: undefined,
      minimumCapacity: 40,
      accessible: true,
      online: undefined,
      nearTabRoom: true,
    });
    expect(adjudicator.venueRequirements?.category).toBe("Quiet");
    expect(adjudicator.venueRequirements?.online).toBe(false);
    expect(institution.venueRequirements?.category).toBe("Quiet");
    expect(institution.venueRequirements?.accessible).toBe(true);
  });

  it("parses adjudicators with scores, boolean flags, and alias headers", () => {
    const csv = `Name,Institution,Score,Trainee,Independent
Judge Alpha,Cambridge,7.5,yes,no
Judge Beta,LSE,6.0,false,true`;

    const adjs = parseAdjudicatorsCsv(csv, "t1");
    expect(adjs).toHaveLength(2);
    expect(adjs[0].name).toBe("Judge Alpha");
    expect(adjs[0].institutionName).toBe("Cambridge");
    expect(adjs[0].baseScore).toBe(7.5);
    expect(adjs[0].trainee).toBe(true);
    expect(adjs[0].independent).toBe(false);

    expect(adjs[1].name).toBe("Judge Beta");
    expect(adjs[1].baseScore).toBe(6.0);
    expect(adjs[1].trainee).toBe(false);
    expect(adjs[1].independent).toBe(true);
  });

  it("parses venues with priorities, categories, and alias headers", () => {
    const csv = `room,Priority,Category
Room 101,15,Main Hall
Room 102,10,Tutorial`;

    const venues = parseVenuesCsv(csv, "t1");
    expect(venues).toHaveLength(2);
    expect(venues[0].name).toBe("Room 101");
    expect(venues[0].priority).toBe(15);
    expect(venues[0].category).toBe("Main Hall");
    expect(venues[1].name).toBe("Room 102");
    expect(venues[1].priority).toBe(10);
  });

  it("parses venue capacity and capabilities from CSV", () => {
    const venues = parseVenuesCsv(
      "name,capacity,accessible,online\nRoom A,120,yes,no\nRoom B,20,false,true",
      "t1"
    );

    expect(venues.map(({ capacity, accessible, online }) => ({ capacity, accessible, online })))
      .toEqual([
        { capacity: 120, accessible: true, online: false },
        { capacity: 20, accessible: false, online: true },
      ]);
  });

  it("imports the near-tab-room venue capability", () => {
    const [venue] = parseVenuesCsv("name,near_tab_room\nRoom A,true", "t1");
    expect(venue.nearTabRoom).toBe(true);
  });

  it("rejects invalid venue capacities and capability flags", () => {
    expect(() => parseVenuesCsv("name,capacity\nRoom A,-1", "t1"))
      .toThrow("Invalid venue capacity on CSV row 2");
    expect(() => parseVenuesCsv("name,accessible\nRoom A,sometimes", "t1"))
      .toThrow("Invalid accessible value on CSV row 2");
  });

  it("parses Google Sheets institution CSV with BOM, CRLF, aliases, and quoted commas", () => {
    const csv = "\uFEFFInstitution Name,Institution Code,Region\r\n" +
      '"Independent University, Bangladesh",IUB,Dhaka\r\n' +
      '"Begum Rokeya University, Rangpur",BRUR,Rangpur';

    const institutions = parseInstitutionsCsv(csv, "t1");
    expect(institutions).toHaveLength(2);
    expect(institutions[0]).toMatchObject({
      name: "Independent University, Bangladesh",
      code: "IUB",
      region: "Dhaka",
      tournamentId: "t1",
    });
    expect(institutions[1]).toMatchObject({
      name: "Begum Rokeya University, Rangpur",
      code: "BRUR",
      region: "Rangpur",
    });
  });

  it("recovers unquoted commas in institution names when importing legacy CSV rows", () => {
    const csv = `name,code,region
Begum Rokeya University, Rangpur,BRUR,Rangpur
Independent University, Bangladesh,IUB,Dhaka`;

    const institutions = parseInstitutionsCsv(csv, "t1");
    expect(institutions.map(({ name, code, region }) => ({ name, code, region }))).toEqual([
      { name: "Begum Rokeya University, Rangpur", code: "BRUR", region: "Rangpur" },
      { name: "Independent University, Bangladesh", code: "IUB", region: "Dhaka" },
    ]);
  });
});
