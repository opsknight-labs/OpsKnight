import type { Prisma } from '@prisma/client';
import {
  addDaysToDateKey,
  formatDateKeyInTimeZone,
  isValidTimeZone,
  startOfDayFromDateKey,
} from '@/lib/timezone';

const STOP = new Set(
  'did has had have need needs want wants your our within during postmortem postmortems follow-up follow-ups on-call oncall call tomorrow fire broken down happening triggered weekly monthly daily ongoing critical not no acked unacked completed enabled disabled configured since between period duration point-in-time inventory catalog contact help suggest recommended compare compared comparison versus vs per reporting report rate records record workbooks unacked noisiest blockers blocked portfolio across a an the me my mine i we us please show find search list tell about what which who how many much number count total incidents incident outages outage alerts alert services service health healthy status owner owns owning ownership team teams for of in on with and or from since during last past this week weeks month months days day hours hour today yesterday recent recently latest open opened active closed resolved acknowledged suppressed snoozed high medium low urgency priority assigned unassigned unresolved pending current now right are is was were been has have had to do does can could would you your check get all any there happened changed changes change deployments deployment deploy deploys releases release runbooks runbook available published catalog find fixes fix remediation playbooks playbook top most noisy noisiest noise impacted affected overview summary summarize summarise statistics stats analytics trend trends mttr average mean time resolution resolve acknowledge unacknowledged still than older ago notes note details information dependencies dependency upstream downstream escalation policy routing next schedule schedules coverage responders responder working work queue workload action actions item items tasks task follow followup followups overdue completed complete done at it that these those more also else even by breakdown grouped group mtta acknowledgement'.split(
    ' '
  )
);
export function keywords(message: string): string[] {
  const quoted = message.match(/["“]([^"”]{1,120})["”]/)?.[1];
  return [
    ...new Set(
      ((quoted ?? message).toLowerCase().match(/[a-z0-9][a-z0-9_.-]*/g) ?? []).filter(
        token =>
          token.length >= 2 &&
          (Boolean(quoted) || (!STOP.has(token) && !/^(?:\d+|p[0-5])$/.test(token)))
      )
    ),
  ].slice(0, 6);
}
export interface BasicQuery {
  terms: string[];
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';
  active: boolean;
  priority?: string;
  urgency?: 'HIGH' | 'MEDIUM' | 'LOW';
  mine: boolean;
  myTeams: boolean;
  dateField: 'createdAt' | 'resolvedAt' | 'acknowledgedAt';
  unassigned: boolean;
  window?: { gte: Date; lt: Date; label: string };
  /** Resolved from a named team ("the payments team"); ids only, already checked for visibility. */
  teamIds?: string[];
  /** Resolved from a named person ("assigned to Alice"); an id already checked for visibility. */
  assigneeId?: string;
  error?: string;
}
export function parseBasicQuery(message: string, now = new Date(), timezone = 'UTC'): BasicQuery {
  const text = message.replace(/["“][^"”]{1,120}["”]/g, ' ').toLowerCase();
  const tz = isValidTimeZone(timezone) ? timezone : 'UTC';
  const key = formatDateKeyInTimeZone(now, tz);
  const query: BasicQuery = {
    terms: keywords(message),
    priority: text.match(/\bp[0-5]\b/i)?.[0].toUpperCase(),
    status: /\b(unresolved|not resolved|not closed)\b/.test(text)
      ? undefined
      : /\b(resolved|closed)\b/.test(text)
        ? 'RESOLVED'
        : /\b(unacknowledged|not acknowledged|unacked)\b/.test(text)
          ? 'OPEN'
          : /\b(acknowledged|acked)\b/.test(text)
            ? 'ACKNOWLEDGED'
            : /\bsnoozed\b/.test(text)
              ? 'SNOOZED'
              : /\bsuppressed\b/.test(text)
                ? 'SUPPRESSED'
                : /\b(open|opened|triggered)\b/.test(text)
                  ? 'OPEN'
                  : undefined,
    active:
      /\b(active|unresolved|not resolved|not closed|workload|work queue|my queue|unassigned)\b/.test(
        text
      ),
    urgency: /\b(high|critical)\b/.test(text)
      ? 'HIGH'
      : /\bmedium\b/.test(text)
        ? 'MEDIUM'
        : /\blow\b/.test(text)
          ? 'LOW'
          : undefined,
    mine: !/\bmy teams?\b/.test(text) && /\b(my|mine|assigned to me|for me)\b/.test(text),
    myTeams: /\bmy teams?\b/.test(text),
    dateField:
      /\b(resolved|closed)\b/.test(text) && !/\b(unresolved|not resolved|not closed)\b/.test(text)
        ? 'resolvedAt'
        : /\backnowledged\b/.test(text) && !/\b(unacknowledged|not acknowledged)\b/.test(text)
          ? 'acknowledgedAt'
          : 'createdAt',
    unassigned: /\b(unassigned|no assignee|nobody assigned)\b/.test(text),
  };
  const rolling = text.match(/\b(?:last|past)\s+(\d{1,5})\s+(hours?|days?|weeks?|months?)\b/);
  const explicit = rolling ? null : parseExplicitWindow(text, now, tz, key);
  if (explicit && 'error' in explicit) query.error = explicit.error;
  else if (explicit) query.window = explicit;
  if (/\b(years?|since|between)\b/.test(text) && !rolling && !explicit)
    query.error =
      'Use today, yesterday, this week, this month, a date such as “since 2026-11-01” or “between Monday and Wednesday”, or a rolling window such as “past 7 days” (up to 90 days).';
  if (query.window && !rolling) {
    /* An explicit date window was parsed above. */
  } else if (rolling) {
    const count = Number(rolling[1]);
    const multiplier = rolling[2].startsWith('hour')
      ? 3600000
      : rolling[2].startsWith('week')
        ? 7 * 86400000
        : rolling[2].startsWith('month')
          ? 30 * 86400000
          : 86400000;
    const duration = count * multiplier;
    if (count < 1 || duration > 90 * 86400000)
      query.error = 'Choose a time window between 1 hour and 90 days.';
    else
      query.window = {
        gte: new Date(now.getTime() - duration),
        lt: now,
        label: `the past ${count} ${rolling[2]}`,
      };
  } else if (/\byesterday\b/.test(text)) {
    query.window = {
      gte: startOfDayFromDateKey(addDaysToDateKey(key, -1), tz),
      lt: startOfDayFromDateKey(key, tz),
      label: `yesterday (${tz})`,
    };
  } else if (/\btoday\b/.test(text)) {
    query.window = { gte: startOfDayFromDateKey(key, tz), lt: now, label: `today (${tz})` };
  } else if (/\bthis week\b/.test(text)) {
    const day = new Date(`${key}T12:00:00Z`).getUTCDay();
    query.window = {
      gte: startOfDayFromDateKey(addDaysToDateKey(key, -((day + 6) % 7)), tz),
      lt: now,
      label: `this week so far (${tz}, Monday start)`,
    };
  } else if (/\bthis month\b/.test(text)) {
    query.window = {
      gte: startOfDayFromDateKey(`${key.slice(0, 7)}-01`, tz),
      lt: now,
      label: `this month so far (${tz})`,
    };
  } else if (/\b(last|past) week\b/.test(text))
    query.window = {
      gte: new Date(now.getTime() - 7 * 86400000),
      lt: now,
      label: 'the past 7 days',
    };
  else if (/\b(last|past) month\b/.test(text))
    query.window = {
      gte: new Date(now.getTime() - 30 * 86400000),
      lt: now,
      label: 'the past 30 days',
    };
  if (query.mine && query.unassigned)
    query.error =
      'Choose either incidents assigned to you or unassigned incidents. For your team’s unassigned incidents, ask “Show my team’s unassigned incidents”.';
  if (/\b(not high|not medium|not low)\b/.test(text))
    query.error = 'Choose an explicit urgency filter: HIGH, MEDIUM or LOW.';
  return query;
}
export function incidentQueryWhere(
  query: BasicQuery,
  actorId: string,
  readable: Prisma.IncidentWhereInput,
  teamIds: readonly string[] = []
): Prisma.IncidentWhereInput {
  return {
    AND: [
      readable,
      ...query.terms.map(term => ({
        OR: [
          { title: { contains: term, mode: 'insensitive' as const } },
          { service: { name: { contains: term, mode: 'insensitive' as const } } },
        ],
      })),
      ...(query.status
        ? [{ status: query.status }]
        : query.active
          ? [{ status: { in: ['OPEN' as const, 'ACKNOWLEDGED' as const] } }]
          : []),
      ...(query.priority ? [{ priority: query.priority }] : []),
      ...(query.urgency ? [{ urgency: query.urgency }] : []),
      ...(query.mine ? [{ assigneeId: actorId }] : []),
      ...(query.myTeams
        ? [
            {
              OR: [{ teamId: { in: [...teamIds] } }, { service: { teamId: { in: [...teamIds] } } }],
            },
          ]
        : []),
      ...(query.unassigned ? [{ assigneeId: null, teamId: null }] : []),
      ...(query.teamIds?.length
        ? [
            {
              OR: [
                { teamId: { in: [...query.teamIds] } },
                { service: { teamId: { in: [...query.teamIds] } } },
              ],
            },
          ]
        : []),
      ...(query.assigneeId ? [{ assigneeId: query.assigneeId }] : []),
      ...(query.window
        ? [
            query.dateField === 'resolvedAt'
              ? { resolvedAt: { gte: query.window.gte, lt: query.window.lt } }
              : query.dateField === 'acknowledgedAt'
                ? { acknowledgedAt: { gte: query.window.gte, lt: query.window.lt } }
                : { createdAt: { gte: query.window.gte, lt: query.window.lt } },
          ]
        : []),
    ],
  };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MS = 86_400_000;
const MAX_WINDOW_DAYS = 90;
const WEEKDAY =
  '(?:last |this |past )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|(?<=last |this |on |since |from |to |and )(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun))';
const DATE_EXPR = `(?:\\d{4}-\\d{2}-\\d{2}|today|yesterday|${WEEKDAY}|\\d{1,2}(?:st|nd|rd|th)? (?:of )?[a-z]{3,9}(?: \\d{4})?|[a-z]{3,9} \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?)`;
// The alternation is a fixed list of bounded shapes, so matching stays linear.

const BETWEEN = new RegExp(
  `\\b(?:between|from)\\s+(${DATE_EXPR})\\s+(?:and|to|until|till)\\s+(${DATE_EXPR})\\b`
);

const SINCE = new RegExp(`\\bsince\\s+(${DATE_EXPR})\\b`);

const ON_DAY = new RegExp(`\\b(?:on\\s+)?(${DATE_EXPR})\\b`);

function dayKeyOf(date: Date, tz: string): string {
  return formatDateKeyInTimeZone(date, tz);
}

/** A calendar day for a date expression, as a YYYY-MM-DD key in `tz`, or null when it is not one. */
export function resolveDayKey(
  expression: string,
  nowKey: string,
  allowFuture = false
): string | null {
  const expr = expression
    .trim()
    .toLowerCase()
    .replace(/(\d)(?:st|nd|rd|th)\b/g, '$1');
  const [year, month, day] = nowKey.split('-').map(Number);
  const todayUtc = Date.UTC(year, month - 1, day);
  const keyOf = (utc: number) => new Date(utc).toISOString().slice(0, 10);
  const guard = (utc: number) => (!allowFuture && utc > todayUtc ? null : keyOf(utc));
  if (expr === 'today') return nowKey;
  if (expr === 'yesterday') return keyOf(todayUtc - DAY_MS);
  const iso = expr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const utc = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (Number.isNaN(utc) || keyOf(utc) !== expr) return null;
    return guard(utc);
  }
  const weekday = expr.match(/^(last |this |past )?([a-z]{3,9})$/);
  if (weekday) {
    const index = WEEKDAYS.findIndex(name => name.startsWith(weekday[2].slice(0, 3)));
    if (index === -1 || !['', 'last ', 'this ', 'past '].includes(weekday[1] ?? '')) return null;
    const todayIndex = new Date(todayUtc).getUTCDay();
    let back = (todayIndex - index + 7) % 7;
    if (weekday[1] === 'last ' || weekday[1] === 'past ') back = back === 0 ? 7 : back;
    if (weekday[1] === 'this ') {
      // Within the current Monday-start week; a day still ahead is not a day with incidents yet.
      const sinceMonday = (todayIndex + 6) % 7;
      const offset = (index + 6) % 7;
      if (offset > sinceMonday) return null;
      back = sinceMonday - offset;
    }
    return keyOf(todayUtc - back * DAY_MS);
  }
  // eslint-disable-next-line security/detect-unsafe-regex -- anchored, bounded quantifiers on a short date expression
  const dayFirst = expr.match(/^(\d{1,2}) (?:of )?([a-z]{3,9})(?: (\d{4}))?$/);
  // eslint-disable-next-line security/detect-unsafe-regex -- anchored, bounded quantifiers on a short date expression
  const monthFirst = expr.match(/^([a-z]{3,9}) (\d{1,2})(?:,? (\d{4}))?$/);
  const dayText = dayFirst?.[1] ?? monthFirst?.[2];
  const monthText = dayFirst?.[2] ?? monthFirst?.[1];
  const yearText = dayFirst?.[3] ?? monthFirst?.[3];
  if (dayText && monthText) {
    const monthIndex = MONTHS.findIndex(name => monthText.startsWith(name));
    const dayNumber = Number(dayText);
    if (monthIndex === -1 || dayNumber < 1 || dayNumber > 31) return null;
    let utc = Date.UTC(yearText ? Number(yearText) : year, monthIndex, dayNumber);
    if (new Date(utc).getUTCDate() !== dayNumber) return null;
    if (!yearText && utc > todayUtc) utc = Date.UTC(year - 1, monthIndex, dayNumber);
    return guard(utc);
  }
  return null;
}

/**
 * Explicit calendar expressions: "since 2026-11-01", "between Monday and Wednesday", "on 5 Nov", "last
 * Friday". Days are whole local days in `tz`; the window is capped at 90 days and may not be in the future.
 */
export function parseExplicitWindow(
  text: string,
  now: Date,
  tz: string,
  key = dayKeyOf(now, tz)
): { gte: Date; lt: Date; label: string } | { error: string } | null {
  const tooLong = { error: 'Choose a time window between 1 hour and 90 days.' };
  const future = { error: 'That date is in the future. Choose a day up to today.' };
  const dayStart = (dayKey: string) => startOfDayFromDateKey(dayKey, tz);
  const between = text.match(BETWEEN);
  if (between) {
    const start = resolveDayKey(between[1], key);
    const end = resolveDayKey(between[2], key);
    if (!start || !end)
      return resolveDayKey(between[1], key, true) || resolveDayKey(between[2], key, true)
        ? future
        : null;
    const [from, to] = start <= end ? [start, end] : [end, start];
    const gte = dayStart(from);
    const lt = new Date(Math.min(dayStart(addDaysToDateKey(to, 1)).getTime(), now.getTime()));
    if (lt.getTime() - gte.getTime() > MAX_WINDOW_DAYS * DAY_MS) return tooLong;
    return { gte, lt, label: `${from} to ${to} (${tz})` };
  }
  const since = text.match(SINCE);
  if (since) {
    const start = resolveDayKey(since[1], key);
    if (!start) return resolveDayKey(since[1], key, true) ? future : null;
    const gte = dayStart(start);
    if (now.getTime() - gte.getTime() > MAX_WINDOW_DAYS * DAY_MS) return tooLong;
    return { gte, lt: now, label: `since ${start} (${tz})` };
  }
  const on = text.match(ON_DAY);
  if (on && !/^(today|yesterday)$/.test(on[1])) {
    const day = resolveDayKey(on[1], key);
    if (!day) return resolveDayKey(on[1], key, true) ? future : null;
    const gte = dayStart(day);
    if (now.getTime() - gte.getTime() > MAX_WINDOW_DAYS * DAY_MS) return tooLong;
    const weekdayName = WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
    return {
      gte,
      lt: new Date(Math.min(dayStart(addDaysToDateKey(day, 1)).getTime(), now.getTime())),
      label: `${weekdayName[0].toUpperCase()}${weekdayName.slice(1)} ${day} (${tz})`,
    };
  }
  return null;
}

/** Reuse earlier questions as query intent only; new time/status/urgency filters replace the old ones. */
const TIME_FILTER =
  /\b(today|yesterday|this week|this month|(?:last|past) \d{1,5} (?:hours?|days?|weeks?|months?)|(?:last|past) (?:week|month)|since \S+|between \S+ and \S+|(?:last |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi;
export function mergeBasicQuestion(previous: string, current: string): string {
  let base = previous.replace(/\s+/g, ' ');
  if ((/["“][^"”]+["”]/.test(current) || /\bfor\b/i.test(current)) && keywords(current).length) {
    const previousTerms = new Set(keywords(previous));
    base = base
      .replace(/["“][^"”]*["”]/g, '')
      .split(/(\s+)/)
      .map(part => (previousTerms.has(part.toLowerCase().replace(/[^a-z0-9_.-]/g, '')) ? '' : part))
      .join('');
  }
  if (current.match(TIME_FILTER)) base = base.replace(TIME_FILTER, '');
  if (/\b(open|resolved|closed|acknowledged|snoozed|suppressed|unresolved)\b/i.test(current))
    base = base.replace(
      /\b(open|resolved|closed|acknowledged|snoozed|suppressed|unresolved)\b/gi,
      ''
    );
  if (/\b(high|medium|low)\b/i.test(current)) base = base.replace(/\b(high|medium|low)\b/gi, '');
  return `${base} ${current}`.slice(0, 4000);
}
