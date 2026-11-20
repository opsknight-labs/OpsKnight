import * as z from 'zod/v3';

/**
 * Natural language → the analytics page's own filter object (team, service, assignee, status, urgency,
 * window). Never SQL: the result only ever becomes the same query string the filter bar writes, and every
 * name is resolved against options the person may already read.
 */
export const ANALYTICS_STATUSES = [
  'OPEN',
  'ACKNOWLEDGED',
  'SNOOZED',
  'SUPPRESSED',
  'RESOLVED',
] as const;
export const ANALYTICS_URGENCIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const ANALYTICS_WINDOWS = [1, 3, 7, 14, 30, 60, 90, 180, 365] as const;
export const ANALYTICS_QUERY_MAX_CHARS = 300;

/** The structured-output schema: the filter object with names instead of ids. */
export const analyticsQuerySchema = z
  .object({
    team: z.string().max(120).nullable(),
    service: z.string().max(120).nullable(),
    assignee: z.string().max(120).nullable(),
    status: z.enum(ANALYTICS_STATUSES).nullable(),
    urgency: z.enum(ANALYTICS_URGENCIES).nullable(),
    windowDays: z.number().int().min(1).max(365).nullable(),
  })
  .strict();
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export interface AnalyticsQueryOptions {
  teams: ReadonlyArray<{ id: string; name: string }>;
  services: ReadonlyArray<{ id: string; name: string }>;
  users: ReadonlyArray<{ id: string; name: string | null; email: string | null }>;
}

/** The page's own filter params; only ids from the options and values from the fixed lists. */
export interface AnalyticsFilterParams {
  team?: string;
  service?: string;
  assignee?: string;
  status?: (typeof ANALYTICS_STATUSES)[number];
  urgency?: (typeof ANALYTICS_URGENCIES)[number];
  window?: string;
}

const STATUS_WORDS: Array<[RegExp, AnalyticsQuery['status']]> = [
  [/\b(?:open|unresolved|active)\b/, 'OPEN'],
  [/\b(?:acknowledged|acked|ack)\b/, 'ACKNOWLEDGED'],
  [/\bsnoozed\b/, 'SNOOZED'],
  [/\bsuppressed\b/, 'SUPPRESSED'],
  [/\b(?:resolved|closed)\b/, 'RESOLVED'],
];
const URGENCY_WORDS: Array<[RegExp, AnalyticsQuery['urgency']]> = [
  [/\b(?:high|urgent|critical|sev ?1|p1)\b/, 'HIGH'],
  [/\b(?:medium|sev ?2|p2)\b/, 'MEDIUM'],
  [/\b(?:low|sev ?3|p3)\b/, 'LOW'],
];
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, quarter: 90, year: 365 };

function windowFrom(text: string): number | null {
  const counted = text.match(
    /\b(?:last|past|previous)?\s*(\d{1,3})\s*(day|week|month|quarter|year)s?\b/
  );

  if (counted) return Number(counted[1]) * UNIT_DAYS[counted[2]];
  if (/\b(?:today|24 ?h(?:ours)?|yesterday)\b/.test(text)) return 1;
  const single = text.match(/\b(?:this|last|past|previous)\s+(day|week|month|quarter|year)\b/);

  return single ? UNIT_DAYS[single[1]] : null;
}

/** The longest option name the text mentions, so "checkout api" wins over "checkout". */
function mentioned<T extends { name: string | null }>(
  text: string,
  options: readonly T[]
): T | null {
  let best: T | null = null;
  for (const option of options) {
    const name = option.name?.trim().toLowerCase();
    if (name && name.length >= 2 && text.includes(name) && name.length > (best?.name?.length ?? 0))
      best = option;
  }
  return best;
}

/** The no-AI path: keywords and option names in the sentence. */
export function parseAnalyticsQuery(input: string, options: AnalyticsQueryOptions): AnalyticsQuery {
  const text = input.toLowerCase().slice(0, ANALYTICS_QUERY_MAX_CHARS);
  return {
    team: mentioned(text, options.teams)?.name ?? null,
    service: mentioned(text, options.services)?.name ?? null,
    assignee: mentioned(text, options.users)?.name ?? null,
    status: STATUS_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null,
    urgency: URGENCY_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null,
    windowDays: windowFrom(text),
  };
}

/** The allowed window closest to what was asked, so "2 weeks" reads as 14 and "6 months" as 180. */
function snapWindow(days: number): number {
  return ANALYTICS_WINDOWS.reduce((best, candidate) =>
    Math.abs(candidate - days) < Math.abs(best - days) ? candidate : best
  );
}

function byName<T extends { id: string; name: string | null; email?: string | null }>(
  value: string | null,
  options: readonly T[]
): string | undefined {
  const wanted = value?.trim().toLowerCase();
  if (!wanted) return undefined;
  return options.find(
    option => option.name?.toLowerCase() === wanted || option.email?.toLowerCase() === wanted
  )?.id;
}

/** Names → readable ids; anything unknown is dropped rather than guessed. */
export function toAnalyticsFilters(
  query: AnalyticsQuery,
  options: AnalyticsQueryOptions
): AnalyticsFilterParams {
  const filters: AnalyticsFilterParams = {};
  const team = byName(query.team, options.teams);
  const service = byName(query.service, options.services);
  const assignee = byName(query.assignee, options.users);
  if (team) filters.team = team;
  if (service) filters.service = service;
  if (assignee) filters.assignee = assignee;
  if (query.status) filters.status = query.status;
  if (query.urgency) filters.urgency = query.urgency;
  if (query.windowDays) filters.window = String(snapWindow(query.windowDays));
  return filters;
}

export function analyticsHref(filters: AnalyticsFilterParams): string {
  const params = new URLSearchParams(filters as Record<string, string>);
  const query = params.toString();
  return query ? `/insights?${query}` : '/insights';
}
