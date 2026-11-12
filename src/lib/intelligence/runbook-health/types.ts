export type InsightSeverity = 'info' | 'warning' | 'critical';

/** The shape the shared insight store upserts: upsertInsights(scope, kind, items). */
export interface InsightItem {
  key: string;
  kind: string;
  severity: InsightSeverity;
  title: string;
  evidence: Record<string, unknown>;
}
