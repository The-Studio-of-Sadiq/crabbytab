import type { RegistrationRepresentative, RegistrationSettings, SlotTransfer } from "@/lib/registration/types";
import { RegistrationValidationError } from "@/lib/registration/validation";

/**
 * Slot transfers between institutions (Tabbycat `reg_institution_slot_transfers`;
 * docs/registration.md, "Slot transfers"). A representative asks to give some of their team or
 * adjudicator places to another institution's representative; an administrator approves, which
 * moves the places between the two representatives' limits in one transaction.
 */

export const MAX_TRANSFER_PLACES = 100;

export function parseTransferRequest(input: unknown): { toRepresentativeId: string; teams: number; adjudicators: number } {
  const record = (input ?? {}) as Record<string, unknown>;
  const count = (value: unknown, label: string) => {
    const number = typeof value === "string" ? Number(value) : value;
    if (number === undefined || number === "" || number === null) return 0;
    if (typeof number !== "number" || !Number.isInteger(number) || number < 0 || number > MAX_TRANSFER_PLACES) {
      throw new RegistrationValidationError(`${label} must be a whole number from 0 to ${MAX_TRANSFER_PLACES}.`);
    }
    return number;
  };
  const toRepresentativeId = typeof record.toRepresentativeId === "string" ? record.toRepresentativeId : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(toRepresentativeId)) throw new RegistrationValidationError("Choose the institution to give places to.");
  const teams = count(record.teams, "Team places");
  const adjudicators = count(record.adjudicators, "Adjudicator places");
  if (teams + adjudicators === 0) throw new RegistrationValidationError("Transfer at least one place.");
  return { toRepresentativeId, teams, adjudicators };
}

/** A representative's effective place limit (their own, or the per-institution default). */
export function placeLimit(
  representative: Pick<RegistrationRepresentative, "teamQuota" | "adjudicatorQuota">,
  kind: "team" | "adjudicator",
  settings: Pick<RegistrationSettings, "teamQuotaPerInstitution" | "adjudicatorQuotaPerInstitution">
): number {
  return kind === "team"
    ? representative.teamQuota ?? settings.teamQuotaPerInstitution
    : representative.adjudicatorQuota ?? settings.adjudicatorQuotaPerInstitution;
}

/**
 * The two representatives' limits after an approved transfer. Unlimited (0) places cannot be
 * transferred from, and the giver keeps at least the places their institution already used.
 */
export function applyTransfer(
  transfer: Pick<SlotTransfer, "teams" | "adjudicators">,
  from: RegistrationRepresentative,
  to: RegistrationRepresentative,
  settings: Pick<RegistrationSettings, "teamQuotaPerInstitution" | "adjudicatorQuotaPerInstitution">,
  used: { teams: number; adjudicators: number }
): { from: RegistrationRepresentative; to: RegistrationRepresentative } {
  const next = { from: { ...from }, to: { ...to } };
  for (const [kind, amount, usedPlaces] of [
    ["team", transfer.teams, used.teams],
    ["adjudicator", transfer.adjudicators, used.adjudicators],
  ] as const) {
    if (amount === 0) continue;
    const fromLimit = placeLimit(from, kind, settings);
    if (fromLimit === 0) throw new RegistrationValidationError(`${from.institution.name} has no fixed ${kind} places to give.`);
    if (fromLimit - amount < usedPlaces) {
      throw new RegistrationValidationError(
        `${from.institution.name} has already used ${usedPlaces} of its ${fromLimit} ${kind} place(s).`
      );
    }
    const toLimit = placeLimit(to, kind, settings);
    const field = kind === "team" ? "teamQuota" : "adjudicatorQuota";
    next.from[field] = fromLimit - amount;
    // An unlimited receiver stays unlimited.
    if (toLimit > 0) next.to[field] = toLimit + amount;
  }
  return next;
}
