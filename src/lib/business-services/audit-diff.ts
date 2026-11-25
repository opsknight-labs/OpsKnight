/* eslint-disable security/detect-object-injection -- keys come from the fixed field lists above, never request input */
/** Reads the richer `business_service.updated` payload (Phase 0): `newValue` plus its nested `before`. */

export type AuditChange = { field: string; label: string; from: string; to: string };

const SCALAR_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['name', 'Name'],
  ['criticality', 'Criticality'],
  ['lifecycle', 'Lifecycle'],
  ['sloTarget', 'SLO target'],
  ['impactMinUrgency', 'Minimum urgency'],
  ['impactMaxPriority', 'Lowest priority'],
  ['quorumPartialPct', 'Partial at'],
  ['quorumMajorPct', 'Major at'],
  ['dependencyHopDepth', 'Dependency hops'],
  ['revenuePerHourCents', 'Revenue per hour (cents)'],
  ['currency', 'Currency'],
  ['customerReportThreshold', 'Customer report threshold'],
];
/** Ids shown by name once the page has resolved them. */
const REFERENCE_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['ownerTeamId', 'Owner team'],
  ['ownerUserId', 'Owner'],
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const show = (value: unknown) =>
  value === null || value === undefined || value === '' ? 'not set' : String(value);

/** Ids of teams and users an entry mentions, so the page can look their names up once. */
export function auditReferenceIds(details: unknown): string[] {
  const after = isRecord(details) && isRecord(details.newValue) ? details.newValue : null;
  const before = after && isRecord(after.before) ? after.before : null;
  if (!after || !before) return [];
  return REFERENCE_FIELDS.flatMap(([field]) =>
    [after[field], before[field]].filter((v): v is string => typeof v === 'string')
  );
}

/**
 * The changes an update entry records. Entries without a `before` snapshot (created, older updates)
 * yield none. `names` resolves owner ids; an unresolved id is shown as "unknown".
 */
export function diffAuditDetails(
  details: unknown,
  names: ReadonlyMap<string, string> = new Map()
): AuditChange[] {
  const after = isRecord(details) && isRecord(details.newValue) ? details.newValue : null;
  const before = after && isRecord(after.before) ? after.before : null;
  if (!after || !before) return [];
  const changes: AuditChange[] = [];
  for (const [field, label] of SCALAR_FIELDS) {
    if (after[field] !== undefined && after[field] !== before[field]) {
      changes.push({ field, label, from: show(before[field]), to: show(after[field]) });
    }
  }
  for (const [field, label] of REFERENCE_FIELDS) {
    if (after[field] !== undefined && after[field] !== before[field]) {
      const name = (id: unknown) =>
        typeof id === 'string' ? (names.get(id) ?? 'unknown') : 'not set';
      changes.push({ field, label, from: name(before[field]), to: name(after[field]) });
    }
  }
  if (Array.isArray(after.memberServiceIds) && Array.isArray(before.memberServiceIds)) {
    const was = new Set(before.memberServiceIds as unknown[]);
    const now = new Set(after.memberServiceIds as unknown[]);
    const added = [...now].filter(id => !was.has(id)).length;
    const removed = [...was].filter(id => !now.has(id)).length;
    if (added || removed) {
      changes.push({
        field: 'memberServiceIds',
        label: 'Services',
        from: `${was.size}`,
        to: `${now.size} (${added} added, ${removed} removed)`,
      });
    }
  }
  return changes;
}
