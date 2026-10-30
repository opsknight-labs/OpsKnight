import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import {
  dashboardUserReadWhere,
  incidentReadWhere,
  postmortemReadWhere,
  runbookReadWhere,
  scheduleReadWhere,
  serviceReadWhere,
} from '@/lib/authorization-filters';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import { resolveEmbeddingModel, type AiToolDefinition } from '../ai/port';
import { maskVolatileText } from '../normalization/text';
import { normalizeVector, dot } from '../semantic/vector';
import { resolveEffectivePolicy } from '../settings/service';
import { getResponseIntelligenceForActor } from '../response/view';
import { getSimilarIncidentsForActor } from '../similarity/view';
import { getRelatedIncidentsForActor } from '../correlation/view';
import {
  SQUIRE_ACTION_DESCRIPTIONS,
  SQUIRE_ACTION_JSON_SCHEMAS,
  SQUIRE_ACTION_NAMES,
  type SquireActionName,
} from './actions/catalog';
import { readIncidentForActor } from './deterministic';

const NOT_FOUND = { error: 'Not found, or you do not have access to it.' };
const MAX_ROWS = 10;

const short = (text: string | null | undefined, max = 280) => {
  const value = (text ?? '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/** Each tool's result is shaped and bounded here, row by row, so nothing is ever cut mid-structure. */
function scoped<T>(build: () => T): T | null {
  try {
    return build();
  } catch {
    return null;
  }
}

const idSchema = { type: 'string', minLength: 1, maxLength: 64 };
const idInput = z.object({ id: z.string().trim().min(1).max(64) }).strict();
const idOnly = {
  type: 'object',
  properties: { id: idSchema },
  required: ['id'],
  additionalProperties: false,
};

function readTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  execute: (input: unknown) => Promise<unknown>
): AiToolDefinition {
  return { name, description, kind: 'READ', inputSchema, execute };
}

/** Words of a free-text query, each matched on its own so word order and phrasing do not matter. */
function words(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,40}/gu) ?? [])].slice(
    0,
    6
  );
}

/**
 * Tools for the model. READ tools run under the asking user's own permissions through the same visibility
 * rules as the rest of the application, so the model can never read more than the user can; results are data
 * the model is told never to treat as instructions. PROPOSE_WRITE tools execute nothing: a call becomes a
 * card the user may confirm, which then runs through the application's own commands and checks.
 *
 * Tools that return people's names, notes or timelines are offered only when the request may carry Personal
 * data (`personal`), so a provider limited to Internal data never receives them.
 */
export function buildSquireTools(
  actor: AuthorizationActor,
  options: { personal: boolean }
): AiToolDefinition[] {
  const tools: AiToolDefinition[] = [
    readTool(
      'get_problem_outcomes',
      'Read aggregate outcomes and the best observed runbook for this incident problem. Returns counts and resolution time, never hidden incident history.',
      idOnly,
      async input => {
        const parsed = idInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        if (!(await readIncidentForActor(actor, parsed.data.id))) return NOT_FOUND;
        const fingerprint = await prisma.incidentFingerprint.findUnique({
          where: { incidentId: parsed.data.id },
          select: { serviceId: true, templateHash: true },
        });
        if (
          !fingerprint?.templateHash ||
          (await resolveEffectivePolicy(fingerprint.serviceId)).effectiveMode === 'OFF'
        )
          return [];
        const [outcome, candidates] = await Promise.all([
          prisma.intelligencePattern.findUnique({
            where: {
              scopeKey_kind_key: {
                scopeKey: fingerprint.serviceId,
                kind: 'PROBLEM_OUTCOME',
                key: fingerprint.templateHash,
              },
            },
          }),
          prisma.intelligencePattern.findMany({
            where: {
              scopeKey: fingerprint.serviceId,
              kind: 'RUNBOOK_OUTCOME',
              stats: { path: ['templateHash'], equals: fingerprint.templateHash },
            },
            orderBy: { successes: 'desc' },
            take: MAX_ROWS,
          }),
        ]);
        const candidatesById = new Map(
          candidates.flatMap(row => {
            const parsed = z.object({ runbookId: z.string() }).safeParse(row.stats);
            return parsed.success ? [[parsed.data.runbookId, row] as const] : [];
          })
        );
        const readable = scoped(() => runbookReadWhere(actor));
        const runbooks = readable
          ? await prisma.runbook.findMany({
              where: {
                AND: [
                  {
                    id: { in: [...candidatesById.keys()] },
                    archivedAt: null,
                    publishedVersionId: { not: null },
                  },
                  readable,
                ],
              },
              select: { id: true, name: true },
            })
          : [];
        const best = runbooks
          .map(row => ({ ...row, count: candidatesById.get(row.id)! }))
          .sort((a, b) => b.count.successes - a.count.successes)[0];
        return {
          support: outcome?.support ?? 0,
          resolved: outcome?.successes ?? 0,
          meanResolutionMinutes: outcome?.successes
            ? Math.round(outcome.resolutionTotalMs / outcome.successes / 60_000)
            : null,
          bestRunbook: best
            ? {
                id: best.id,
                name: best.name,
                succeeded: best.count.successes,
                eligible: best.count.support,
              }
            : null,
        };
      }
    ),
    readTool(
      'semantic_search_incidents',
      'Find incidents with a similar meaning using optional embeddings. Bounded to recent incidents you may read; returns no results when embeddings are disabled.',
      {
        type: 'object',
        properties: { query: { type: 'string', minLength: 1, maxLength: 300 } },
        required: ['query'],
        additionalProperties: false,
      },
      async input => {
        const parsed = z
          .object({ query: z.string().trim().min(1).max(300) })
          .strict()
          .safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const readable = scoped(() => incidentReadWhere(actor));
        if (!readable) return NOT_FOUND;
        const port = await resolveEmbeddingModel('INTERNAL');
        if (!port) return [];
        const { vectors } = await port.embed([maskVolatileText(parsed.data.query)], {
          actorId: actor.id,
        });
        const vector = normalizeVector(vectors[0] ?? []);
        if (!vector) return [];
        const rows = await prisma.incidentEmbedding.findMany({
          where: {
            model: port.model,
            dims: vector.length,
            incidentCreatedAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
            incident: readable,
          },
          take: 500,
          orderBy: { incidentCreatedAt: 'desc' },
          select: {
            incidentId: true,
            vector: true,
            incident: { select: { title: true, status: true } },
          },
        });
        return rows
          .map(row => ({
            id: row.incidentId,
            title: short(row.incident.title, 160),
            status: row.incident.status,
            score: dot(vector, row.vector),
            href: `/incidents/${row.incidentId}`,
          }))
          .filter(row => row.score >= 0.7)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_ROWS);
      }
    ),
    readTool(
      'get_status_page',
      'Read a status page and its current service statuses. Requires status-page read access.',
      idOnly,
      async input => {
        const parsed = idInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        if (!authorize({ actor, action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ }).allowed)
          return NOT_FOUND;
        const row = await prisma.statusPage.findUnique({
          where: { id: parsed.data.id },
          select: {
            id: true,
            name: true,
            slug: true,
            enabled: true,
            services: {
              take: MAX_ROWS,
              select: { service: { select: { id: true, name: true, status: true } } },
            },
          },
        });
        if (!row) return NOT_FOUND;
        return { ...row, services: row.services.map(link => link.service) };
      }
    ),
    readTool(
      'search_incidents',
      'Find incidents whose title contains all of the given words. Optional status filter. Returns at most 10, newest first.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 100 },
          status: { type: 'string', enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async input => {
        const parsed = z
          .object({
            query: z.string().trim().min(1).max(100),
            status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
          })
          .strict()
          .safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const readable = scoped(() => incidentReadWhere(actor));
        if (!readable) return NOT_FOUND;
        const terms = words(parsed.data.query);
        if (terms.length === 0) return [];
        const rows = await prisma.incident.findMany({
          where: {
            AND: [
              ...terms.map(term => ({ title: { contains: term, mode: 'insensitive' as const } })),
              ...(parsed.data.status ? [{ status: parsed.data.status }] : []),
              readable,
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_ROWS,
          select: {
            id: true,
            title: true,
            status: true,
            urgency: true,
            createdAt: true,
            resolvedAt: true,
            service: { select: { name: true } },
          },
        });
        return rows.map(row => ({
          id: row.id,
          title: short(row.title, 160),
          status: row.status,
          urgency: row.urgency,
          service: row.service.name,
          createdAt: row.createdAt.toISOString(),
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
        }));
      }
    ),
    readTool(
      'get_incident',
      'Get the facts of one incident by id: status, urgency, priority, service, timing and description.',
      idOnly,
      async input => {
        const parsed = idInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        if (!(await readIncidentForActor(actor, parsed.data.id))) return NOT_FOUND;
        const row = await prisma.incident.findUnique({
          where: { id: parsed.data.id },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            urgency: true,
            priority: true,
            createdAt: true,
            acknowledgedAt: true,
            resolvedAt: true,
            serviceId: true,
            service: { select: { name: true } },
            _count: { select: { alerts: true } },
          },
        });
        if (!row) return NOT_FOUND;
        return {
          id: row.id,
          title: short(row.title, 200),
          description: short(row.description, 800),
          status: row.status,
          urgency: row.urgency,
          priority: row.priority,
          service: { id: row.serviceId, name: row.service.name },
          alerts: row._count.alerts,
          createdAt: row.createdAt.toISOString(),
          acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
        };
      }
    ),
    readTool(
      'get_intelligence',
      'For one incident: similar past incidents (with how they were resolved), incidents linked as related, possible causes (recent changes, upstream incidents) and suggested runbooks.',
      idOnly,
      async input => {
        const parsed = idInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const incident = await readIncidentForActor(actor, parsed.data.id);
        if (!incident) return NOT_FOUND;
        const [similar, related, response] = await Promise.all([
          getSimilarIncidentsForActor(incident.id, actor),
          getRelatedIncidentsForActor(incident.id, actor),
          getResponseIntelligenceForActor(incident.id, actor),
        ]);
        return {
          similarIncidents: (similar ?? []).slice(0, 5).map(item => ({
            id: item.incidentId,
            title: short(item.title, 160),
            matchPercent: item.matchPercent,
            status: item.status,
          })),
          relatedIncidents: (related ?? [])
            .slice(0, 5)
            .map(item => ({ id: item.incidentId, title: short(item.title, 160) })),
          possibleChanges: (response?.changes ?? []).slice(0, 5).map(c => ({
            summary: short(c.summary, 200),
            kind: c.kind,
            minutesBeforeOnset: c.leadMinutes,
          })),
          upstreamIncidents: (response?.upstreamIncidents ?? []).slice(0, 5).map(u => ({
            id: u.incidentId,
            title: short(u.title, 160),
            minutesBeforeThis: u.leadMinutes,
          })),
          runbooks: (response?.runbooks ?? []).slice(0, 5).map(r => ({
            id: r.runbookId,
            name: r.name,
            succeeded: r.succeeded,
            completedRuns: r.eligible,
          })),
        };
      }
    ),
    readTool(
      'get_service',
      'Get a service by id: description, its upstream and downstream dependencies, open incidents and changes in the last 24 hours.',
      idOnly,
      async input => {
        const parsed = idInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const readable = scoped(() => serviceReadWhere(actor));
        const incidents = scoped(() => incidentReadWhere(actor));
        if (!readable || !incidents) return NOT_FOUND;
        const service = await prisma.service.findFirst({
          where: { AND: [{ id: parsed.data.id }, readable] },
          select: { id: true, name: true, description: true },
        });
        if (!service) return NOT_FOUND;
        const since = new Date(Date.now() - 86_400_000);
        const [edges, open, changes] = await Promise.all([
          prisma.serviceDependency.findMany({
            where: {
              status: 'ACTIVE',
              OR: [{ upstreamServiceId: service.id }, { downstreamServiceId: service.id }],
            },
            take: 20,
            select: {
              upstreamServiceId: true,
              upstream: { select: { name: true } },
              downstream: { select: { name: true } },
            },
          }),
          prisma.incident.findMany({
            where: {
              AND: [{ serviceId: service.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, incidents],
            },
            orderBy: { createdAt: 'desc' },
            take: MAX_ROWS,
            select: { id: true, title: true, status: true },
          }),
          prisma.changeEvent.findMany({
            where: { serviceId: service.id, occurredAt: { gte: since } },
            orderBy: { occurredAt: 'desc' },
            take: MAX_ROWS,
            select: { kind: true, summary: true, occurredAt: true },
          }),
        ]);
        return {
          id: service.id,
          name: service.name,
          description: short(service.description, 400),
          dependsOn: edges
            .filter(e => e.upstreamServiceId !== service.id)
            .map(e => e.upstream.name),
          dependedOnBy: edges
            .filter(e => e.upstreamServiceId === service.id)
            .map(e => e.downstream.name),
          openIncidents: open.map(i => ({
            id: i.id,
            title: short(i.title, 160),
            status: i.status,
          })),
          changesLast24h: changes.map(c => ({
            kind: c.kind,
            summary: short(c.summary, 200),
            at: c.occurredAt.toISOString(),
          })),
        };
      }
    ),
    readTool(
      'get_recent_changes',
      'List recorded changes (deploys, config changes, feature flags) in the last N hours (default 6, at most 72), optionally for one service id.',
      {
        type: 'object',
        properties: { serviceId: idSchema, hours: { type: 'integer', minimum: 1, maximum: 72 } },
        additionalProperties: false,
      },
      async input => {
        const parsed = z
          .object({
            serviceId: z.string().trim().min(1).max(64).optional(),
            hours: z.number().int().min(1).max(72).optional(),
          })
          .strict()
          .safeParse(input ?? {});
        if (!parsed.success) return { error: 'Invalid input' };
        const readable = scoped(() => serviceReadWhere(actor));
        if (!readable) return NOT_FOUND;
        const since = new Date(Date.now() - (parsed.data.hours ?? 6) * 3_600_000);
        const rows = await prisma.changeEvent.findMany({
          where: {
            occurredAt: { gte: since },
            ...(parsed.data.serviceId
              ? { service: { AND: [{ id: parsed.data.serviceId }, readable] } }
              : { OR: [{ serviceId: null }, { service: readable }] }),
          },
          orderBy: { occurredAt: 'desc' },
          take: MAX_ROWS,
          select: {
            id: true,
            kind: true,
            summary: true,
            source: true,
            occurredAt: true,
            service: { select: { name: true } },
          },
        });
        return rows.map(c => ({
          id: c.id,
          href: `/changes/${c.id}`,
          kind: c.kind,
          summary: short(c.summary, 200),
          source: c.source,
          service: c.service?.name ?? null,
          at: c.occurredAt.toISOString(),
        }));
      }
    ),
    readTool(
      'get_runbook',
      'Get a runbook by id: name, description and whether a published version exists.',
      idOnly,
      async input => {
        const parsed = idInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const readable = scoped(() => runbookReadWhere(actor));
        if (!readable) return NOT_FOUND;
        const runbook = await prisma.runbook.findFirst({
          where: { AND: [{ id: parsed.data.id, archivedAt: null }, readable] },
          select: { id: true, name: true, description: true, publishedVersionId: true },
        });
        if (!runbook) return NOT_FOUND;
        return {
          id: runbook.id,
          name: runbook.name,
          description: short(runbook.description, 800),
          published: Boolean(runbook.publishedVersionId),
        };
      }
    ),
    readTool(
      'search_postmortems',
      'Find postmortems whose title or summary contains all of the given words. Returns at most 10 with their root cause and resolution.',
      {
        type: 'object',
        properties: { query: { type: 'string', maxLength: 100 } },
        required: ['query'],
        additionalProperties: false,
      },
      async input => {
        const parsed = z
          .object({ query: z.string().trim().min(1).max(100) })
          .strict()
          .safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const readable = scoped(() => postmortemReadWhere(actor));
        if (!readable) return NOT_FOUND;
        const terms = words(parsed.data.query);
        if (terms.length === 0) return [];
        const rows = await prisma.postmortem.findMany({
          where: {
            AND: [
              ...terms.map(term => ({
                OR: [
                  { title: { contains: term, mode: 'insensitive' as const } },
                  { summary: { contains: term, mode: 'insensitive' as const } },
                ],
              })),
              readable,
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: MAX_ROWS,
          select: {
            incidentId: true,
            title: true,
            summary: true,
            rootCause: true,
            resolution: true,
            status: true,
          },
        });
        return rows.map(p => ({
          incidentId: p.incidentId,
          title: short(p.title, 160),
          summary: short(p.summary, 300),
          rootCause: short(p.rootCause, 300),
          resolution: short(p.resolution, 300),
          status: p.status,
        }));
      }
    ),
  ];

  if (options.personal) {
    tools.push(
      readTool(
        'get_timeline',
        'Get the most recent timeline events and notes of one incident (at most 30, newest first).',
        idOnly,
        async input => {
          const parsed = idInput.safeParse(input);
          if (!parsed.success) return { error: 'Invalid input' };
          if (!(await readIncidentForActor(actor, parsed.data.id))) return NOT_FOUND;
          const [events, notes] = await Promise.all([
            prisma.incidentEvent.findMany({
              where: { incidentId: parsed.data.id },
              orderBy: { createdAt: 'desc' },
              take: 30,
              select: { type: true, message: true, createdAt: true },
            }),
            prisma.incidentNote.findMany({
              where: { incidentId: parsed.data.id },
              orderBy: { createdAt: 'desc' },
              take: 15,
              select: { content: true, createdAt: true, user: { select: { name: true } } },
            }),
          ]);
          return [
            ...events.map(e => ({
              at: e.createdAt.toISOString(),
              type: e.type ?? 'EVENT',
              text: short(e.message, 300),
            })),
            ...notes.map(n => ({
              at: n.createdAt.toISOString(),
              type: 'NOTE',
              by: n.user?.name ?? null,
              text: short(n.content, 400),
            })),
          ]
            .sort((a, b) => b.at.localeCompare(a.at))
            .slice(0, 30);
        }
      ),
      readTool(
        'list_alerts',
        'List the most recent alerts grouped into one incident (at most 10): status, deduplication key and summary.',
        idOnly,
        async input => {
          const parsed = idInput.safeParse(input);
          if (!parsed.success) return { error: 'Invalid input' };
          if (!(await readIncidentForActor(actor, parsed.data.id))) return NOT_FOUND;
          const rows = await prisma.alert.findMany({
            where: { incidentId: parsed.data.id },
            orderBy: { createdAt: 'desc' },
            take: MAX_ROWS,
            select: { id: true, status: true, dedupKey: true, createdAt: true, payload: true },
          });
          return rows.map(alert => {
            const payload = (alert.payload ?? {}) as Record<string, unknown>;
            const summary =
              typeof payload.summary === 'string'
                ? payload.summary
                : typeof payload.title === 'string'
                  ? payload.title
                  : '';
            return {
              id: alert.id,
              href: `/alerts/${alert.id}`,
              status: alert.status,
              dedupKey: short(alert.dedupKey, 120),
              summary: short(summary, 200),
              at: alert.createdAt.toISOString(),
            };
          });
        }
      ),
      readTool(
        'who_is_on_call',
        'Who is on call right now. With an incident id, only the schedules its service escalates to; otherwise every schedule you can see (at most 10).',
        { type: 'object', properties: { incidentId: idSchema }, additionalProperties: false },
        async input => {
          const parsed = z
            .object({ incidentId: z.string().trim().min(1).max(64).optional() })
            .strict()
            .safeParse(input ?? {});
          if (!parsed.success) return { error: 'Invalid input' };
          const readable = scoped(() => scheduleReadWhere(actor));
          if (!readable) return NOT_FOUND;
          let scheduleIds: string[] | null = null;
          if (parsed.data.incidentId) {
            if (!(await readIncidentForActor(actor, parsed.data.incidentId))) return NOT_FOUND;
            const incident = await prisma.incident.findUnique({
              where: { id: parsed.data.incidentId },
              select: {
                service: {
                  select: { policy: { select: { steps: { select: { targetScheduleId: true } } } } },
                },
              },
            });
            scheduleIds = (incident?.service.policy?.steps ?? [])
              .map(step => step.targetScheduleId)
              .filter((id): id is string => Boolean(id));
            if (scheduleIds.length === 0)
              return { note: 'This service does not escalate to an on-call schedule.' };
          }
          const shifts = await getActiveOnCallShifts(new Date(), {
            where: scheduleIds ? { AND: [{ id: { in: scheduleIds } }, readable] } : readable,
          });
          return shifts.slice(0, MAX_ROWS).map(shift => ({
            schedule: shift.schedule.name,
            personId: shift.user.id,
            name: shift.user.name ?? shift.user.email ?? 'Unknown',
            until: shift.end.toISOString(),
          }));
        }
      ),
      readTool(
        'find_people',
        'Find active people by name or email, to reassign an incident. Returns at most 5 with their ids.',
        {
          type: 'object',
          properties: { query: { type: 'string', minLength: 2, maxLength: 80 } },
          required: ['query'],
          additionalProperties: false,
        },
        async input => {
          const parsed = z
            .object({ query: z.string().trim().min(2).max(80) })
            .strict()
            .safeParse(input);
          if (!parsed.success) return { error: 'Invalid input' };
          const readable = scoped(() => dashboardUserReadWhere(actor));
          if (!readable) return NOT_FOUND;
          const rows = await prisma.user.findMany({
            where: {
              AND: [
                { status: 'ACTIVE' },
                {
                  OR: [
                    { name: { contains: parsed.data.query, mode: 'insensitive' } },
                    { email: { contains: parsed.data.query, mode: 'insensitive' } },
                  ],
                },
                readable,
              ],
            },
            take: 5,
            select: { id: true, name: true, email: true },
          });
          return rows.map(user => ({ personId: user.id, name: user.name, email: user.email }));
        }
      )
    );
  }

  for (const name of SQUIRE_ACTION_NAMES) {
    if (!options.personal && name === 'reassign_incident') continue;
    tools.push(proposalTool(name));
  }
  return tools;
}

function proposalTool(name: SquireActionName): AiToolDefinition {
  return {
    name: `propose_${name}`,
    // eslint-disable-next-line security/detect-object-injection -- name is a member of the closed action union
    description: SQUIRE_ACTION_DESCRIPTIONS[name],
    kind: 'PROPOSE_WRITE',
    // eslint-disable-next-line security/detect-object-injection -- name is a member of the closed action union
    inputSchema: SQUIRE_ACTION_JSON_SCHEMAS[name],
  };
}

/** The action a proposal tool stands for, or null for any other tool name. */
export function actionForTool(toolName: string): SquireActionName | null {
  const name = toolName.replace(/^propose_/, '');
  return toolName.startsWith('propose_') &&
    (SQUIRE_ACTION_NAMES as readonly string[]).includes(name)
    ? (name as SquireActionName)
    : null;
}
