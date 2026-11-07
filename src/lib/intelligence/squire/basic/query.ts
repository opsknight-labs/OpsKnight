import type { Prisma } from '@prisma/client';
import {
  addDaysToDateKey,
  formatDateKeyInTimeZone,
  isValidTimeZone,
  startOfDayFromDateKey,
} from '@/lib/timezone';

const STOP = new Set(
  'did has had have need needs want wants your our within during postmortem postmortems follow-up follow-ups on-call oncall call tomorrow fire broken down happening triggered weekly monthly daily ongoing critical not no acked unacked completed enabled disabled configured since between period duration point-in-time inventory catalog contact help suggest recommended compare compared comparison versus vs per reporting report rate records record workbooks unacked noisiest blockers blocked portfolio across a an the me my mine i we us please show find search list tell about what which who how many much number count total incidents incident outages outage alerts alert services service health healthy status owner owns owning ownership team teams for of in on with and or from since during last past this week weeks month months days day hours hour today yesterday recent recently latest open opened active closed resolved acknowledged suppressed snoozed high medium low urgency priority assigned unassigned unresolved pending current now right are is was were been has have had to do does can could would you your check get all any there happened changed changes change deployments deployment deploy deploys releases release runbooks runbook available published catalog find fixes fix remediation playbooks playbook top most noisy noisiest noise impacted affected overview summary summarize summarise statistics stats analytics trend trends mttr average mean time resolution resolve acknowledge unacknowledged still than older ago notes note details information dependencies dependency upstream downstream escalation policy routing next schedule schedules coverage responders responder working work queue workload action actions item items tasks task follow followup followups overdue completed complete done at it that these those more also else even'.split(
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
  if (/\b(years?|since|between)\b/.test(text) && !rolling)
    query.error =
      'Use today, yesterday, this week, this month, or a rolling window such as “past 7 days” (up to 90 days).';
  if (rolling) {
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

/** Reuse earlier questions as query intent only; new time/status/urgency filters replace the old ones. */
const TIME_FILTER =
  /\b(today|yesterday|this week|this month|(?:last|past) \d{1,5} (?:hours?|days?|weeks?|months?)|(?:last|past) (?:week|month))\b/gi;
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
