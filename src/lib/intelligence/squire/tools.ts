import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { pageByUrgency } from '@/lib/incidents/urgency-order';
import { CAPABILITIES, hasCapability, type Capability } from '@/lib/authorization';
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
import {
  resolveEmbeddingModel,
  highestDataClass,
  type AiDataClass,
  type AiToolDefinition,
} from '../ai/port';
import { maskVolatileText } from '../normalization/text';
import { incidentRef } from '../incident-ux/explain';
import { normalizeVector } from '../semantic/vector';
import { searchIncidentVector } from '../semantic/search';
import { resolveEffectivePolicy } from '../settings/service';
import { getResponseIntelligenceForActor } from '../response/view';
import { getSimilarIncidentsForActor } from '../similarity/view';
import { getRelatedIncidentsForActor } from '../correlation/view';
import {
  SQUIRE_ACTION_DESCRIPTIONS,
  SQUIRE_ACTION_INPUTS,
  SQUIRE_ACTION_JSON_SCHEMAS,
  SQUIRE_ACTION_NAMES,
  type SquireActionName,
} from './actions/catalog';
import { FOLLOW_UP_ONLY_ACTIONS, isExtendedSquireAction } from './actions/catalog-extended';
import { readIncidentForActor } from './deterministic';
import { buildCatchUp } from './catch-up';
import { classifyIntent, normalizeMessage, parseSlashCommand } from './basic/nlu';
// --- Observability connectors (slice F1): tools live in their own module and are appended below.
import type { EligibleConnection } from '../connectors/service';
import { buildObservabilityTools, OBSERVABILITY_TOOL_DATA_CLASS } from './tools-observability';
import { buildIncidentTools, INCIDENT_TOOL_DATA_CLASS } from './tools-incident';
import { buildKnowledgeTools, KNOWLEDGE_TOOL_DATA_CLASS } from './tools-knowledge';
import { buildDocsTool } from './docs';
import { AUTOMATION_TOOL_DATA_CLASS, buildAutomationTools } from './tools-automation';

const NOT_FOUND = { error: 'Not found, or you do not have access to it.' };
const MAX_ROWS = 10;

/**
 * What each tool can return. Tools that name people, or read notes and timelines people wrote, are Personal;
 * everything else is Internal operational data. Proposal tools carry only identifiers.
 */
export const SQUIRE_TOOL_DATA_CLASS: Readonly<Record<string, AiDataClass>> = {
  get_timeline: 'PERSONAL',
  list_alerts: 'INTERNAL',
  who_is_on_call: 'PERSONAL',
  // Names the people who wrote notes and quotes those notes.
  get_catch_up: 'PERSONAL',
  find_people: 'PERSONAL',
  search_postmortems: 'PERSONAL',
  get_incident: 'INTERNAL',
  get_intelligence: 'INTERNAL',
  get_service: 'INTERNAL',
  get_recent_changes: 'INTERNAL',
  get_runbook: 'INTERNAL',
  search_incidents: 'INTERNAL',
  semantic_search_incidents: 'INTERNAL',
  get_status_page: 'PUBLIC',
  get_problem_outcomes: 'INTERNAL',
  search_product_docs: 'PUBLIC',
  find_operations: 'PUBLIC',
  describe_operation: 'PUBLIC',
  read_operation: 'PERSONAL',
  // Observability connector tools (logs are Personal; the rest Internal).
  ...OBSERVABILITY_TOOL_DATA_CLASS,
  // Incident-response tools (tools-incident.ts) declare their own classes.
  ...INCIDENT_TOOL_DATA_CLASS,
  // Knowledge memory (F4), see tools-knowledge.ts.
  ...KNOWLEDGE_TOOL_DATA_CLASS,
  // Automation (J1.6), see tools-automation.ts.
  ...AUTOMATION_TOOL_DATA_CLASS,
};
const SEMANTIC_UNAVAILABLE = { items: [], coverage: { mode: 'UNAVAILABLE', approximate: false } };

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
  options: {
    personal: boolean;
    dataClass?: AiDataClass;
    signal?: AbortSignal;
    observe?: (name: string, input: unknown, result: unknown) => Promise<unknown>;
    /** Enabled observability connections this person may use; their tools are offered only if any exist. */
    observability?: readonly EligibleConnection[];
    /** Offer the opt-in extended action proposals (AiSettings.squireExtendedActions). */
    extendedActions?: boolean;
    /** The knowledge index is on: offer search_knowledge and the learn_service_fact proposal (F4). */
    knowledge?: boolean;
    /**
     * More tools, data-class filtered and evidence-observed like the built-in ones. The chat turn passes the
     * operation catalog (operations.ts) here, so the investigation lane's worker bundle never loads it.
     */
    extraTools?: readonly AiToolDefinition[];
  }
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
      'Find incidents with a similar meaning using optional embeddings. Searches visible incidents from the last 90 days through ANN when available. Coverage reports a bounded recent scan when no ANN index is ready; never assume a complete history search.',
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
        if (options.signal?.aborted) return SEMANTIC_UNAVAILABLE;
        const port = await resolveEmbeddingModel(highestDataClass(['PERSONAL', options.dataClass]));
        if (!port) return SEMANTIC_UNAVAILABLE;
        const { vectors } = await port.embed([maskVolatileText(parsed.data.query)], {
          actorId: actor.id,
          signal: options.signal,
        });
        if (options.signal?.aborted) return SEMANTIC_UNAVAILABLE;
        const vector = normalizeVector(vectors[0] ?? []);
        if (!vector) return SEMANTIC_UNAVAILABLE;
        return searchIncidentVector(actor, vector, {
          model: port.model,
          lowerBound: new Date(Date.now() - 90 * 86_400_000),
          limit: MAX_ROWS,
          scanLimit: 1000,
          maxDbMs: 750,
        });
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
      'Find incidents the person can see. All filters optional: title words, status ("unresolved" = open or acknowledged), urgency, serviceId, unassigned (no person and no team assigned); without words it lists by filter. Returns `total` (the exact count for exactly these filters: state the count from it and say which filter it is for, never from the rows you see; for one service pass serviceId instead of sampling) and at most 10 rows, most urgent then newest, each with a ready `shortId` (copy it, never derive it) and assignee; pass offset 10, 20... for the next pages.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 100 },
          status: { type: 'string', enum: ['unresolved', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED'] },
          urgency: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          serviceId: idSchema,
          unassigned: { type: 'boolean' },
          offset: { type: 'integer', minimum: 0, maximum: 2000 },
        },
        additionalProperties: false,
      },
      async input => {
        const parsed = z
          .object({
            offset: z.number().int().min(0).max(2000).optional(),
            query: z.string().trim().max(100).optional(),
            status: z.enum(['unresolved', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
            urgency: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
            serviceId: z.string().trim().min(1).max(64).optional(),
            unassigned: z.boolean().optional(),
          })
          .strict()
          .safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const readable = scoped(() => incidentReadWhere(actor));
        if (!readable) return NOT_FOUND;
        const { status, urgency, serviceId, unassigned } = parsed.data;
        const where = {
          AND: [
            ...words(parsed.data.query ?? '').map(term => ({
              title: { contains: term, mode: 'insensitive' as const },
            })),
            ...(status === 'unresolved'
              ? [{ status: { in: ['OPEN' as const, 'ACKNOWLEDGED' as const] } }]
              : status
                ? [{ status }]
                : []),
            ...(urgency ? [{ urgency }] : []),
            ...(serviceId ? [{ serviceId }] : []),
            ...(unassigned ? [{ assigneeId: null, teamId: null }] : []),
            readable,
          ],
        };
        const [total, rows] = await Promise.all([
          prisma.incident.count({ where }),
          // Most urgent first (HIGH, MEDIUM, LOW), then newest: the database enum cannot be sorted into that order.
          pageByUrgency({
            take: MAX_ROWS,
            skip: parsed.data.offset,
            count: tier => prisma.incident.count({ where: { AND: [where, { urgency: tier }] } }),
            fetch: (tier, skip, take) =>
              prisma.incident.findMany({
                where: { AND: [where, { urgency: tier }] },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip,
                take,
                select: {
                  id: true,
                  title: true,
                  status: true,
                  urgency: true,
                  createdAt: true,
                  resolvedAt: true,
                  updatedAt: true,
                  service: { select: { name: true } },
                  assignee: { select: { name: true } },
                },
              }),
          }),
        ]);
        return {
          total,
          items: rows.map(row => ({
            id: row.id,
            shortId: incidentRef(row.id),
            title: short(row.title, 160),
            status: row.status,
            urgency: row.urgency,
            service: row.service.name,
            assignee: row.assignee?.name ?? null,
            createdAt: row.createdAt.toISOString(),
            resolvedAt: row.resolvedAt?.toISOString() ?? null,
            updatedAt: row.updatedAt.toISOString(),
          })),
        };
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
            updatedAt: true,
            service: { select: { name: true } },
            _count: { select: { alerts: true } },
          },
        });
        if (!row) return NOT_FOUND;
        return {
          id: row.id,
          shortId: incidentRef(row.id),
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
          updatedAt: row.updatedAt.toISOString(),
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
            openedAt: item.createdAt.toISOString(),
          })),
          relatedIncidents: (related ?? [])
            .slice(0, 5)
            .map(item => ({ id: item.incidentId, title: short(item.title, 160) })),
          possibleChanges: (response?.changes ?? []).slice(0, 5).map(c => ({
            id: c.changeId,
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
          select: { id: true, name: true, description: true, updatedAt: true },
        });
        if (!service) return NOT_FOUND;
        const since = new Date(Date.now() - 86_400_000);
        const [edges, open, changes] = await Promise.all([
          prisma.serviceDependency.findMany({
            where: {
              status: 'ACTIVE',
              upstream: readable,
              downstream: readable,
              OR: [{ upstreamServiceId: service.id }, { downstreamServiceId: service.id }],
            },
            take: 20,
            select: {
              upstreamServiceId: true,
              upstream: { select: { id: true, name: true, updatedAt: true } },
              downstream: { select: { id: true, name: true, updatedAt: true } },
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
            select: { id: true, kind: true, summary: true, occurredAt: true },
          }),
        ]);
        return {
          id: service.id,
          name: service.name,
          updatedAt: service.updatedAt.toISOString(),
          description: short(service.description, 400),
          dependencySources: edges.flatMap(edge => [edge.upstream, edge.downstream]),
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
            id: c.id,
            kind: c.kind,
            summary: short(c.summary, 200),
            at: c.occurredAt.toISOString(),
          })),
        };
      }
    ),
    readTool(
      'get_recent_changes',
      'List recorded changes (deploys, config changes, feature flags) in the last N hours (default 6, at most 72), optionally for one service id. For an older moment (what changed before an incident started) pass `around` (ISO time, the incident start) and `windowHours` (at most 72): changes in the window before it.',
      {
        type: 'object',
        properties: {
          serviceId: idSchema,
          hours: { type: 'integer', minimum: 1, maximum: 72 },
          around: { type: 'string', maxLength: 40 },
          windowHours: { type: 'integer', minimum: 1, maximum: 72 },
        },
        additionalProperties: false,
      },
      async input => {
        const parsed = z
          .object({
            serviceId: z.string().trim().min(1).max(64).optional(),
            hours: z.number().int().min(1).max(72).optional(),
            around: z.iso.datetime().optional(),
            windowHours: z.number().int().min(1).max(72).optional(),
          })
          .strict()
          .safeParse(input ?? {});
        if (!parsed.success) return { error: 'Invalid input' };
        const readable = scoped(() => serviceReadWhere(actor));
        if (!readable) return NOT_FOUND;
        const until = parsed.data.around ? new Date(parsed.data.around) : null;
        const since = new Date(
          (until?.getTime() ?? Date.now()) -
            (parsed.data.windowHours ?? parsed.data.hours ?? 6) * 3_600_000
        );
        const rows = await prisma.changeEvent.findMany({
          where: {
            occurredAt: { gte: since, ...(until ? { lte: until } : {}) },
            ...(parsed.data.serviceId
              ? { service: { AND: [{ id: parsed.data.serviceId }, readable] } }
              : Object.keys(readable).length
                ? { OR: [{ serviceId: null, unmappedIntegrationId: null }, { service: readable }] }
                : {}),
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
      'Get a runbook by id: name, description, whether it is published and whether it has an unpublished draft.',
      idOnly,
      async input => {
        const parsed = idInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const readable = scoped(() => runbookReadWhere(actor));
        if (!readable) return NOT_FOUND;
        const runbook = await prisma.runbook.findFirst({
          where: { AND: [{ id: parsed.data.id, archivedAt: null }, readable] },
          select: {
            id: true,
            name: true,
            description: true,
            publishedVersionId: true,
            draftVersionId: true,
            updatedAt: true,
          },
        });
        if (!runbook) return NOT_FOUND;
        return {
          id: runbook.id,
          name: runbook.name,
          updatedAt: runbook.updatedAt.toISOString(),
          description: short(runbook.description, 800),
          published: Boolean(runbook.publishedVersionId),
          hasDraft: Boolean(runbook.draftVersionId),
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
            updatedAt: true,
            rootCause: true,
            resolution: true,
            status: true,
          },
        });
        return rows.map(p => ({
          incidentId: p.incidentId,
          updatedAt: p.updatedAt.toISOString(),
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
            scheduleId: shift.schedule.id,
            schedule: shift.schedule.name,
            personId: shift.user.id,
            name: shift.user.name ?? shift.user.email ?? 'Unknown',
            until: shift.end.toISOString(),
          }));
        }
      ),
      readTool(
        'get_catch_up',
        "Catch the asking person up (a shift hand-off): what opened, resolved and is still open on their teams and assigned to them since their last on-call shift ended (or the last `hours`, default 12, at most 168), still-open high-urgency incidents, incidents that paged them, notes that mention them, and their current or next shift. Only the person's own scope; for the whole organisation use search_incidents. Lead with what needs action.",
        {
          type: 'object',
          properties: { hours: { type: 'integer', minimum: 1, maximum: 168 } },
          additionalProperties: false,
        },
        async input => {
          const parsed = z
            .object({ hours: z.number().int().min(1).max(168).optional() })
            .strict()
            .safeParse(input ?? {});
          if (!parsed.success) return { error: 'Invalid input' };
          if (!scoped(() => incidentReadWhere(actor))) return NOT_FOUND;
          return buildCatchUp(actor, { hours: parsed.data.hours });
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
            select: { id: true, name: true, email: true, updatedAt: true },
          });
          return rows.map(user => ({
            personId: user.id,
            name: user.name,
            email: user.email,
            updatedAt: user.updatedAt.toISOString(),
          }));
        }
      )
    );
  }

  // --- Observability connectors (slice F1). Logs may carry Personal data, so they follow `personal`.
  if (options.observability?.length) {
    tools.push(
      ...buildObservabilityTools(actor, options.observability, { signal: options.signal }).filter(
        tool => options.personal || tool.dataClass !== 'PERSONAL'
      )
    );
  }
  // Incident-response read tools (alert payload, runbook steps, SLOs, analytics, escalation policy).
  tools.push(...buildIncidentTools(actor, { personal: options.personal }));
  // Knowledge memory (F4): offered only while the index is switched on.
  if (options.knowledge) tools.push(...buildKnowledgeTools(actor, options));
  // Automation (J1.6): read tools for people who may read automation.
  tools.push(...buildAutomationTools(actor));
  // Product documentation for how-to questions.
  tools.push(buildDocsTool());
  // Tools the caller supplies (the chat turn adds the operation catalog), wrapped like every other below.
  if (options.extraTools) tools.push(...options.extraTools);

  for (const name of SQUIRE_ACTION_NAMES) {
    if (!options.personal && name === 'reassign_incident') continue;
    // Extended actions (F3): opt-in; follow-up steps are never offered to the model; naming a person needs Personal.
    if (isExtendedSquireAction(name) && !options.extendedActions) continue;
    if (FOLLOW_UP_ONLY_ACTIONS.has(name)) continue;
    if (!options.personal && name === 'add_responder') continue;
    if (!options.knowledge && name === 'learn_service_fact') continue;
    // Never offer a card the role could not confirm: the model then says who can instead.
    const needs = PROPOSAL_CAPABILITY.get(name);
    if (needs && !hasCapability(actor.role, needs)) continue;
    if (
      name === 'draft_automation_rule' &&
      !hasCapability(actor.role, CAPABILITIES.AUTOMATION_EDIT)
    )
      continue;
    tools.push(proposalTool(name));
  }
  // Each tool carries the class of what it can return; the turn's class is the highest of the tools that
  // actually ran plus the conversation baseline the caller chose. Without Personal clearance, no tool that
  // can return Personal data is offered, whichever module defined it.
  return tools
    .filter(
      tool =>
        options.personal ||
        (tool.dataClass ?? SQUIRE_TOOL_DATA_CLASS[tool.name] ?? 'INTERNAL') !== 'PERSONAL'
    )
    .map(tool => ({
      ...tool,
      dataClass: highestDataClass([
        options.dataClass ?? 'INTERNAL',
        tool.dataClass ?? SQUIRE_TOOL_DATA_CLASS[tool.name] ?? 'INTERNAL',
      ]),
      ...(options.observe && tool.kind === 'READ'
        ? {
            execute: async (input: unknown, call?: { signal?: AbortSignal }) => {
              const result = await tool.execute!(input, call);
              // Settled: the call was given up on (deadline, cancelled turn), so its late result must not
              // become evidence or a chart for an answer that no longer uses it.
              if (call?.signal?.aborted) throw new Error('Tool call already settled');
              return options.observe!(tool.name, input, result);
            },
          }
        : {}),
    }));
}

/**
 * Read-tool families whose schemas are large and whose use the message names. Each is offered only when the
 * message (or a recognised investigative intent) asks for that kind of evidence; the small incident read tools
 * are always on offer.
 */
const READ_FAMILIES: Array<{ tools: Set<string>; words: RegExp; intents?: Set<string> }> = [
  {
    // The operation catalog: schedules, maintenance, SLOs, dashboards and any change beyond incidents.
    tools: new Set(['find_operations', 'describe_operation', 'read_operation']),
    // Bounded, literal alternatives over a message capped by the request schema.
    words:
      /\b(schedules?|overrides?|maintenance|slos?|objectives?|dashboards?|reports?|teams?|polic(?:y|ies)|postmortems?|status ?pages?|custom fields?|tags?|watchers?|roles?|templates?|business services?|runbooks?|services?|create|update|edit|change|rename|archive|publish|add|remove|set|cover|swap)\b/,
  },
  {
    tools: new Set([
      'query_metrics',
      'search_logs',
      'get_traces',
      'get_error_events',
      'get_change_diff',
      'list_metrics',
      'label_values',
      'list_metric_templates',
    ]),
    // Bounded, literal alternatives over a message capped by the request schema.
    words:
      /\b(logs?|metrics?|promql|traces?|spans?|errors?|exceptions?|stack|latency|slow|cpu|memory|5\d\d|4\d\d|diffs?|commits?|code|deploy\w*|release\w*|queries|query|dashboards?|labels?|series|spikes?|graphs?|charts?|plots?|trends?|timeouts?|why|cause\w*|root|investigat\w*|debug\w*|fail\w*|broke\w*|down|outage|evidence|signals?|telemetry|sentry|loki|tempo|prometheus|datadog|cloudwatch|grafana|github)\b/,
    intents: new Set(['CAUSES', 'SERVICE_HEALTH', 'INCIDENT_SUMMARY']),
  },
  {
    tools: new Set(['get_automation_decision', 'explain_automation_rule']),
    words: /\b(automat\w*|rules?|rout\w*|priorit\w*|escalat\w*|assign\w*|paged|page|why)\b/,
  },
];

/** Role capability an extended proposal needs (mirrors the checks in actions/extended.ts). */
const PROPOSAL_CAPABILITY = new Map<string, Capability>([
  ['change_urgency', CAPABILITIES.OPERATIONS_MANAGE],
  ['snooze_incident', CAPABILITIES.OPERATIONS_MANAGE],
  ['create_jira_issue', CAPABILITIES.OPERATIONS_MANAGE],
  ['unlink_related_incident', CAPABILITIES.INTELLIGENCE_FEEDBACK],
  ['draft_status_update', CAPABILITIES.ADMIN_MANAGE],
  ['publish_status_update', CAPABILITIES.ADMIN_MANAGE],
  ['run_runbook', CAPABILITIES.RUNBOOK_EXECUTE],
]);

/** The everyday incident actions stay on offer for any question; the rest only when the message asks to act. */
const CORE_PROPOSALS = new Set([
  'propose_acknowledge_incident',
  'propose_resolve_incident',
  'propose_add_incident_note',
]);
// Bounded, literal alternatives over a message capped by the request schema.

const ACTION_WORDS =
  /\b(ack|acknowledge|resolve|close|reopen|re-?assign|assign|hand ?over|snooze|mute|escalate|page|un-?link|link|note|add|remove|draft|start|open|create|run|execute|publish|post|mark|set|raise|lower|bump|make|remember|learn|follow(?!-ups)|unfollow|notify|invite|subscribe|propose|suggest|change(?![sd])|update|edit|rename|cover|swap|archive|delete|cancel|end)\b/;

/**
 * Tool subset by intent, so a question does not carry every schema. Uses the basic-mode NLU: a message with
 * no recognised intent and no action keeps the full set. Otherwise proposals beyond the core incident actions
 * need an action-like message (slash command or action verb), and the large read families (observability,
 * automation) need the message to ask for that kind of evidence.
 */
export function toolsForMessage(
  tools: AiToolDefinition[],
  message: string,
  onIncident: boolean
): AiToolDefinition[] {
  const text = normalizeMessage(message);
  const acting = Boolean(parseSlashCommand(message)) || ACTION_WORDS.test(text);
  const { intent } = classifyIntent(text, onIncident);
  if (!acting && intent === 'UNKNOWN') return tools;
  const unasked = READ_FAMILIES.filter(
    family => !family.words.test(text) && !family.intents?.has(intent)
  );
  return tools.filter(tool =>
    tool.kind === 'PROPOSE_WRITE'
      ? acting || CORE_PROPOSALS.has(tool.name)
      : !unasked.some(family => family.tools.has(tool.name))
  );
}

function proposalTool(name: SquireActionName): AiToolDefinition {
  return {
    name: `propose_${name}`,
    // eslint-disable-next-line security/detect-object-injection -- name is a member of the closed action union
    description: SQUIRE_ACTION_DESCRIPTIONS[name],
    kind: 'PROPOSE_WRITE',
    // eslint-disable-next-line security/detect-object-injection -- name is a member of the closed action union
    inputSchema: SQUIRE_ACTION_JSON_SCHEMAS[name],
    // The same check buildProposal applies, so the model hears at once that a malformed card was not shown.
    // eslint-disable-next-line security/detect-object-injection -- name is a member of the closed action union
    validate: input => SQUIRE_ACTION_INPUTS[name].safeParse(input).success,
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
