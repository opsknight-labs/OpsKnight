/**
 * Shared, dependency-free contract for the /alerts and /changes lists: filter parsing, the keyset cursor
 * and the labels both the loaders and the components use. Everything the URL can carry is validated here,
 * so a hand-edited query string degrades to the default view instead of reaching a query.
 */
import {
  NOISE_DECISION_LABELS,
  classifyNoiseDecision,
  type NoiseDecisionKind,
} from '../incident-ux/explain';
import { OVERVIEW_WINDOW_LIST, type OverviewWindowKey } from '../overview/window';

/** Rows per page. One extra row is read to learn whether another page exists. */
export const LIST_PAGE_SIZE = 50;
/** Services offered in the filter; a larger estate filters by opening the service first. */
export const LIST_SERVICE_OPTION_LIMIT = 200;
/** Lists default to the last 24 hours so the first page is always a small index range. */
export const DEFAULT_LIST_WINDOW: OverviewWindowKey = '24h';
export const LIST_WINDOWS = OVERVIEW_WINDOW_LIST;

export type ListParam = string | string[] | undefined;
const first = (value: ListParam): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

export function parseListWindow(value: ListParam): OverviewWindowKey {
  const raw = first(value);
  return OVERVIEW_WINDOW_LIST.find(spec => spec.key === raw)?.key ?? DEFAULT_LIST_WINDOW;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Opaque ids from the URL: bounded and limited to the characters cuids and slugs use. */
export function parseListId(value: ListParam): string | null {
  const raw = first(value);
  return raw && ID_PATTERN.test(raw) ? raw : null;
}

/** Position after the last row of a page: its sort timestamp and id (the tiebreaker). */
export interface ListCursor {
  at: Date;
  id: string;
}

export function encodeListCursor(cursor: ListCursor): string {
  return `${cursor.at.getTime().toString(36)}.${cursor.id}`;
}

export function decodeListCursor(value: ListParam): ListCursor | null {
  const raw = first(value);
  if (!raw || raw.length > 96) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const stamp = raw.slice(0, dot);
  if (!/^[0-9a-z]{1,11}$/.test(stamp)) return null;
  const ms = parseInt(stamp, 36);
  const id = raw.slice(dot + 1);
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 8.64e15) return null;
  if (!ID_PATTERN.test(id)) return null;
  return { at: new Date(ms), id };
}

// ── Alerts ────────────────────────────────────────────────────────────────────────────────────────────

export const ALERT_SEVERITIES = ['critical', 'error', 'warning', 'info'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** What a noise control did (or, in shadow, would have done) with an alert before paging. */
export const ALERT_DECISION_KINDS = ['suppressed', 'deduped', 'grouped', 'maintenance'] as const;
export type AlertDecisionKind = (typeof ALERT_DECISION_KINDS)[number];
/**
 * Decisions outside the four filterable kinds (held, downgraded, transformed) still show on the row. Kinds,
 * labels and tones are the shared noise-decision vocabulary in `incident-ux/explain.ts`.
 */
export type AlertDecisionLabelKind = NoiseDecisionKind;
export const ALERT_DECISION_LABELS = NOISE_DECISION_LABELS;

export const ALERT_DECISION_OPTIONS: ReadonlyArray<{ value: AlertDecisionKind; label: string }> = [
  { value: 'suppressed', label: ALERT_DECISION_LABELS.suppressed },
  { value: 'deduped', label: ALERT_DECISION_LABELS.deduped },
  { value: 'grouped', label: ALERT_DECISION_LABELS.grouped },
  { value: 'maintenance', label: ALERT_DECISION_LABELS.maintenance },
];

/** Maps a recorded pre-paging decision onto the label responders see. Null when it did nothing. */
export const classifyAlertDecision = classifyNoiseDecision;

export interface AlertListFilters {
  serviceId: string | null;
  severity: AlertSeverity | null;
  decision: AlertDecisionKind | null;
  window: OverviewWindowKey;
  cursor: ListCursor | null;
}

export function parseAlertListFilters(params: Record<string, ListParam> = {}): AlertListFilters {
  const severity = first(params.severity)?.toLowerCase();
  const decision = first(params.decision)?.toLowerCase();
  return {
    serviceId: parseListId(params.service),
    severity: ALERT_SEVERITIES.find(value => value === severity) ?? null,
    decision: ALERT_DECISION_KINDS.find(value => value === decision) ?? null,
    window: parseListWindow(params.window),
    cursor: decodeListCursor(params.cursor),
  };
}

// ── Changes ───────────────────────────────────────────────────────────────────────────────────────────

/** Risk is a 0..1 ranking signal. The bands are shared with the overview's change panel. */
export const RISK_HIGH_THRESHOLD = 0.6;
export const RISK_MEDIUM_THRESHOLD = 0.35;
export const CHANGE_RISK_BANDS = ['high', 'medium', 'low', 'unscored'] as const;
export type ChangeRiskBand = (typeof CHANGE_RISK_BANDS)[number];

export const CHANGE_RISK_LABELS: Readonly<Record<ChangeRiskBand, string>> = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
  unscored: 'Not scored',
};

export const CHANGE_RISK_OPTIONS: ReadonlyArray<{ value: ChangeRiskBand; label: string }> = [
  { value: 'high', label: CHANGE_RISK_LABELS.high },
  { value: 'medium', label: CHANGE_RISK_LABELS.medium },
  { value: 'low', label: CHANGE_RISK_LABELS.low },
  { value: 'unscored', label: CHANGE_RISK_LABELS.unscored },
];

export function changeRiskBand(score: number | null): ChangeRiskBand {
  if (score === null || !Number.isFinite(score)) return 'unscored';
  if (score >= RISK_HIGH_THRESHOLD) return 'high';
  if (score >= RISK_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

export interface ChangeListFilters {
  serviceId: string | null;
  source: string | null;
  risk: ChangeRiskBand | null;
  window: OverviewWindowKey;
  cursor: ListCursor | null;
}

export function parseChangeListFilters(params: Record<string, ListParam> = {}): ChangeListFilters {
  const risk = first(params.risk)?.toLowerCase();
  const source = first(params.source);
  return {
    serviceId: parseListId(params.service),
    source: source && source.length <= 120 ? source : null,
    risk: CHANGE_RISK_BANDS.find(value => value === risk) ?? null,
    window: parseListWindow(params.window),
    cursor: decodeListCursor(params.cursor),
  };
}

/** Query string for a list page: only non-default filters, in the given order, so links are shareable. */
export function listQueryString(
  values: Record<string, string | null | undefined>,
  defaults: Record<string, string> = { window: DEFAULT_LIST_WINDOW }
): string {
  const search = new URLSearchParams();
  const defaultFor = new Map(Object.entries(defaults));
  for (const [key, value] of Object.entries(values)) {
    if (!value || defaultFor.get(key) === value) continue;
    search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
