import 'server-only';
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
import type { SourceReference } from '../conversations/contract';
import { connectionReadWhere } from '../connectors/service';

export type SourceIdentity = Pick<SourceReference, 'kind' | 'id'>;
export interface SourceState {
  updatedAt?: string;
}
export const sourceKey = (source: SourceIdentity) => `${source.kind}:${source.id}`;
const MAX_SOURCE_CHECKS = 200;

/** Batches current visibility checks before historical data can be replayed. Missing checks fail closed. */
export async function readSourceStates(
  actor: AuthorizationActor,
  sources: readonly SourceIdentity[]
): Promise<Map<string, SourceState>> {
  const states = new Map<string, SourceState>();
  if (actor.status !== 'ACTIVE' || actor.apiKey) return states;
  const unique = [...new Map(sources.map(source => [sourceKey(source), source])).values()].slice(
    0,
    MAX_SOURCE_CHECKS
  );
  const ids = (kind: SourceReference['kind']) =>
    unique.filter(source => source.kind === kind).map(source => source.id);
  const tasks: Promise<void>[] = [];
  const run = (
    kind: SourceReference['kind'],
    load: () => Promise<Array<{ id: string; updatedAt?: Date }>>
  ) => {
    if (!ids(kind).length) return;
    tasks.push(
      (async () => {
        try {
          for (const row of await load())
            states.set(sourceKey({ kind, id: row.id }), {
              ...(row.updatedAt ? { updatedAt: row.updatedAt.toISOString() } : {}),
            });
        } catch {
          // Denied roles, outages and exhausted checking budgets never make a source readable.
        }
      })()
    );
  };
  run('incident', () =>
    prisma.incident.findMany({
      where: { AND: [{ id: { in: ids('incident') } }, incidentReadWhere(actor)] },
      select: { id: true, updatedAt: true },
    })
  );
  run('service', () =>
    prisma.service.findMany({
      where: { AND: [{ id: { in: ids('service') } }, serviceReadWhere(actor)] },
      select: { id: true, updatedAt: true },
    })
  );
  run('runbook', () =>
    prisma.runbook.findMany({
      where: { AND: [{ id: { in: ids('runbook') }, archivedAt: null }, runbookReadWhere(actor)] },
      select: { id: true, updatedAt: true },
    })
  );
  run('schedule', () =>
    prisma.onCallSchedule.findMany({
      where: { AND: [{ id: { in: ids('schedule') } }, scheduleReadWhere(actor)] },
      select: { id: true, updatedAt: true },
    })
  );
  run('person', () =>
    prisma.user.findMany({
      where: {
        AND: [{ id: { in: ids('person') }, status: 'ACTIVE' }, dashboardUserReadWhere(actor)],
      },
      select: { id: true, updatedAt: true },
    })
  );
  run('postmortem', async () =>
    (
      await prisma.postmortem.findMany({
        where: { AND: [{ incidentId: { in: ids('postmortem') } }, postmortemReadWhere(actor)] },
        select: { incidentId: true, updatedAt: true },
      })
    ).map(row => ({ id: row.incidentId, updatedAt: row.updatedAt }))
  );
  run('alert', () =>
    prisma.alert.findMany({
      where: {
        id: { in: ids('alert') },
        incidentId: { not: null },
        incident: incidentReadWhere(actor),
      },
      select: { id: true },
    })
  );
  run('change', () => {
    const readable = serviceReadWhere(actor);
    return prisma.changeEvent.findMany({
      where: {
        id: { in: ids('change') },
        ...(Object.keys(readable).length
          ? { OR: [{ serviceId: null }, { service: readable }] }
          : {}),
      },
      select: { id: true },
    });
  });
  if (authorize({ actor, action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ }).allowed) {
    run('status_page', () =>
      prisma.statusPage.findMany({
        where: { id: { in: ids('status_page') } },
        select: { id: true, updatedAt: true },
      })
    );
  }
  // Observability connections (slice F1): still enabled and still allowed for this person's teams.
  const connections = connectionReadWhere(actor);
  if (connections) {
    run('observability', () =>
      prisma.observabilityConnection.findMany({
        where: { AND: [{ id: { in: ids('observability') } }, connections] },
        select: { id: true, updatedAt: true },
      })
    );
  }
  await Promise.all(tasks);
  return states;
}
