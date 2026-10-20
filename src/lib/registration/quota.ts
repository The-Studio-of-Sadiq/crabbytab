import type {
  RegistrationCounters,
  RegistrationKind,
  RegistrationRepresentative,
  RegistrationSettings,
} from "@/lib/registration/types";

/**
 * Quotas count non-rejected submissions (pending, being approved, or approved), per institution
 * and tournament-wide, from one counters document updated in the same transaction as each
 * submission. Teams or adjudicators an administrator adds directly are not counted. Rejecting a
 * submission frees its place; reopening it takes the place again.
 */

export function emptyCounters(): RegistrationCounters {
  return { teams: 0, adjudicators: 0, institutions: {} };
}

export function readCounters(value: unknown): RegistrationCounters {
  const record = (value ?? {}) as Partial<RegistrationCounters>;
  const count = (item: unknown) => (typeof item === "number" && Number.isInteger(item) && item > 0 ? item : 0);
  const institutions: RegistrationCounters["institutions"] = {};
  for (const [key, item] of Object.entries(record.institutions ?? {})) {
    institutions[key] = { teams: count(item?.teams), adjudicators: count(item?.adjudicators) };
  }
  return { teams: count(record.teams), adjudicators: count(record.adjudicators), institutions };
}

function field(kind: RegistrationKind): "teams" | "adjudicators" {
  return kind === "team" ? "teams" : "adjudicators";
}

export interface QuotaLimits {
  perInstitution: number;
  total: number;
}

export function quotaLimits(
  kind: RegistrationKind,
  settings: Pick<RegistrationSettings, "teamQuotaPerInstitution" | "adjudicatorQuotaPerInstitution" | "maxTeams" | "maxAdjudicators">,
  representative?: Pick<RegistrationRepresentative, "teamQuota" | "adjudicatorQuota">
): QuotaLimits {
  const override = kind === "team" ? representative?.teamQuota : representative?.adjudicatorQuota;
  return {
    perInstitution: override ?? (kind === "team" ? settings.teamQuotaPerInstitution : settings.adjudicatorQuotaPerInstitution),
    total: kind === "team" ? settings.maxTeams : settings.maxAdjudicators,
  };
}

/** Places left for an institution (null = unlimited). */
export function remainingPlaces(
  counters: RegistrationCounters,
  kind: RegistrationKind,
  institution: string | null,
  limits: QuotaLimits
): number | null {
  const name = field(kind);
  const candidates: number[] = [];
  if (limits.total > 0) candidates.push(limits.total - counters[name]);
  if (limits.perInstitution > 0 && institution) {
    candidates.push(limits.perInstitution - (counters.institutions[institution]?.[name] ?? 0));
  }
  return candidates.length === 0 ? null : Math.max(0, Math.min(...candidates));
}

/** The reason a new submission does not fit, or null. Independents only meet the total limit. */
export function quotaRefusal(
  counters: RegistrationCounters,
  kind: RegistrationKind,
  institution: string | null,
  limits: QuotaLimits
): string | null {
  const name = field(kind);
  if (limits.total > 0 && counters[name] >= limits.total) {
    return kind === "team" ? "Team registration is full." : "Adjudicator registration is full.";
  }
  if (institution && limits.perInstitution > 0 && (counters.institutions[institution]?.[name] ?? 0) >= limits.perInstitution) {
    return kind === "team"
      ? `This institution has reached its limit of ${limits.perInstitution} team(s).`
      : `This institution has reached its limit of ${limits.perInstitution} adjudicator(s).`;
  }
  return null;
}

/** Counters after adding (+1) or removing (-1) one submission. Never below zero. */
export function adjustCounters(
  counters: RegistrationCounters,
  kind: RegistrationKind,
  institution: string | null,
  delta: 1 | -1
): RegistrationCounters {
  const name = field(kind);
  const next: RegistrationCounters = {
    ...counters,
    [name]: Math.max(0, counters[name] + delta),
    institutions: { ...counters.institutions },
  };
  if (institution) {
    const current = counters.institutions[institution] ?? { teams: 0, adjudicators: 0 };
    const updated = { ...current, [name]: Math.max(0, current[name] + delta) };
    if (updated.teams === 0 && updated.adjudicators === 0) delete next.institutions[institution];
    else next.institutions[institution] = updated;
  }
  return next;
}
