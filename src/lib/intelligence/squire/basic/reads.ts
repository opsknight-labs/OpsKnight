import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AuthorizationError } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  actionItemReadWhere,
  incidentReadWhere,
  postmortemReadWhere,
  runbookReadWhere,
  scheduleReadWhere,
  serviceReadWhere,
} from '@/lib/authorization-filters';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import { isValidTimeZone } from '@/lib/timezone';
import { redactSecrets } from '../../ai/redact';
import type { EvidenceSnapshot } from '../evidence';
import type { ReadableIncident } from '../deterministic';
import type { SquireIntent } from '../intents';
import { incidentQueryWhere, parseBasicQuery, type BasicQuery } from './query';
import { TIMEZONE_TTL_MS, TtlCache } from './cache';

export type CollectBasicEvidence = (source: EvidenceSnapshot) => void;

/** Rows per page in list answers; "show more" continues from `offset`. */
export const BASIC_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 20;
/** Resolved incidents examined for MTTR/MTTA in one report; bounded so a report never scans a whole history. */
const DURATION_SAMPLE = 5_000;

export interface BasicReadOptions {
  offset?: number;
  limit?: number;
  groupBy?: 'service' | 'team' | 'urgency' | 'status' | 'priority' | 'day' | 'hour';
  teamIds?: string[];
  assigneeId?: string;
  /** The service of the page the person is on, used when the question names none. */
  contextService?: string | null;
  /** The schedule of the page the person is on, for on-call questions. */
  scheduleId?: string | null;
}

export interface BasicReadResult {
  text: string;
  total?: number;
  hasMore?: boolean;
}

type Context = {
  actor: AuthorizationActor;
  now: Date;
  timeZone: string;
  query: BasicQuery;
  message: string;
  incident: ReadableIncident | null;
  collect?: CollectBasicEvidence;
  offset: number;
  limit: number;
  options: BasicReadOptions;
};
const LIMIT = BASIC_PAGE_SIZE;
const timeZones = new TtlCache<string>(TIMEZONE_TTL_MS, 5_000);
const safe = (value: string | null | undefined, limit = 240) =>
  redactSecrets(value ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, limit)
    .replace(/[\\`*_{}\[\]()<>|#]/g, '\\$&');
const stamp = (ctx: Context) =>
  `As of ${new Intl.DateTimeFormat('en-GB', { timeZone: ctx.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(ctx.now)} (${ctx.timeZone}). Only data you can read is included.`;
const date = (value: Date, ctx: Context) =>
  `${new Intl.DateTimeFormat('en-GB', { timeZone: ctx.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(value)} (${ctx.timeZone})`;
function filters(ctx: Context): string {
  return `Filters: ${
    [
      ctx.query.mine ? 'assigned to you' : '',
      ctx.query.myTeams ? 'your teams' : '',
      ctx.query.unassigned ? 'no person or team assigned' : '',
      ctx.query.status ?? (ctx.query.active ? 'OPEN or ACKNOWLEDGED' : ''),
      ctx.query.urgency ? `${ctx.query.urgency} urgency` : '',
      ctx.query.priority ?? '',
      ctx.query.terms.length
        ? `keywords: ${ctx.query.terms.map(term => safe(term)).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' · ') || 'all visible incidents'
  }.`;
}
const serviceSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  updatedAt: true,
  targetAckMinutes: true,
  targetResolveMinutes: true,
  escalationPolicyId: true,
  team: { select: { name: true } },
} satisfies Prisma.ServiceSelect;
type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof serviceSelect }>;
async function services(ctx: Context, useIncident = false): Promise<ServiceRow[]> {
  const terms = ctx.query.terms;
  return prisma.service.findMany({
    where: {
      AND: [
        serviceReadWhere(ctx.actor),
        ...(ctx.query.mine || ctx.query.myTeams
          ? [{ teamId: { in: [...ctx.actor.teamIds] } }]
          : []),
        ...(terms.length
          ? terms.map(term => ({ name: { contains: term, mode: 'insensitive' as const } }))
          : ctx.options.contextService
            ? [{ name: ctx.options.contextService }]
            : useIncident && ctx.incident
              ? [{ name: ctx.incident.serviceName }]
              : []),
      ],
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: LIMIT + 1,
    select: serviceSelect,
  });
}
function serviceChoices(rows: ServiceRow[], ctx: Context): string {
  rows
    .slice(0, LIMIT)
    .forEach(row => ctx.collect?.({ kind: 'service', id: row.id, label: row.name, data: row }));
  if (!rows.length)
    return 'No matching service is visible to you. Try its exact name, for example “Who owns Checkout API?”.';
  return [
    'Several services match. Please use one full service name:',
    ...rows.slice(0, LIMIT).map(row => `- ${safe(row.name)} — /services/${row.id}`),
    ...(rows.length > LIMIT ? ['More matches exist; add a more specific name.'] : []),
  ].join('\n');
}
function namedService(rows: ServiceRow[], ctx: Context): ServiceRow | undefined {
  if (rows.length === 1) return rows[0];
  const quoted = ctx.message.match(/["“]([^"”]+)["”]/)?.[1]?.toLowerCase();
  return quoted ? rows.find(row => row.name.toLowerCase() === quoted) : undefined;
}

async function incidentList(ctx: Context): Promise<BasicReadResult> {
  if (ctx.query.mine && !ctx.query.status) ctx.query.active = true;
  const where = incidentQueryWhere(
    ctx.query,
    ctx.actor.id,
    incidentReadWhere(ctx.actor),
    ctx.actor.teamIds
  );
  const [total, rows] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.findMany({
      where,
      orderBy: [{ urgency: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: ctx.offset,
      take: ctx.limit,
      select: {
        id: true,
        title: true,
        status: true,
        urgency: true,
        createdAt: true,
        updatedAt: true,
        service: { select: { name: true } },
        assignee: { select: { name: true } },
        team: { select: { name: true } },
      },
    }),
  ]);
  rows.forEach(row => ctx.collect?.({ kind: 'incident', id: row.id, label: row.title, data: row }));
  const hasMore = ctx.offset + rows.length < total;
  const shown =
    rows.length === 0
      ? ''
      : ctx.offset > 0 || hasMore
        ? ` Showing ${ctx.offset + 1}–${ctx.offset + rows.length} of ${total}, highest urgency first${hasMore ? '; say "show more" for the next page' : ''}.`
        : ` Showing up to ${ctx.limit}, highest urgency first.`;
  return {
    total,
    hasMore,
    text: [
      `## ${ctx.query.mine ? 'Your incident work' : 'Matching incidents'}`,
      filters(ctx),
      `${total} match${total === 1 ? '' : 'es'}${ctx.query.window ? ` in ${ctx.query.window.label}` : ''}.${shown}`,
      ...rows.map(
        row =>
          `- **${safe(row.title)}** — ${safe(row.service.name)}, ${row.status.toLowerCase()}, ${row.urgency.toLowerCase()} urgency; ${row.assignee ? `assigned to ${safe(row.assignee.name) || 'a responder'}` : row.team ? `assigned to team ${safe(row.team.name)}` : 'unassigned'}.\n  Opened ${date(row.createdAt, ctx)}. /incidents/${row.id}`
      ),
      ...(total === 0
        ? [
            'No matching incidents in this view. Try fewer keywords or a wider time window. This does not establish that no incident exists outside your access.',
          ]
        : []),
      stamp(ctx),
    ].join('\n\n'),
  };
}

const GROUP_LABEL: Record<NonNullable<BasicReadOptions['groupBy']>, string> = {
  service: 'service',
  team: 'team',
  urgency: 'urgency',
  status: 'status',
  priority: 'priority',
  day: 'day',
  hour: 'hour of day',
};

/** Counts matching incidents per group; teams and services are named only when the person can read them. */
async function breakdown(
  ctx: Context,
  where: Prisma.IncidentWhereInput,
  by: NonNullable<BasicReadOptions['groupBy']>
): Promise<string> {
  const limit = Math.max(ctx.limit, 10);
  if (by === 'day' || by === 'hour') {
    const rows = await prisma.incident.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: DURATION_SAMPLE,
      select: { createdAt: true },
    });
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: ctx.timeZone,
      ...(by === 'day' ? { dateStyle: 'medium' } : { hour: '2-digit', hour12: false }),
    });
    const buckets = new Map<string, number>();
    for (const row of rows) {
      const bucket =
        by === 'day' ? formatter.format(row.createdAt) : `${formatter.format(row.createdAt)}:00`;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    const lines = [...buckets.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([bucket, count]) => `- ${bucket}: ${count}`);
    // eslint-disable-next-line security/detect-object-injection -- by is a member of the closed groupBy union
    return `### By ${GROUP_LABEL[by]} (${ctx.timeZone}${rows.length === DURATION_SAMPLE ? `, most recent ${DURATION_SAMPLE} only` : ''})\n${lines.join('\n') || 'No incidents in this window.'}`;
  }
  if (by === 'service') {
    const top = await prisma.incident.groupBy({
      by: ['serviceId'],
      where,
      _count: { id: true },
      orderBy: [{ _count: { id: 'desc' } }, { serviceId: 'asc' }],
      take: limit,
    });
    const visible = await prisma.service.findMany({
      where: { AND: [serviceReadWhere(ctx.actor), { id: { in: top.map(row => row.serviceId) } }] },
      select: { id: true, name: true },
    });
    const lines = top.flatMap(row => {
      const service = visible.find(item => item.id === row.serviceId);
      return service ? [`- ${safe(service.name)}: ${row._count.id} — /services/${service.id}`] : [];
    });
    return `### By service\n${lines.join('\n') || 'No readable service breakdown is available.'}`;
  }
  if (by === 'team') {
    const top = await prisma.incident.groupBy({
      by: ['teamId'],
      where,
      _count: { id: true },
      orderBy: [{ _count: { id: 'desc' } }, { teamId: 'asc' }],
      take: limit,
    });
    const ids = top.flatMap(row => (row.teamId ? [row.teamId] : []));
    const teams = ids.length
      ? await prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const lines = top.map(row => {
      const team = row.teamId ? teams.find(item => item.id === row.teamId) : null;
      return `- ${team ? safe(team.name) : row.teamId ? 'a team you cannot see' : 'no team (assigned to a person or unassigned)'}: ${row._count.id}`;
    });
    return `### By team (incident assignment, not service ownership)\n${lines.join('\n') || 'No incidents in this window.'}`;
  }
  const rows = await prisma.incident.groupBy({
    by: [by],
    where,
    _count: { id: true },
    orderBy: [{ _count: { id: 'desc' } }],
    take: limit,
  });
  const lines = rows.map(row => {
    const value = row[by as 'urgency' | 'status' | 'priority'];
    return `- ${value ? safe(String(value)).toLowerCase() : 'not set'}: ${row._count.id}`;
  });
  // eslint-disable-next-line security/detect-object-injection -- by is a member of the closed groupBy union
  return `### By ${GROUP_LABEL[by]}\n${lines.join('\n') || 'No incidents in this window.'}`;
}

async function statistics(ctx: Context): Promise<string> {
  if (!ctx.query.window)
    ctx.query.window = {
      gte: new Date(ctx.now.getTime() - 7 * 86400000),
      lt: ctx.now,
      label: 'the past 7 days',
    };
  const where = incidentQueryWhere(
    ctx.query,
    ctx.actor.id,
    incidentReadWhere(ctx.actor),
    ctx.actor.teamIds
  );
  const window = ctx.query.window;
  const previous = {
    ...ctx.query,
    window: {
      ...window,
      gte: new Date(window.gte.getTime() - (window.lt.getTime() - window.gte.getTime())),
      lt: window.gte,
    },
  };
  const topLimit = Math.max(LIMIT, ctx.options.limit ?? 0);
  const [total, statuses, prior, top, resolved, acknowledged, grouped] = await Promise.all([
    prisma.incident.count({ where }),
    prisma.incident.groupBy({ by: ['status'], where, _count: { id: true } }),
    prisma.incident.count({
      where: incidentQueryWhere(
        previous,
        ctx.actor.id,
        incidentReadWhere(ctx.actor),
        ctx.actor.teamIds
      ),
    }),
    prisma.incident.groupBy({
      by: ['serviceId'],
      where,
      _count: { id: true },
      orderBy: [{ _count: { id: 'desc' } }, { serviceId: 'asc' }],
      take: topLimit,
    }),
    prisma.incident.findMany({
      where: { AND: [where, { status: 'RESOLVED', resolvedAt: { not: null } }] },
      orderBy: [{ resolvedAt: 'desc' }, { id: 'desc' }],
      take: DURATION_SAMPLE + 1,
      select: { id: true, title: true, createdAt: true, resolvedAt: true, updatedAt: true },
    }),
    prisma.incident.findMany({
      where: { AND: [where, { acknowledgedAt: { not: null } }] },
      orderBy: [{ acknowledgedAt: 'desc' }, { id: 'desc' }],
      take: DURATION_SAMPLE,
      select: { createdAt: true, acknowledgedAt: true },
    }),
    ctx.options.groupBy && ctx.options.groupBy !== 'service'
      ? breakdown(ctx, where, ctx.options.groupBy)
      : Promise.resolve(null),
  ]);
  const visibleServices = await prisma.service.findMany({
    where: { AND: [serviceReadWhere(ctx.actor), { id: { in: top.map(row => row.serviceId) } }] },
    select: { id: true, name: true, updatedAt: true },
  });
  visibleServices.forEach(row =>
    ctx.collect?.({ kind: 'service', id: row.id, label: row.name, data: row })
  );
  resolved
    .slice(0, LIMIT)
    .forEach(row => ctx.collect?.({ kind: 'incident', id: row.id, label: row.title, data: row }));
  const valid = resolved
    .slice(0, DURATION_SAMPLE)
    .filter(row => row.resolvedAt && row.resolvedAt >= row.createdAt);
  const average = valid.length
    ? valid.reduce((sum, row) => sum + row.resolvedAt!.getTime() - row.createdAt.getTime(), 0) /
      valid.length /
      60000
    : null;
  const acked = acknowledged.filter(
    row => row.acknowledgedAt && row.acknowledgedAt >= row.createdAt
  );
  const mtta = acked.length
    ? acked.reduce((sum, row) => sum + row.acknowledgedAt!.getTime() - row.createdAt.getTime(), 0) /
      acked.length /
      60000
    : null;
  const topLines = top.flatMap(row => {
    const service = visibleServices.find(item => item.id === row.serviceId);
    return service
      ? [
          `- ${safe(service.name)}: ${row._count.id} incident${row._count.id === 1 ? '' : 's'} — /services/${service.id}`,
        ]
      : [];
  });
  return [
    `## Incident report — ${window.label}`,
    filters(ctx),
    `**${total} incident${total === 1 ? '' : 's'} ${ctx.query.dateField === 'resolvedAt' ? 'resolved' : ctx.query.dateField === 'acknowledgedAt' ? 'acknowledged' : 'created'}** matching your filters; previous equal-length period: **${prior}** (${total - prior >= 0 ? '+' : ''}${total - prior}).`,
    statuses.map(row => `${row.status.toLowerCase()}: ${row._count.id}`).join(' · ') ||
      'No incidents in this reporting window.',
    grouped ?? '',
    `### Services with the most matching incidents\n${topLines.join('\n') || 'No readable service breakdown is available.'}`,
    average === null
      ? 'Mean time to resolution: no valid resolved records in this cohort.'
      : `Mean time to resolution: **${average.toFixed(1)} minutes** across ${valid.length} valid resolved incidents matching this reporting window.${resolved.length > DURATION_SAMPLE ? ` Bounded sample: only the ${DURATION_SAMPLE} most recently resolved matching records were evaluated.` : ''} This is wall-clock resolution time, not SLA paused time.`,
    mtta === null
      ? 'Mean time to acknowledge: no acknowledged records in this cohort.'
      : `Mean time to acknowledge: **${mtta.toFixed(1)} minutes** across ${acked.length} acknowledged incidents${acknowledged.length >= DURATION_SAMPLE ? ` (bounded to the ${DURATION_SAMPLE} most recent)` : ''}.`,
    'Incident counts measure volume, not alert compression, page delivery, customer impact or confirmed service uptime.',
    stamp(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function serviceOverview(ctx: Context): Promise<string> {
  const inventory =
    (!ctx.query.terms.length && !ctx.incident) ||
    /\b(list|show|all|how many|count)\b.*\bservices?\b/i.test(ctx.message);
  const rows = await services(ctx, !inventory);
  if (inventory) {
    rows
      .slice(0, LIMIT)
      .forEach(row => ctx.collect?.({ kind: 'service', id: row.id, label: row.name, data: row }));
    return [
      '## Services you can view',
      `${await prisma.service.count({ where: { AND: [serviceReadWhere(ctx.actor), ...(ctx.query.mine || ctx.query.myTeams ? [{ teamId: { in: [...ctx.actor.teamIds] } }] : []), ...ctx.query.terms.map(term => ({ name: { contains: term, mode: 'insensitive' as const } }))] } })} matching services are visible to you.`,
      ...rows
        .slice(0, LIMIT)
        .map(
          row =>
            `- **${safe(row.name)}** — recorded status: ${row.status.toLowerCase()}; owning team: ${safe(row.team?.name) || 'not set'}. /services/${row.id}`
        ),
      !rows.length
        ? 'No matching services are visible to you.'
        : `Showing up to ${LIMIT} services. Ask about one by its full name for ownership, routing and active incidents.`,
      stamp(ctx),
    ].join('\n\n');
  }
  const service = namedService(rows, ctx);
  if (!service) return serviceChoices(rows, ctx);
  ctx.collect?.({ kind: 'service', id: service.id, label: service.name, data: service });
  const [active, policy, edges] = await Promise.all([
    prisma.incident.findMany({
      where: {
        AND: [
          incidentReadWhere(ctx.actor),
          { serviceId: service.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        ],
      },
      take: LIMIT + 1,
      orderBy: [{ urgency: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, title: true, status: true, urgency: true, updatedAt: true },
    }),
    service.escalationPolicyId
      ? prisma.escalationPolicy.findFirst({
          where: { id: service.escalationPolicyId, archivedAt: null },
          select: {
            name: true,
            steps: {
              take: 10,
              orderBy: { stepOrder: 'asc' },
              select: { delayMinutes: true, targetScheduleId: true },
            },
          },
        })
      : null,
    prisma.serviceDependency.findMany({
      where: {
        status: 'ACTIVE',
        upstream: serviceReadWhere(ctx.actor),
        downstream: serviceReadWhere(ctx.actor),
        OR: [{ upstreamServiceId: service.id }, { downstreamServiceId: service.id }],
      },
      take: 10,
      orderBy: { id: 'asc' },
      select: {
        upstream: { select: { id: true, name: true, updatedAt: true } },
        downstream: { select: { id: true, name: true, updatedAt: true } },
      },
    }),
  ]);
  active
    .slice(0, LIMIT)
    .forEach(row => ctx.collect?.({ kind: 'incident', id: row.id, label: row.title, data: row }));
  edges.forEach(edge => {
    const other = edge.upstream.id === service.id ? edge.downstream : edge.upstream;
    ctx.collect?.({ kind: 'service', id: other.id, label: other.name, data: other });
  });
  return [
    `## ${safe(service.name)}`,
    safe(service.description),
    `Owning team: **${safe(service.team?.name) || 'not configured'}**. Recorded service status: **${service.status.toLowerCase()}**.\n/services/${service.id}`,
    `Escalation policy: ${safe(policy?.name) || 'not configured or archived'}${policy ? `; ${policy.steps.length === 10 ? 'up to ' : ''}${policy.steps.length} steps shown, delays ${policy.steps.map(step => `${step.delayMinutes} min`).join(', ') || 'none'}` : ''}.`,
    `Current service acknowledgement / resolution targets: ${service.targetAckMinutes} / ${service.targetResolveMinutes} minutes. Incident SLA snapshots can differ.`,
    `### Visible active incidents\n${
      active
        .slice(0, LIMIT)
        .map(
          row =>
            `- ${safe(row.title)} — ${row.status.toLowerCase()}, ${row.urgency.toLowerCase()} urgency. /incidents/${row.id}`
        )
        .join('\n') || 'No visible open or acknowledged incidents.'
    }${active.length > LIMIT ? '\nMore active incidents exist; open the service for the full list.' : ''}`,
    `### Recorded dependencies (up to 10)\n${edges.map(edge => (edge.downstream.id === service.id ? `- Depends on ${safe(edge.upstream.name)} — /services/${edge.upstream.id}` : `- Downstream: ${safe(edge.downstream.name)} — /services/${edge.downstream.id}`)).join('\n') || 'No visible active dependency edges recorded.'}`,
    'A configured status, an empty incident list, or missing topology is not proof of service availability.',
    stamp(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function runbooks(ctx: Context): Promise<string> {
  const where: Prisma.RunbookWhereInput = {
    AND: [
      runbookReadWhere(ctx.actor),
      { archivedAt: null },
      ...ctx.query.terms.map(term => ({
        OR: [
          { name: { contains: term, mode: 'insensitive' as const } },
          { description: { contains: term, mode: 'insensitive' as const } },
          { tags: { has: term } },
        ],
      })),
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.runbook.count({ where }),
    prisma.runbook.findMany({
      where,
      take: LIMIT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        tags: true,
        publishedVersionId: true,
        updatedAt: true,
      },
    }),
  ]);
  rows.forEach(row => ctx.collect?.({ kind: 'runbook', id: row.id, label: row.name, data: row }));
  return [
    '## Runbooks you can read',
    `${total} matching non-archived runbooks; showing up to ${LIMIT}.`,
    ...rows.map(
      row =>
        `- **${safe(row.name)}** — ${row.publishedVersionId ? 'published version available' : 'no published version'}${row.description ? `; ${safe(row.description)}` : ''}. /runbooks/${row.id}`
    ),
    !rows.length ? 'No matching runbooks are visible to you. Try a shorter keyword.' : '',
    'These are catalog matches, not proof of suitability or execution permission. Review preview, targets and approvals before running anything.',
    stamp(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function alertStats(ctx: Context): Promise<string> {
  const window = ctx.query.window ?? {
    gte: new Date(ctx.now.getTime() - 7 * 86400000),
    lt: ctx.now,
    label: 'the past 7 days',
  };
  if (ctx.query.status && !['OPEN', 'RESOLVED'].includes(ctx.query.status))
    return 'For alert records, ask for triggered or resolved alerts. Acknowledgement, snooze and assignment are incident workflows; ask about incidents for those states.';
  const linked = incidentQueryWhere(
    { ...ctx.query, terms: [], status: undefined, active: false, window: undefined },
    ctx.actor.id,
    incidentReadWhere(ctx.actor),
    ctx.actor.teamIds
  );
  const where: Prisma.AlertWhereInput = {
    AND: [
      { incident: linked, incidentId: { not: null } },
      ...ctx.query.terms.map(term => ({
        OR: [
          { incident: { title: { contains: term, mode: 'insensitive' as const } } },
          { service: { name: { contains: term, mode: 'insensitive' as const } } },
        ],
      })),
    ],
    createdAt: { gte: window.gte, lt: window.lt },
    ...(ctx.query.status
      ? { status: ctx.query.status === 'RESOLVED' ? 'RESOLVED' : 'TRIGGERED' }
      : {}),
    ...(ctx.incident &&
    !ctx.query.terms.length &&
    !/\b(all services|workspace|across services|all postmortems|all follow[- ]?ups)\b/i.test(
      ctx.message
    )
      ? { incidentId: ctx.incident.id }
      : {}),
  };
  const [total, statuses, rows] = await Promise.all([
    prisma.alert.count({ where }),
    prisma.alert.groupBy({ by: ['status'], where, _count: { id: true } }),
    prisma.alert.findMany({
      where,
      take: LIMIT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true, createdAt: true, service: { select: { name: true } } },
    }),
  ]);
  rows.forEach(row =>
    ctx.collect?.({ kind: 'alert', id: row.id, label: `${row.service.name} alert`, data: row })
  );
  return [
    `## Recorded alerts — ${window.label}`,
    `**${total} alert record${total === 1 ? '' : 's'}** created in this window, linked to incidents you can read. ${statuses.map(row => `${safe(row.status)}: ${row._count.id}`).join(' · ')}`,
    ...rows.map(
      row =>
        `- ${safe(row.service.name)} — ${safe(row.status)}, ${date(row.createdAt, ctx)}. /alerts/${row.id}`
    ),
    'The time filter is alert creation time, not recovery time. These are stored alert records, not distinct outages or pages sent. Unlinked or inaccessible alert records are excluded.',
    stamp(ctx),
  ].join('\n\n');
}

async function changes(ctx: Context): Promise<string> {
  const readable = serviceReadWhere(ctx.actor);
  const window = ctx.query.window ?? {
    gte: new Date(ctx.now.getTime() - 7 * 86400000),
    lt: ctx.now,
    label: 'the past 7 days',
  };
  const rows = await prisma.changeEvent.findMany({
    where: {
      AND: [
        Object.keys(readable).length ? { OR: [{ serviceId: null }, { service: readable }] } : {},
        ...(ctx.incident &&
        !ctx.query.terms.length &&
        !/\b(all services|workspace|across services|all postmortems|all follow[- ]?ups)\b/i.test(
          ctx.message
        )
          ? [{ service: { name: ctx.incident.serviceName } }]
          : []),
        ...ctx.query.terms.map(term => ({
          OR: [
            { summary: { contains: term, mode: 'insensitive' as const } },
            { service: { name: { contains: term, mode: 'insensitive' as const } } },
          ],
        })),
      ],
      occurredAt: { gte: window.gte, lt: window.lt },
      ...(/\b(deploy|deployment|release)s?\b/i.test(ctx.message)
        ? { kind: 'DEPLOY' as const }
        : {}),
    },
    take: LIMIT + 1,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      summary: true,
      kind: true,
      source: true,
      occurredAt: true,
      service: { select: { name: true } },
    },
  });
  rows
    .slice(0, LIMIT)
    .forEach(row => ctx.collect?.({ kind: 'change', id: row.id, label: row.summary, data: row }));
  return [
    `## Recorded changes — ${window.label}`,
    ...rows
      .slice(0, LIMIT)
      .map(
        row =>
          `- **${safe(row.summary)}** — ${row.kind.toLowerCase()}, ${safe(row.service?.name) || 'no service assigned'}, ${date(row.occurredAt, ctx)}. /changes/${row.id}`
      ),
    !rows.length
      ? 'No matching changes are recorded in your visible data for this window.'
      : rows.length > LIMIT
        ? 'More changes match; showing the latest five.'
        : '',
    'Change timing alone does not establish a root cause. This is recorded change history, not an external deployment-system query.',
    stamp(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function followups(ctx: Context): Promise<string> {
  const rows = await prisma.actionItem.findMany({
    where: {
      AND: [
        actionItemReadWhere(ctx.actor),
        ...(ctx.incident &&
        !ctx.query.terms.length &&
        !/\b(all services|workspace|across services|all postmortems|all follow[- ]?ups)\b/i.test(
          ctx.message
        )
          ? [{ incidentId: ctx.incident.id }]
          : []),
        ...ctx.query.terms.map(term => ({
          OR: [
            { title: { contains: term, mode: 'insensitive' as const } },
            { incident: { service: { name: { contains: term, mode: 'insensitive' as const } } } },
          ],
        })),
      ],
      ...(ctx.query.mine ? { ownerId: ctx.actor.id } : {}),
      status: /\b(completed|done)\b/i.test(ctx.message)
        ? 'COMPLETED'
        : { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] },
      ...(/\boverdue\b/i.test(ctx.message) ? { dueDate: { lt: ctx.now } } : {}),
    },
    take: LIMIT + 1,
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      owner: { select: { name: true } },
      incident: { select: { id: true, title: true, updatedAt: true } },
    },
  });
  rows.slice(0, LIMIT).forEach(row =>
    ctx.collect?.({
      kind: 'incident',
      id: row.incident.id,
      label: row.incident.title,
      data: row.incident,
    })
  );
  return [
    '## Follow-up action items',
    ...rows
      .slice(0, LIMIT)
      .map(
        row =>
          `- **${safe(row.title)}** — ${row.status.toLowerCase().replace('_', ' ')}, owner: ${safe(row.owner?.name) || 'unassigned'}, ${row.dueDate ? `due ${date(row.dueDate, ctx)}` : 'no due date'}. /incidents/${row.incident.id}`
      ),
    !rows.length
      ? 'No matching follow-up items are visible to you.'
      : rows.length > LIMIT
        ? 'More items match; showing the first five by due date.'
        : '',
    stamp(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function postmortems(ctx: Context): Promise<string> {
  const rows = await prisma.postmortem.findMany({
    where: {
      AND: [
        postmortemReadWhere(ctx.actor),
        ...(ctx.incident &&
        !ctx.query.terms.length &&
        !/\b(all services|workspace|across services|all postmortems|all follow[- ]?ups)\b/i.test(
          ctx.message
        )
          ? [{ incidentId: ctx.incident.id }]
          : []),
        ...ctx.query.terms.map(term => ({
          OR: [
            { title: { contains: term, mode: 'insensitive' as const } },
            { incident: { service: { name: { contains: term, mode: 'insensitive' as const } } } },
          ],
        })),
      ],
      ...(ctx.query.window
        ? { createdAt: { gte: ctx.query.window.gte, lt: ctx.query.window.lt } }
        : {}),
    },
    take: LIMIT + 1,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: {
      incidentId: true,
      title: true,
      summary: true,
      rootCause: true,
      resolution: true,
      status: true,
      updatedAt: true,
    },
  });
  rows
    .slice(0, LIMIT)
    .forEach(row =>
      ctx.collect?.({ kind: 'postmortem', id: row.incidentId, label: row.title, data: row })
    );
  return [
    '## Recorded postmortems',
    ...rows
      .slice(0, LIMIT)
      .map(
        row =>
          `### ${safe(row.title)}\nStatus: ${safe(row.status)}. ${row.summary ? safe(row.summary) : 'No summary recorded.'}\n${row.rootCause ? `Recorded root cause: ${safe(row.rootCause)}\n` : ''}${row.resolution ? `Recorded resolution: ${safe(row.resolution)}\n` : ''}/postmortems/${row.incidentId}`
      ),
    !rows.length
      ? 'No matching postmortems are visible to you.'
      : rows.length > LIMIT
        ? 'More matches exist; showing the five most recently updated.'
        : '',
    'Draft findings can change; recorded explanations are not independently verified by basic mode.',
    stamp(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function responders(ctx: Context): Promise<string> {
  if (!ctx.incident)
    return 'Open an incident to inspect its current assignee, team and escalation state. For your own work, ask “What is assigned to me?”.';
  const row = await prisma.incident.findFirst({
    where: { AND: [incidentReadWhere(ctx.actor), { id: ctx.incident.id }] },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      assignee: { select: { name: true } },
      team: { select: { name: true } },
      service: { select: { team: { select: { name: true } } } },
      escalationStatus: true,
      nextEscalationAt: true,
      snoozedUntil: true,
    },
  });
  if (!row) return 'This incident is no longer available in your visible data.';
  ctx.collect?.({ kind: 'incident', id: row.id, label: row.title, data: row });
  return [
    `## Responders for ${safe(row.title)}`,
    `Assignee: **${safe(row.assignee?.name) || 'unassigned'}**. Owning team: **${safe(row.team?.name ?? row.service.team?.name) || 'not configured'}**.`,
    `Recorded escalation status: ${safe(row.escalationStatus) || 'not recorded'}${row.nextEscalationAt ? `; next scheduled escalation ${date(row.nextEscalationAt, ctx)}` : ''}.`,
    row.snoozedUntil ? `Snooze recorded until ${date(row.snoozedUntil, ctx)}.` : '',
    `/incidents/${row.id}`,
    'Assignment and a scheduled escalation are not proof of acknowledgement or notification delivery.',
    stamp(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function oncall(ctx: Context): Promise<string> {
  if (/\bnext (week|month|shift|on.?call)\b/i.test(ctx.message))
    return 'For future coverage, ask “Who is on call tomorrow?” or “Who is on call in 2 hours?”. Open Schedules to review a full future rotation.';
  const named =
    ctx.query.terms.length > 0 || Boolean(ctx.incident) || Boolean(ctx.options.contextService);
  let service: ServiceRow | undefined;
  if (named) {
    const rows = await services(ctx, true);
    service = namedService(rows, ctx);
    if (!service) return serviceChoices(rows, ctx);
    ctx.collect?.({ kind: 'service', id: service.id, label: service.name, data: service });
  }
  const rules = service?.escalationPolicyId
    ? await prisma.escalationRule.findMany({
        where: { policyId: service.escalationPolicyId },
        take: 20,
        orderBy: { stepOrder: 'asc' },
        select: { targetScheduleId: true },
      })
    : [];
  const scheduleIds = [
    ...new Set(rules.flatMap(rule => (rule.targetScheduleId ? [rule.targetScheduleId] : []))),
  ];
  if (service && !scheduleIds.length)
    return `No on-call schedule target was found in the checked escalation rules for ${safe(service.name)}. Direct user or team targets may still exist. ${rules.length === 20 ? 'Only the first 20 rules were checked; inspect the policy for further steps.' : ''} I have not substituted unrelated schedules.\n/services/${service.id}`;
  const schedules = await prisma.onCallSchedule.findMany({
    where: {
      AND: [
        scheduleReadWhere(ctx.actor),
        ...(service ? [{ id: { in: scheduleIds } }] : []),
        ...(!service && ctx.options.scheduleId ? [{ id: ctx.options.scheduleId }] : []),
      ],
    },
    take: LIMIT + 1,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, updatedAt: true },
  });
  const offset = ctx.message.match(/\bin (\d{1,5}) hours?\b/i);
  if (offset && (Number(offset[1]) < 1 || Number(offset[1]) > 168))
    return 'Choose a future coverage point between 1 and 168 hours from now. Open Schedules for longer-range planning.';
  const at = /\btomorrow\b/i.test(ctx.message)
    ? new Date(ctx.now.getTime() + 86400000)
    : offset
      ? new Date(ctx.now.getTime() + Math.min(Number(offset[1]), 168) * 3600000)
      : ctx.now;
  const shifts = schedules.length
    ? await getActiveOnCallShifts(at, {
        where: {
          AND: [
            scheduleReadWhere(ctx.actor),
            { id: { in: schedules.slice(0, LIMIT).map(row => row.id) } },
          ],
        },
      })
    : [];
  schedules
    .slice(0, LIMIT)
    .forEach(row => ctx.collect?.({ kind: 'schedule', id: row.id, label: row.name, data: row }));
  return [
    `## On-call coverage${service ? ` for ${safe(service.name)}` : ''}`,
    `Coverage at **${date(at, ctx)}** (a point-in-time lookup, not a full-day coverage guarantee):`,
    ...shifts
      .slice(0, 10)
      .map(
        shift =>
          `- **${safe(shift.user.name) || 'Responder'}** — ${safe(shift.schedule.name)}, until ${date(shift.end, ctx)}. /schedules/${shift.schedule.id}`
      ),
    !shifts.length
      ? 'No active shift was found at that time in the checked schedules. This may be a coverage gap or a scope limit; inspect the schedule.'
      : '',
    schedules.length > LIMIT
      ? 'Only the first five visible matching schedules were checked. Use a service name to narrow coverage.'
      : '',
    rules.length === 20 ? 'Routing lookup was bounded to the first 20 escalation rules.' : '',
    stamp(ctx),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function answerBasicRead(
  intent: SquireIntent,
  actor: AuthorizationActor,
  message: string,
  incident: ReadableIncident | null,
  collect?: CollectBasicEvidence
): Promise<string | null> {
  const result = await answerBasicReadDetailed(intent, actor, message, incident, collect, {});
  return result ? result.text : null;
}

async function timeZoneFor(actorId: string): Promise<string> {
  const cached = timeZones.get(actorId);
  if (cached) return cached;
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { timeZone: true } });
  const timeZone = user?.timeZone && isValidTimeZone(user.timeZone) ? user.timeZone : 'UTC';
  timeZones.set(actorId, timeZone);
  return timeZone;
}

/** Test hook. */
export function resetBasicReadCaches(): void {
  timeZones.clear();
}

export async function answerBasicReadDetailed(
  intent: SquireIntent,
  actor: AuthorizationActor,
  message: string,
  incident: ReadableIncident | null,
  collect: CollectBasicEvidence | undefined,
  options: BasicReadOptions
): Promise<BasicReadResult | null> {
  const supported = [
    'ALERT_STATS',
    'ACTIVE_INCIDENTS',
    'WORK_QUEUE',
    'INCIDENT_STATS',
    'SERVICE_HEALTH',
    'RUNBOOK_SEARCH',
    'RECENT_CHANGES',
    'FOLLOWUPS',
    'POSTMORTEMS',
    'RESPONDERS',
    'ON_CALL',
    'SEARCH_INCIDENTS',
  ];
  if (!supported.includes(intent)) return null;
  if (
    !incident &&
    !options.contextService &&
    /\b(this|current) service\b/i.test(message) &&
    (intent === 'SERVICE_HEALTH' || intent === 'ON_CALL')
  )
    return {
      text: 'Please include the service name, for example “Who owns Checkout API?”. I use the service on screen when you are on an incident or service page; I will not guess a service from another page.',
    };
  const timeZone = await timeZoneFor(actor.id);
  const now = new Date();
  const query = parseBasicQuery(message, now, timeZone);
  if (query.error) return { text: query.error };
  if ((intent === 'WORK_QUEUE' || intent === 'ACTIVE_INCIDENTS') && !query.status)
    query.active = true;
  if (options.teamIds?.length) query.teamIds = options.teamIds;
  if (options.assigneeId) {
    query.assigneeId = options.assigneeId;
    query.mine = false;
    query.active = query.active || !query.status;
  }
  const ctx: Context = {
    actor,
    message,
    incident,
    collect,
    now,
    timeZone,
    query,
    options,
    offset: Math.max(0, Math.min(options.offset ?? 0, 10_000)),
    limit: Math.max(1, Math.min(options.limit ?? BASIC_PAGE_SIZE, MAX_PAGE_SIZE)),
  };
  const text = async (value: string | BasicReadResult): Promise<BasicReadResult> =>
    typeof value === 'string' ? { text: value } : value;
  try {
    if (intent === 'WORK_QUEUE' || intent === 'SEARCH_INCIDENTS' || intent === 'ACTIVE_INCIDENTS')
      return await incidentList(ctx);
    if (intent === 'ALERT_STATS') return text(await alertStats(ctx));
    if (intent === 'INCIDENT_STATS') return text(await statistics(ctx));
    if (intent === 'SERVICE_HEALTH') return text(await serviceOverview(ctx));
    if (intent === 'RUNBOOK_SEARCH') return text(await runbooks(ctx));
    if (intent === 'RECENT_CHANGES') return text(await changes(ctx));
    if (intent === 'FOLLOWUPS') return text(await followups(ctx));
    if (intent === 'POSTMORTEMS') return text(await postmortems(ctx));
    if (intent === 'RESPONDERS') return text(await responders(ctx));
    return text(await oncall(ctx));
  } catch (error) {
    if (error instanceof AuthorizationError)
      return {
        text: 'You do not have permission to read that OpsKnight data. Ask an administrator to review your access.',
      };
    throw error;
  }
}
