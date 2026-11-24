import type { BurnState, ErrorBudget } from '../slo';

export const TOP_EXPANDED = 5;

/** One service's month, already computed. Nothing here is read per recipient. */
export type ReviewService = {
  id: string;
  name: string;
  criticality: string | null;
  sloTarget: number | null;
  /** Severity-weighted uptime over the reviewed month, in percent. */
  attainmentPercent: number | null;
  budget: ErrorBudget | null;
  /** Budget remaining last month, for the trend. */
  priorRemainingPercent: number | null;
  downtimeMinutes: number;
  incidentCount: number;
  mttaMinutes: number | null;
  mttrMinutes: number | null;
  /** Null when the service has no revenue figure. */
  estimatedCostCents: number | null;
  currency: string | null;
  topCauses: string[];
};

export type BurnTrend = 'improving' | 'worsening' | 'steady' | 'unknown';

export type DigestEntry = ReviewService & { burnState: BurnState | null; trend: BurnTrend };

export type Digest = {
  expanded: DigestEntry[];
  compact: DigestEntry[];
  totals: {
    services: number;
    breached: number;
    atRisk: number;
    incidents: number;
    downtimeMinutes: number;
    estimatedCostCents: number | null;
    currency: string | null;
  };
};

const STATE_WEIGHT: Record<BurnState, number> = { BREACHED: 1000, AT_RISK: 500, OK: 0 };

export function burnTrend(budget: ErrorBudget | null, prior: number | null): BurnTrend {
  if (!budget || prior === null) return 'unknown';
  const delta = budget.remainingPercent - prior;
  return Math.abs(delta) < 5 ? 'steady' : delta > 0 ? 'improving' : 'worsening';
}

/** Higher = needs attention sooner: breached, then at risk, then by downtime and incidents. */
export const attentionScore = (s: ReviewService) =>
  (s.budget ? STATE_WEIGHT[s.budget.burnState] : 0) +
  s.downtimeMinutes / 10 +
  s.incidentCount * 2 +
  (s.budget && s.budget.remainingPercent < 0 ? Math.min(-s.budget.remainingPercent, 400) : 0);

/** Nothing to say unless the service had impact, or its budget is breached or at risk. */
export const hasSomethingToReport = (s: ReviewService) =>
  s.incidentCount > 0 ||
  s.downtimeMinutes > 0 ||
  s.budget?.burnState === 'BREACHED' ||
  s.budget?.burnState === 'AT_RISK';

/** The digest for one recipient: quiet services dropped, sorted by attention, top 5 expanded. */
export function buildDigest(services: readonly ReviewService[]): Digest | null {
  const entries: DigestEntry[] = services.filter(hasSomethingToReport).map(s => ({
    ...s,
    burnState: s.budget?.burnState ?? null,
    trend: burnTrend(s.budget, s.priorRemainingPercent),
  }));
  if (!entries.length) return null;
  entries.sort((a, b) => attentionScore(b) - attentionScore(a) || a.name.localeCompare(b.name));
  const costs = entries.map(e => e.estimatedCostCents).filter((c): c is number => c !== null);
  const currencies = new Set(
    entries.filter(e => e.estimatedCostCents !== null).map(e => e.currency)
  );
  return {
    expanded: entries.slice(0, TOP_EXPANDED),
    compact: entries.slice(TOP_EXPANDED),
    totals: {
      services: entries.length,
      breached: entries.filter(e => e.burnState === 'BREACHED').length,
      atRisk: entries.filter(e => e.burnState === 'AT_RISK').length,
      incidents: entries.reduce((n, e) => n + e.incidentCount, 0),
      downtimeMinutes: entries.reduce((n, e) => n + e.downtimeMinutes, 0),
      // A single currency only; mixed currencies are not summed.
      estimatedCostCents:
        costs.length && currencies.size === 1 ? costs.reduce((a, b) => a + b, 0) : null,
      currency: currencies.size === 1 ? ([...currencies][0] ?? null) : null,
    },
  };
}

export type RecipientService = {
  id: string;
  includeInReview: boolean;
  ownerUserId: string | null;
  ownerTeamId: string | null;
};

/**
 * Who gets which services. Only services opted in to review count. A service goes to its owner
 * user and to members of its owner team who opted in (`optedInTeamMembers`: teamId -> userIds).
 * `eligibleUserIds` is the active users with an email address. A person appears once with all
 * their services, so 100 services never mean 100 emails.
 */
export function resolveRecipients(input: {
  services: readonly RecipientService[];
  optedInTeamMembers: ReadonlyMap<string, readonly string[]>;
  eligibleUserIds: ReadonlySet<string>;
}): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const give = (userId: string, serviceId: string) => {
    if (!input.eligibleUserIds.has(userId)) return;
    (out.get(userId) ?? out.set(userId, new Set()).get(userId)!).add(serviceId);
  };
  for (const service of input.services) {
    if (!service.includeInReview) continue;
    if (service.ownerUserId) give(service.ownerUserId, service.id);
    if (service.ownerTeamId)
      for (const userId of input.optedInTeamMembers.get(service.ownerTeamId) ?? [])
        give(userId, service.id);
  }
  return new Map([...out].map(([userId, ids]) => [userId, [...ids].sort()]));
}

/** Idempotency claim key: one row per period, kind and recipient. */
export const claimKey = (period: string, kind: 'DIGEST' | 'SUMMARY', recipient: string) =>
  `${period}:${kind}:${recipient.toLowerCase()}`;

export function formatMinutes(minutes: number): string {
  if (minutes < 1) return '0 min';
  if (minutes < 120) return `${Math.round(minutes)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

export function formatMoney(cents: number | null, currency: string | null): string | null {
  if (cents === null) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency ?? ''}`.trim();
  }
}
