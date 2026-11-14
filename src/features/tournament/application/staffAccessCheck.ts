/**
 * How often a tournament page re-checks the signed-in account's role with the server
 * (`/api/tournaments/{id}/access`, two or three Firestore reads). The check used to run on every
 * navigation, which cost those reads on every click in the tab room. A role verified within this
 * window stays in force; the next navigation after it re-checks.
 *
 * This only decides what the interface shows. The server routes and Firestore rules check access
 * on every request, so a revoked role stops working at once whatever this device still shows.
 */
export const STAFF_ACCESS_RECHECK_MS = 10 * 60 * 1000;

/** The account and tournament a verification was for, and when it succeeded. */
export interface StaffAccessVerification {
  key: string;
  verifiedAt: number;
}

export function staffAccessKey(uid: string | undefined, tournamentId: string | undefined): string {
  return uid && tournamentId ? `${uid}|${tournamentId}` : "";
}

/**
 * Whether to ask the server again: always for another account or tournament, or after a check
 * that did not succeed online; otherwise once the last success is older than the re-check window.
 */
export function shouldRecheckStaffAccess(
  last: StaffAccessVerification | null,
  key: string,
  now: number
): boolean {
  if (!key || !last || last.key !== key) return true;
  return now - last.verifiedAt >= STAFF_ACCESS_RECHECK_MS || now < last.verifiedAt;
}
