/**
 * Pure shaping for an incident's Audit view: audit rows → who (person, automation, Squire, API/MCP),
 * what (a short human summary, never raw details) and where from (web, API, MCP, Slack, Teams). No DB
 * access, so the client component can group and filter the rows it has loaded.
 */

export type AuditActorKind = 'person' | 'automation' | 'ai' | 'api';

/** The columns the loader selects from AuditLog. */
export type AuditRowInput = {
  id: string;
  action: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  channel: string | null;
  details: unknown;
};

export type AuditTrailRow = {
  id: string;
  at: string;
  kind: AuditActorKind;
  actor: string;
  summary: string;
  /** Request source when recorded: Web, API, MCP, Slack, Teams, Integration or Automation. */
  source: string | null;
};

export type AuditTrailGroup = AuditTrailRow & {
  /** Consecutive identical automated rows folded into this one (1 when not grouped). */
  count: number;
  /** The oldest row's time when grouped. */
  firstAt: string;
};

type Json = Record<string, unknown>;

const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function auditActorKind(row: AuditRowInput): AuditActorKind {
  const details = record(row.details);
  const actorType = record(details.actor).type;
  if (row.action.startsWith('intelligence.squire.')) return 'ai';
  const viaApi = details.source === 'API' || record(details.metadata).apiGateway === 'api_v2';
  if (row.channel?.startsWith('mcp:') || viaApi || actorType === 'API_KEY') {
    return 'api';
  }
  if (row.actorId || actorType === 'USER') return 'person';
  return 'automation';
}

const SOURCE_LABELS: Record<string, string> = {
  UI: 'Web',
  API: 'API',
  INTEGRATION: 'Integration',
  AUTOMATION: 'Automation',
  BACKGROUND: 'Automation',
  SYSTEM: 'Automation',
};

export function auditRequestSource(row: AuditRowInput): string | null {
  if (row.channel?.startsWith('mcp:')) return 'MCP';
  const details = record(row.details);
  const metadata = record(details.metadata);
  // Squire records metadata.channel, manual escalation metadata.source (SLACK / MICROSOFT_TEAMS).
  const via = [metadata.channel, metadata.source, row.action].map(String).join(' ').toLowerCase();
  if (via.includes('slack')) return 'Slack';
  if (/microsoft_?teams|\bteams\b/.test(via)) return 'Teams';
  return SOURCE_LABELS[String(details.source)] ?? null;
}

/** "incident.role_assigned" → "Role assigned"; "microsoftTeams.delivery.failed" → "Microsoft teams delivery failed". */
export function humanizeAuditAction(action: string): string {
  const words = action
    .replace(/^incident[._]/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[._\s]+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
}

const SHORT_VALUE = 40;

function describeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string' && value.length <= SHORT_VALUE && value !== '[REDACTED]') {
    return value;
  }
  return null;
}

/** Field-level changes between oldValue and newValue, at most three, ids and redacted values never shown. */
export function describeAuditChanges(oldValue: unknown, newValue: unknown): string[] {
  const before = record(oldValue);
  const after = record(newValue);
  const changes: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    const idLike = /(?:^id|Id|Ids|_id)$/.test(key);
    const field = humanizeAuditAction(key.replace(/Ids?$/, '')).toLowerCase();
    const shownFrom = idLike ? null : describeValue(from);
    const shownTo = idLike ? null : describeValue(to);
    if (shownTo !== null && (shownFrom !== null || from === null)) {
      changes.push(
        shownFrom !== null ? `${field} ${shownFrom} → ${shownTo}` : `${field} ${shownTo}`
      );
    } else {
      changes.push(`${field} ${to === null ? 'cleared' : from === null ? 'set' : 'changed'}`);
    }
  }
  return changes.length > 3 ? [...changes.slice(0, 3), `+${changes.length - 3} more`] : changes;
}

export function auditSummary(row: AuditRowInput): string {
  const details = record(row.details);
  const metadata = record(details.metadata);
  if (row.action === 'intelligence.squire.action') {
    const squireAction = text(metadata.squireAction);
    const outcome = text(metadata.outcome);
    const what = squireAction ? humanizeAuditAction(squireAction).toLowerCase() : 'action';
    return `Ran ${what}${outcome && outcome !== 'SUCCEEDED' ? ` (${outcome.toLowerCase()})` : ''}`;
  }
  const changes = describeAuditChanges(details.oldValue, details.newValue);
  const label = humanizeAuditAction(row.action);
  return changes.length ? `${label} · ${changes.join(', ')}` : label;
}

export function toAuditTrailRow(row: AuditRowInput): AuditTrailRow {
  const kind = auditActorKind(row);
  const actorRecord = record(record(row.details).actor);
  const named = text(row.actorName) ?? text(actorRecord.name) ?? text(row.actorEmail);
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    kind,
    actor: named ?? (kind === 'ai' ? 'Squire' : kind === 'api' ? 'API client' : 'System'),
    summary: auditSummary(row),
    source: auditRequestSource(row),
  };
}

/** Folds consecutive identical automated rows ("12 × escalation step executed"); people's rows stay one each. */
export function groupAuditTrail(rows: readonly AuditTrailRow[]): AuditTrailGroup[] {
  const groups: AuditTrailGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (
      last &&
      row.kind === 'automation' &&
      last.kind === 'automation' &&
      last.summary === row.summary &&
      last.actor === row.actor &&
      last.source === row.source
    ) {
      last.count += 1;
      last.firstAt = row.at;
    } else {
      groups.push({ ...row, count: 1, firstAt: row.at });
    }
  }
  return groups;
}

export function countAuditKinds(
  rows: readonly AuditTrailRow[]
): Record<AuditActorKind | 'all', number> {
  const counts = { all: rows.length, person: 0, automation: 0, ai: 0, api: 0 };
  for (const row of rows) counts[row.kind] += 1;
  return counts;
}
