import type { AnalysisStatus } from '../analysis/contract';

/**
 * Names shared by the server loader (`strip.ts`) and the client inspector. Kept free of server imports so the
 * client island can use them without pulling data access into the browser bundle.
 */

/** Inspector sections, in their fixed display order. Also the accepted values of `?insights=`. */
export const INSIGHTS_SECTIONS = [
  'briefing',
  'triage',
  'similar',
  'related',
  'why',
  'runbooks',
  'impact',
  'summary',
] as const;

export type InsightsSectionId = (typeof INSIGHTS_SECTIONS)[number];

export const INSIGHTS_SECTION_LABEL: ReadonlyMap<InsightsSectionId, string> = new Map([
  ['briefing', 'Briefing'],
  ['triage', 'Triage'],
  ['similar', 'Similar'],
  ['related', 'Related'],
  ['why', 'Why'],
  ['runbooks', 'Runbooks'],
  ['impact', 'Impact'],
  ['summary', 'Summary'],
]);

export const isInsightsSection = (value: unknown): value is InsightsSectionId =>
  typeof value === 'string' && (INSIGHTS_SECTIONS as readonly string[]).includes(value);

export type StripChipTone = 'neutral' | 'info' | 'ok' | 'elevated' | 'critical' | 'shift';

export interface StripChip {
  id: string;
  label: string;
  tone: StripChipTone;
  /** Opens an inspector section, or jumps to an anchor inside one of the core tabs. */
  target: { section: InsightsSectionId } | { anchor: string };
}

/** Analysis states that earn a freshness dot on the strip; a current analysis is silent. */
export const FRESHNESS_DOT_STATUSES: readonly AnalysisStatus[] = [
  'WAITING',
  'STALE',
  'PAUSED',
  'FAILED',
  'UNAVAILABLE',
];

/** localStorage key for the desktop inspector's width, in CSS pixels. */
export const INSIGHTS_WIDTH_KEY = 'opsknight.insights.width';
export const INSIGHTS_WIDTH = { min: 360, max: 960, default: 576 } as const;
