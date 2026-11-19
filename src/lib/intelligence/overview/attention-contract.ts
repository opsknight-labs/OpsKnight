/**
 * Shape of the overview's "Needs attention" inbox. Dependency-free so the component that renders it can
 * be used (and tested) without the server-only loader.
 */

export type AttentionKind = 'triage' | 'related' | 'gate' | 'dependencies' | 'quarantine';

export const ATTENTION_KIND_LABELS: Readonly<Record<AttentionKind, string>> = {
  triage: 'Triage',
  related: 'Related incidents',
  gate: 'Ready for AUTO',
  dependencies: 'Dependencies',
  quarantine: 'Failed work',
};

export interface AttentionItem {
  /** Stable within one render; used as the list key and the e2e handle. */
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  /** The exact place to act. */
  href: string;
  /** When the newest thing behind the row happened, for ranking; absent rows sort last in their severity. */
  at?: Date;
}

export type AttentionSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

/** Probe rows are decisions, not faults: failed work is a warning, everything else informational. */
export const ATTENTION_KIND_SEVERITY: Readonly<Record<AttentionKind, AttentionSeverity>> = {
  triage: 'WARNING',
  related: 'INFO',
  gate: 'INFO',
  dependencies: 'INFO',
  quarantine: 'WARNING',
};

const SEVERITY_RANK: Readonly<Record<AttentionSeverity, number>> = {
  INFO: 0,
  WARNING: 1,
  CRITICAL: 2,
};

export type RankedAttention<I> =
  | { type: 'probe'; id: string; severity: AttentionSeverity; at: number; item: AttentionItem }
  | { type: 'insight'; id: string; severity: AttentionSeverity; at: number; insight: I };

/** One list from both sources: most severe first, then newest; stable for ties. */
export function rankAttention<
  I extends { id: string; severity: AttentionSeverity; lastSeenAt: Date },
>(items: readonly AttentionItem[], insights: readonly I[]): RankedAttention<I>[] {
  const rows: RankedAttention<I>[] = [
    ...insights.map(insight => ({
      type: 'insight' as const,
      id: insight.id,
      severity: insight.severity,
      at: insight.lastSeenAt.getTime(),
      insight,
    })),
    ...items.map(item => ({
      type: 'probe' as const,
      id: item.id,
      severity: ATTENTION_KIND_SEVERITY[item.kind],
      at: item.at?.getTime() ?? 0,
      item,
    })),
  ];
  return rows.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.at - a.at);
}

export interface OverviewAttention {
  items: AttentionItem[];
}
