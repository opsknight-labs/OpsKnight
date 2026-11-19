import type { IncidentTimeAxis, TimeAxisKind } from '../timeline/service';
import type { InsightsSectionId } from './strip-contract';

/**
 * Intelligence events as rows of the core incident Timeline tab. The incident time axis already knows what the
 * viewer may read; this turns it into plain, serialisable rows the client timeline can merge with lifecycle
 * events, notes and notifications. Free of server imports (types only) so the client timeline can use it.
 */

// CHAT rows are incident events the core timeline already shows; a fact has one place.
export type IntelligenceTimelineKind = Exclude<TimeAxisKind, 'INCIDENT' | 'CHAT'> | 'BRIEFING';

export const INTELLIGENCE_TIMELINE_KIND_LABEL: Record<IntelligenceTimelineKind, string> = {
  ALERT: 'Alert',
  CHANGE: 'Change',
  UPSTREAM_INCIDENT: 'Upstream incident',
  METRIC_ANOMALY: 'Metric anomaly',
  NOISE_DECISION: 'Noise control',
  GROUPING: 'Grouping',
  SUGGESTION: 'Suggestion',
  TRIAGE: 'Triage',
  BRIEFING: 'Briefing',
};

export interface IntelligenceTimelineEvent {
  /** Stable within one render of the incident; used as the row key and its `timeline-<id>` anchor. */
  id: string;
  kind: IntelligenceTimelineKind;
  at: Date;
  title: string;
  detail: string | null;
  href: string | null;
  /** Set when the row opens an inspector section instead of navigating. */
  insightsSection?: InsightsSectionId;
  /** Minutes relative to incident onset (negative = before). */
  offsetMinutes: number;
  riskPercent?: number | null;
  why?: string[];
  /** Noise decisions only: present when the viewer may still reverse the decision. */
  reversal?: { decisionId: string; pages: boolean } | null;
  reversed?: boolean;
}

export function formatOnsetOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  const text =
    abs < 60
      ? `${abs} min`
      : abs < 60 * 48
        ? `${Math.round((abs / 60) * 10) / 10} h`
        : `${Math.round(abs / 1440)} d`;
  return minutes === 0 ? 'at onset' : minutes < 0 ? `${text} before` : `${text} after`;
}

/**
 * Rows for the overlay. The axis' own "incident opened / resolved" entries are dropped: the core timeline
 * already states the lifecycle, and a fact has one place.
 */
export function toIntelligenceTimelineEvents(
  axis: IncidentTimeAxis | null,
  briefing?: { createdAt: Date; mode: 'BASIC' | 'AI' } | null
): IntelligenceTimelineEvent[] {
  const events: IntelligenceTimelineEvent[] = [];
  if (axis) {
    const seen = new Map<string, number>();
    for (const entry of axis.entries) {
      if (entry.kind === 'INCIDENT' || entry.kind === 'CHAT') continue;
      const base = `${entry.kind.toLowerCase()}-${entry.at.getTime()}`;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      events.push({
        id: `intel-${base}${count ? `-${count}` : ''}`,
        kind: entry.kind as IntelligenceTimelineKind,
        at: entry.at,
        title: entry.title,
        detail: entry.detail,
        href: entry.href,
        offsetMinutes: entry.offsetMinutes,
        ...(entry.riskPercent !== undefined ? { riskPercent: entry.riskPercent } : {}),
        ...(entry.why?.length ? { why: entry.why } : {}),
        ...(entry.reversal ? { reversal: entry.reversal } : {}),
        ...(entry.reversed ? { reversed: true } : {}),
      });
    }
  }
  if (briefing && axis) {
    events.push({
      id: `intel-briefing-${briefing.createdAt.getTime()}`,
      kind: 'BRIEFING',
      at: briefing.createdAt,
      title: 'Briefing written for responders',
      detail: briefing.mode === 'AI' ? 'Written with AI' : 'Basic mode',
      href: '?insights=briefing',
      insightsSection: 'briefing',
      offsetMinutes: Math.round((briefing.createdAt.getTime() - axis.onset.getTime()) / 60_000),
    });
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  return events;
}
