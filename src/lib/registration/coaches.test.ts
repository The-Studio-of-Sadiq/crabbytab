import { describe, expect, it } from "vitest";
import type { Institution } from "@/types";
import type { RegistrationSubmission } from "./types";
import { representativesAsCoaches } from "./coaches";
import { institutionResponseView } from "./institutionResponse";
import { institutionCoachRecipients, resolveEmailRecipients } from "../email/messaging";

const oxford: Institution = { id: "ox", tournamentId: "t", name: "Oxford", code: "OX" };
const representative = (extra: Record<string, unknown> = {}) => ({
  institution: { name: "Oxford", key: "oxford" },
  email: "Coach@Example.com",
  name: "Coach Carter",
  status: "active" as const,
  ...extra,
});

describe("coaches as people", () => {
  it("stores active representatives as coaches of matching institutions, once", () => {
    let n = 0;
    const id = (prefix: string) => `${prefix}-${(n += 1)}`;
    const { updated, unmatched } = representativesAsCoaches(
      [oxford],
      [representative(), representative({ status: "revoked", email: "old@example.com" }), representative({ institution: { name: "Nowhere", key: "nowhere" } })],
      id
    );
    expect(updated).toEqual([{ ...oxford, coaches: [{ id: "coach-1", name: "Coach Carter", email: "coach@example.com" }] }]);
    expect(unmatched).toEqual(["Nowhere"]);
    expect(representativesAsCoaches(updated, [representative()], id).updated).toEqual([]);
  });

  it("emails the institution coaches group and nobody else", () => {
    const institutions = [{ ...oxford, coaches: [{ id: "c1", name: "Coach", email: "coach@example.com" }, { id: "c2", name: "No email" }] }];
    const team = {
      id: "t1", tournamentId: "t", name: "Oxford A", speakers: [{ id: "s", name: "S", email: "s@example.com" }],
      breakCategories: [], speakerCategories: [],
    };
    const recipients = resolveEmailRecipients("institution_coaches", [team], [], [], undefined, {
      coaches: institutionCoachRecipients(institutions),
      includePrivateCredentials: true,
      tournamentSlug: "t",
      privateUrlOrigin: "https://x",
    });
    expect(recipients).toEqual([{ email: "coach@example.com", name: "Coach", institution: "Oxford", round: undefined }]);
    // Coaches never receive anyone's private URL, and other groups never include coaches.
    expect(resolveEmailRecipients("all_participants", [team], [], [], undefined, {
      coaches: institutionCoachRecipients(institutions),
    }).map((recipient) => recipient.email)).toEqual(["s@example.com"]);
  });
});

describe("coach view of the institution's response", () => {
  const submission = (extra: Partial<RegistrationSubmission>): RegistrationSubmission => ({
    id: "x", kind: "team", institution: { name: "Oxford", key: "oxford" }, contactName: "Private Person",
    contactEmail: "private@example.com", answers: { q: "secret" }, status: "pending", submittedAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z", revision: 1,
    team: { name: "Oxford A", speakers: [{ name: "Ann", email: "ann@example.com", categories: [], phone: "+441234" }] },
    ...extra,
  });

  it("lists the institution's entries without contact details, answers or rejection reasons", () => {
    const view = institutionResponseView(
      [
        submission({ id: "a" }),
        submission({ id: "b", status: "rejected", rejectionReason: "internal note", submittedAt: "2026-10-02T00:00:00Z" }),
        submission({ id: "c", institution: { name: "Cambridge", key: "cambridge" } }),
        submission({ id: "d", institution: null, representativeId: "rep-1", kind: "adjudicator", adjudicator: {
          name: "Judge", email: "judge@example.com", institutionConflicts: [], teamConflicts: [],
        } }),
      ],
      { id: "rep-1", institution: { name: "Oxford", key: "oxford" } }
    );
    expect(view.map((item) => item.id)).toEqual(["b", "a", "d"]);
    expect(view[1]).toEqual({ id: "a", kind: "team", name: "Oxford A", status: "pending", submittedAt: "2026-10-01T00:00:00Z", speakers: ["Ann"] });
    const text = JSON.stringify(view);
    for (const secret of ["private@example.com", "Private Person", "secret", "internal note", "ann@example.com", "+441234", "judge@example.com"]) {
      expect(text).not.toContain(secret);
    }
  });
});
