import { z } from 'zod';

/**
 * The one parser for analytics filters. The page, the CSV export and every
 * deep link into /analytics go through here, so a filter means the same thing
 * everywhere and unknown values are dropped instead of trusted.
 */

export const ANALYTICS_RANGES = [
  '24h',
  '7d',
  '30d',
  '90d',
  '180d',
  '365d',
  '730d',
  '1095d',
] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number] | 'custom';
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = '30d';

export const ANALYTICS_URGENCIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const ANALYTICS_STATUSES = [
  'ACTIVE',
  'OPEN',
  'ACKNOWLEDGED',
  'SNOOZED',
  'SUPPRESSED',
  'RESOLVED',
] as const;
export const UNASSIGNED = 'unassigned';

const MAX_IDS = 50;
const MAX_CUSTOM_DAYS = 1096; // 3 years
const DAY_MS = 86_400_000;

export type AnalyticsParams = {
  range: AnalyticsRange;
  /** Only set when range is 'custom'. Half-open: [from, to). */
  from?: Date;
  to?: Date;
  compare: boolean;
  teams: string[];
  services: string[];
  priorities: string[];
  urgency?: (typeof ANALYTICS_URGENCIES)[number];
  status?: (typeof ANALYTICS_STATUSES)[number];
  /** A user id, or UNASSIGNED. */
  assignee?: string;
};

type RawParams = URLSearchParams | Record<string, string | string[] | undefined> | null | undefined;

const id = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform(value => new Date(`${value}T00:00:00.000Z`))
  .refine(date => Number.isFinite(date.getTime()));

function all(raw: RawParams, key: string): string[] {
  if (!raw) return [];
  if (raw instanceof URLSearchParams) return raw.getAll(key).flatMap(v => v.split(','));
  // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
  const value = raw[key];
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).flatMap(v => v.split(','));
}

const first = (raw: RawParams, key: string) => all(raw, key)[0];

function ids(raw: RawParams, key: string): string[] {
  const valid = all(raw, key).filter(value => id.safeParse(value).success);
  return [...new Set(valid)].sort().slice(0, MAX_IDS);
}

function oneOf<T extends readonly string[]>(values: T, value: string | undefined) {
  const upper = value?.toUpperCase();
  return (values as readonly string[]).includes(upper ?? '') ? (upper as T[number]) : undefined;
}

/** Old links used ?window=30 (page) and ?range=30 (dashboard); map day counts onto presets. */
function legacyRange(value: string | undefined): AnalyticsRange | undefined {
  if (!value) return undefined;
  if ((ANALYTICS_RANGES as readonly string[]).includes(value)) return value as AnalyticsRange;
  const days = Number(value);
  if (!Number.isInteger(days) || days <= 0) return undefined;
  if (days <= 1) return '24h';
  return ANALYTICS_RANGES.find(range => range !== '24h' && parseInt(range, 10) >= days) ?? '1095d';
}

export function parseAnalyticsParams(raw: RawParams): AnalyticsParams {
  let range: AnalyticsRange =
    legacyRange(first(raw, 'range')) ??
    legacyRange(first(raw, 'window')) ??
    DEFAULT_ANALYTICS_RANGE;
  let from: Date | undefined;
  let to: Date | undefined;

  const fromParsed = isoDay.safeParse(first(raw, 'from'));
  const toParsed = isoDay.safeParse(first(raw, 'to'));
  if (fromParsed.success && toParsed.success) {
    // `to` is an inclusive calendar day in the UI; store the exclusive end.
    const end = new Date(toParsed.data.getTime() + DAY_MS);
    const days = (end.getTime() - fromParsed.data.getTime()) / DAY_MS;
    if (days >= 1 && days <= MAX_CUSTOM_DAYS) {
      range = 'custom';
      from = fromParsed.data;
      to = end;
    }
  }

  const assigneeRaw = first(raw, 'assignee');
  const assignee =
    assigneeRaw === UNASSIGNED || (assigneeRaw && id.safeParse(assigneeRaw).success)
      ? assigneeRaw
      : undefined;

  return {
    range,
    ...(from && to ? { from, to } : {}),
    compare: first(raw, 'compare') !== '0',
    teams: ids(raw, 'team'),
    services: ids(raw, 'service'),
    priorities: ids(raw, 'priority'),
    urgency: oneOf(ANALYTICS_URGENCIES, first(raw, 'urgency')),
    status: oneOf(ANALYTICS_STATUSES, first(raw, 'status')),
    assignee,
  };
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/** Inverse of parseAnalyticsParams; omits defaults so URLs stay short. */
export function toAnalyticsSearchParams(params: AnalyticsParams): URLSearchParams {
  const out = new URLSearchParams();
  if (params.range === 'custom' && params.from && params.to) {
    out.set('from', day(params.from));
    out.set('to', day(new Date(params.to.getTime() - DAY_MS)));
  } else if (params.range !== DEFAULT_ANALYTICS_RANGE) {
    out.set('range', params.range);
  }
  if (!params.compare) out.set('compare', '0');
  for (const team of params.teams) out.append('team', team);
  for (const service of params.services) out.append('service', service);
  for (const priority of params.priorities) out.append('priority', priority);
  if (params.urgency) out.set('urgency', params.urgency);
  if (params.status) out.set('status', params.status);
  if (params.assignee) out.set('assignee', params.assignee);
  return out;
}

/** Stable identity of the filter set; used for cache keys and Suspense keys. */
export function analyticsParamsKey(params: AnalyticsParams): string {
  return toAnalyticsSearchParams(params).toString();
}

export function hasActiveAnalyticsFilters(params: AnalyticsParams): boolean {
  return Boolean(
    params.teams.length ||
    params.services.length ||
    params.priorities.length ||
    params.urgency ||
    params.status ||
    params.assignee
  );
}

/** The id shape every analytics filter accepts; reuse it to validate other client ids. */
export { id as analyticsIdSchema };
