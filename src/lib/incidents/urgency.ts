export const INCIDENT_URGENCY_ORDER = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type RankedIncidentUrgency = (typeof INCIDENT_URGENCY_ORDER)[number];

const RANK: Record<RankedIncidentUrgency, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

export function incidentUrgencyRank(value: string | null | undefined): number {
  if (value === 'HIGH') return RANK.HIGH;
  if (value === 'MEDIUM') return RANK.MEDIUM;
  if (value === 'LOW') return RANK.LOW;
  return Number.MAX_SAFE_INTEGER;
}

export function compareIncidentUrgency(
  left: string | null | undefined,
  right: string | null | undefined
): number {
  return incidentUrgencyRank(left) - incidentUrgencyRank(right);
}

export function isRankedIncidentUrgency(value: unknown): value is RankedIncidentUrgency {
  return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW';
}
