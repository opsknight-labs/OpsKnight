/**
 * "Catch me up" without AI: what changed on an incident since a moment (the viewer's last visit), counted by
 * kind, with the latest status and escalation change in words. Pure; the page passes compact rows.
 */

export type CatchUpKind =
  'alert' | 'note' | 'escalation' | 'status' | 'assignment' | 'page_failed' | 'page' | 'other';

export type CatchUpItem = { at: string; kind: CatchUpKind; text: string };

export type CatchUpSummary = {
  total: number;
  counts: Partial<Record<CatchUpKind, number>>;
  /** Latest status change and latest escalation, newest first, in their own words. */
  highlights: string[];
};

/** Classifies an incident event by its type, falling back to its message (as the timeline filters do). */
export function catchUpKind(type: string, message: string): CatchUpKind {
  if (type === 'NOTE' || type === 'COMMENT' || type === 'CHAT_MESSAGE') return 'note';
  if (type === 'ESCALATED' || /escalat/i.test(message)) return 'escalation';
  if (/^(ACKNOWLEDGED|RESOLVED|MANUAL_RESOLVED|AUTO_RESOLVED|REOPENED|STATUS_CHANGE)$/.test(type))
    return 'status';
  if (type === 'ASSIGNMENT' || type === 'ROLE_ASSIGNED' || type === 'ROLE_UNASSIGNED')
    return 'assignment';
  if (/acknowledged|resolved|reopened|snoozed|suppressed/i.test(message)) return 'status';
  return 'other';
}

export function summarizeSince(items: CatchUpItem[], since: string): CatchUpSummary {
  const from = Date.parse(since);
  const recent = items
    .filter(item => Date.parse(item.at) > from)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const counts: Partial<Record<CatchUpKind, number>> = {};
  for (const item of recent) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  const highlights: string[] = [];
  for (const kind of ['status', 'escalation'] as const) {
    const latest = recent.find(item => item.kind === kind);
    if (latest) highlights.push(latest.text);
  }
  return { total: recent.length, counts, highlights };
}

const LABEL: Array<[CatchUpKind, string, string]> = [
  ['alert', 'alert', 'alerts'],
  ['note', 'note', 'notes'],
  ['escalation', 'escalation', 'escalations'],
  ['status', 'status change', 'status changes'],
  ['assignment', 'assignment change', 'assignment changes'],
  ['page_failed', 'failed page', 'failed pages'],
  ['page', 'page sent', 'pages sent'],
];

/** "4 alerts · 2 notes · 1 escalation" in a fixed, most-useful-first order. */
export function countsLine(counts: CatchUpSummary['counts']): string {
  return (
    // eslint-disable-next-line security/detect-object-injection -- kind is one of the fixed summary kinds
    LABEL.filter(([kind]) => counts[kind])
      // eslint-disable-next-line security/detect-object-injection -- kind is one of the fixed summary kinds
      .map(([kind, one, many]) => `${counts[kind]} ${counts[kind] === 1 ? one : many}`)
      .join(' · ')
  );
}
