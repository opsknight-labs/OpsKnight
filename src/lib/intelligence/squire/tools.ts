import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { AiToolDefinition } from '../ai/port';
import { getResponseIntelligenceForActor } from '../response/view';
import { getSimilarIncidentsForActor } from '../similarity/view';
import { readIncidentForActor } from './deterministic';

const searchInput = z.object({ query: z.string().trim().min(1).max(100), status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional() }).strict();
const idInput = z.object({ id: z.string().trim().min(1).max(64) }).strict();

const NOT_FOUND = { error: 'Not found, or you do not have access to it.' };

/**
 * Read-only tools for the model. Every one runs under the asking user's own permissions through the same
 * visibility rules as the rest of the application, so the model can never read more than the user can.
 * Results are returned as data; the model is told to treat them as untrusted. There are no write tools:
 * Squire cannot change anything.
 */
export function buildSquireTools(actor: AuthorizationActor): AiToolDefinition[] {
  return [
    {
      name: 'search_incidents',
      description: 'Find incidents by words in the title. Returns at most 5, newest first.',
      kind: 'READ',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', maxLength: 100 }, status: { type: 'string', enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] } },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async input => {
        const parsed = searchInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        let readable;
        try {
          readable = incidentReadWhere(actor);
        } catch {
          return NOT_FOUND;
        }
        const rows = await prisma.incident.findMany({
          where: {
            AND: [
              { title: { contains: parsed.data.query, mode: 'insensitive' } },
              ...(parsed.data.status ? [{ status: parsed.data.status }] : []),
              readable,
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, title: true, status: true, createdAt: true, service: { select: { name: true } } },
        });
        return rows.map(row => ({ id: row.id, title: row.title, status: row.status, service: row.service.name, createdAt: row.createdAt.toISOString() }));
      },
    },
    {
      name: 'get_incident',
      description: 'Get the basic facts of one incident by id.',
      kind: 'READ',
      inputSchema: { type: 'object', properties: { id: { type: 'string', maxLength: 64 } }, required: ['id'], additionalProperties: false },
      execute: async input => {
        const parsed = idInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const incident = await readIncidentForActor(actor, parsed.data.id);
        return incident ? { ...incident, createdAt: incident.createdAt.toISOString() } : NOT_FOUND;
      },
    },
    {
      name: 'get_intelligence',
      description: 'Get similar past incidents, possible causes (changes, upstream incidents) and suggested runbooks for one incident id.',
      kind: 'READ',
      inputSchema: { type: 'object', properties: { id: { type: 'string', maxLength: 64 } }, required: ['id'], additionalProperties: false },
      execute: async input => {
        const parsed = idInput.safeParse(input);
        if (!parsed.success) return { error: 'Invalid input' };
        const incident = await readIncidentForActor(actor, parsed.data.id);
        if (!incident) return NOT_FOUND;
        const [similar, response] = await Promise.all([
          getSimilarIncidentsForActor(incident.id, actor),
          getResponseIntelligenceForActor(incident.id, actor),
        ]);
        return {
          similarIncidents: (similar ?? []).map(item => ({ id: item.incidentId, title: item.title, matchPercent: item.matchPercent, status: item.status })),
          possibleChanges: (response?.changes ?? []).map(c => ({ summary: c.summary, kind: c.kind, minutesBeforeOnset: c.leadMinutes })),
          upstreamIncidents: (response?.upstreamIncidents ?? []).map(u => ({ id: u.incidentId, title: u.title, minutesBeforeThis: u.leadMinutes })),
          runbooks: (response?.runbooks ?? []).map(r => ({ id: r.runbookId, name: r.name, succeeded: r.succeeded, completedRuns: r.eligible })),
        };
      },
    },
  ];
}
