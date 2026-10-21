import { describe, expect, it } from "vitest";
import { createFakeAdminFirestore } from "@/test/fakeAdminFirestore";
import { createLinkToken, hashLinkSecret, linkSecretMatches, parseLinkToken, recordIdForEmail } from "@/lib/linkTokens";
import {
  acceptInvitation,
  buildInvitationEmail,
  invitationState,
  InvitationError,
  issueInvitations,
  loadInvitationByToken,
  parseExpiryDays,
  parseInvitationEmails,
  previewInvitation,
  renewInvitation,
  summarizeInvitation,
  validateNewAccount,
  type StaffInvitationRecord,
} from "@/lib/staffInvitations";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const T = "tournaments/t1";
const INVITES = `${T}/serverOnly/staffInvitations/items`;

function setup(email = "new.staff@example.com", role: "admin" | "dataEntry" = "dataEntry", days = 7) {
  const [{ issue, record }] = issueInvitations({
    emails: [email],
    role,
    expiryDays: days,
    tournamentId: "t1",
    actorUid: "owner",
    now: NOW,
    existing: new Map(),
  });
  const fake = createFakeAdminFirestore({
    [T]: { name: "Spring Open", slug: "spring", ownerId: "owner", admins: {} },
    [`${INVITES}/${issue.id}`]: record as unknown as Record<string, unknown>,
  });
  return { ...fake, issue, record };
}

async function expectInvitationError(promise: Promise<unknown>, status: number, message?: RegExp) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(InvitationError);
  expect((error as InvitationError).status).toBe(status);
  if (message) expect((error as InvitationError).message).toMatch(message);
}

describe("link tokens", () => {
  it("embed the record location and store only a hash of the secret", () => {
    const { token, secretHash } = createLinkToken("t1", "abc");
    const parsed = parseLinkToken(token)!;
    expect(parsed).toMatchObject({ tournamentId: "t1", recordId: "abc" });
    expect(secretHash).toBe(hashLinkSecret(parsed.secret));
    expect(secretHash).not.toContain(parsed.secret);
    expect(linkSecretMatches(parsed.secret, secretHash)).toBe(true);
    expect(linkSecretMatches(`${parsed.secret.slice(0, -1)}A`, secretHash)).toBe(parsed.secret.endsWith("A"));
  });

  it("reject malformed tokens and hashes", () => {
    for (const value of [undefined, "", "a.b", "a.b.c.d", "t/1.abc.secret", `t1.abc.${"x".repeat(42)}`, 42]) {
      expect(parseLinkToken(value)).toBeNull();
    }
    expect(linkSecretMatches("secret", "not-a-hash")).toBe(false);
    expect(linkSecretMatches("secret", undefined)).toBe(false);
  });

  it("use a different secret every time", () => {
    expect(createLinkToken("t1", "a").token).not.toBe(createLinkToken("t1", "a").token);
  });
});

describe("invitation input", () => {
  it("normalizes and de-duplicates emails, refusing any invalid one", () => {
    expect(parseInvitationEmails([" A@Example.com", "a@example.com", "b@example.org"])).toEqual([
      "a@example.com",
      "b@example.org",
    ]);
    expect(parseInvitationEmails(["a@example.com", "not-an-email"])).toBeNull();
    expect(parseInvitationEmails([])).toBeNull();
    expect(parseInvitationEmails(Array.from({ length: 51 }, (_, index) => `p${index}@example.com`))).toBeNull();
  });

  it("accepts expiry of 1 to 30 whole days and defaults to 7", () => {
    expect(parseExpiryDays(undefined)).toBe(7);
    expect(parseExpiryDays("14")).toBe(14);
    expect(parseExpiryDays(0)).toBeNull();
    expect(parseExpiryDays(31)).toBeNull();
    expect(parseExpiryDays(1.5)).toBeNull();
  });

  it("requires a name and a password of at least 8 characters for new accounts", () => {
    expect(() => validateNewAccount({ password: "short", displayName: "Ana" })).toThrow(InvitationError);
    expect(() => validateNewAccount({ password: "long enough", displayName: "  " })).toThrow(InvitationError);
    expect(validateNewAccount({ password: "long enough", displayName: " Ana " })).toEqual({
      password: "long enough",
      displayName: "Ana",
    });
  });
});

describe("invitation lifecycle", () => {
  it("issues one invitation per address with an expiry, keyed by the address", () => {
    const { issue, record } = setup("Person@Example.com".toLowerCase(), "admin", 3);
    expect(issue.id).toBe(recordIdForEmail("person@example.com"));
    expect(record).toMatchObject({ status: "pending", role: "admin", createdBy: "owner", sendCount: 0 });
    expect(Date.parse(record.expiresAt) - NOW).toBe(3 * DAY);
    expect(linkSecretMatches(parseLinkToken(issue.token)!.secret, record.tokenHash)).toBe(true);
  });

  it("derives expired from the expiry time and hides the hash from summaries", () => {
    const { record } = setup();
    expect(invitationState(record, NOW)).toBe("pending");
    expect(invitationState(record, NOW + 7 * DAY)).toBe("expired");
    expect(invitationState({ ...record, status: "revoked" }, NOW)).toBe("revoked");
    const summary = summarizeInvitation("id", record, NOW);
    expect(summary).not.toHaveProperty("tokenHash");
    expect(summary.state).toBe("pending");
  });

  it("previews a valid token without changing anything", async () => {
    const { firestore, store, issue } = setup();
    const before = JSON.stringify([...store]);
    const preview = previewInvitation(await loadInvitationByToken(firestore, issue.token), NOW);
    expect(preview).toEqual({
      tournamentName: "Spring Open",
      tournamentSlug: "spring",
      email: "new.staff@example.com",
      role: "dataEntry",
      expiresAt: issue.expiresAt,
      state: "pending",
    });
    expect(JSON.stringify([...store])).toBe(before);
  });

  it("treats unknown records and wrong secrets as bad tokens", async () => {
    const { firestore, issue } = setup();
    const parsed = parseLinkToken(issue.token)!;
    const wrongSecret = `t1.${parsed.recordId}.${"A".repeat(43)}`;
    for (const token of [wrongSecret, `t1.unknown.${parsed.secret}`, `t2.${parsed.recordId}.${parsed.secret}`, "junk"]) {
      const error = await loadInvitationByToken(firestore, token).then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(InvitationError);
      expect((error as InvitationError).badToken).toBe(true);
    }
  });

  it("grants the role once and marks the invitation used", async () => {
    const { firestore, store, issue } = setup();
    const account = { uid: "u-new", email: "New.Staff@example.com", displayName: "New Staff" };
    await expect(acceptInvitation({ firestore, token: issue.token, account, now: NOW })).resolves.toEqual({
      role: "dataEntry",
      tournamentId: "t1",
      tournamentSlug: "spring",
    });
    expect(store.get(`${T}/staff/u-new`)).toMatchObject({
      email: "new.staff@example.com",
      role: "dataEntry",
      addedBy: "owner",
      invitationId: issue.id,
    });
    expect(store.get(`${INVITES}/${issue.id}`)).toMatchObject({ status: "accepted", acceptedBy: "u-new" });

    await expectInvitationError(acceptInvitation({ firestore, token: issue.token, account, now: NOW }), 410, /already been used/);
  });

  it("refuses an account with a different email, granting nothing", async () => {
    const { firestore, store, issue } = setup();
    await expectInvitationError(
      acceptInvitation({ firestore, token: issue.token, account: { uid: "intruder", email: "other@example.com" }, now: NOW }),
      403,
      /new.staff@example.com/
    );
    await expectInvitationError(
      acceptInvitation({ firestore, token: issue.token, account: { uid: "no-email" }, now: NOW }),
      403
    );
    expect(store.has(`${T}/staff/intruder`)).toBe(false);
    expect(store.get(`${INVITES}/${issue.id}`)).toMatchObject({ status: "pending" });
  });

  it("refuses expired and revoked invitations", async () => {
    const { firestore, store, issue } = setup();
    const account = { uid: "u", email: "new.staff@example.com" };
    await expectInvitationError(acceptInvitation({ firestore, token: issue.token, account, now: NOW + 8 * DAY }), 410, /expired/);
    const path = `${INVITES}/${issue.id}`;
    store.set(path, { ...store.get(path), status: "revoked" });
    await expectInvitationError(acceptInvitation({ firestore, token: issue.token, account, now: NOW }), 410, /withdrawn/);
    expect(store.has(`${T}/staff/u`)).toBe(false);
  });

  it("invalidates the old link when an invitation is renewed", async () => {
    const { firestore, store, issue, record } = setup();
    const renewed = renewInvitation(record, { id: issue.id, tournamentId: "t1", expiryDays: 7, now: NOW + DAY });
    store.set(`${INVITES}/${issue.id}`, renewed.record as unknown as Record<string, unknown>);
    const account = { uid: "u", email: "new.staff@example.com" };
    await expectInvitationError(acceptInvitation({ firestore, token: issue.token, account, now: NOW + DAY }), 404);
    await expect(acceptInvitation({ firestore, token: renewed.issue.token, account, now: NOW + DAY })).resolves.toMatchObject({
      role: "dataEntry",
    });
  });

  it("does not renew accepted or revoked invitations", () => {
    const { record, issue } = setup();
    for (const status of ["accepted", "revoked"] as const) {
      expect(() =>
        renewInvitation({ ...record, status } as StaffInvitationRecord, { id: issue.id, tournamentId: "t1", expiryDays: 7, now: NOW })
      ).toThrow(InvitationError);
    }
  });

  it("never lowers an existing administrator's role", async () => {
    const { firestore, store, issue } = setup();
    store.set(`${T}/staff/u-admin`, { role: "admin", email: "new.staff@example.com", addedAt: "earlier" });
    await expect(
      acceptInvitation({ firestore, token: issue.token, account: { uid: "u-admin", email: "new.staff@example.com" }, now: NOW })
    ).resolves.toMatchObject({ role: "admin" });
    expect(store.get(`${T}/staff/u-admin`)).toMatchObject({ role: "admin", addedAt: "earlier" });
  });

  it("writes the email with the link and expiry", () => {
    const email = buildInvitationEmail({
      tournamentName: "Spring Open",
      role: "admin",
      link: "https://tab.example/invite#t1.x.y",
      expiresAt: new Date(NOW + DAY).toISOString(),
      inviterName: "Ana",
    });
    expect(email.subject).toBe("Invitation to Spring Open on CrabbyTab");
    expect(email.text).toContain("Ana has invited you to join Spring Open on CrabbyTab as a tournament administrator.");
    expect(email.text).toContain("https://tab.example/invite#t1.x.y");
  });
});
