// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MCP_OPERATION_MAP, isMcpExecutable } from '@/lib/mcp/catalog';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { principal, setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  testPrisma as db,
} from '../helpers/test-db';

setupMcpReadDatabase();

const unique = () => randomUUID().slice(0, 8);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const refused = (promise: Promise<unknown>) =>
  promise.then(
    () => 'allowed',
    (error: Error) => error.message
  );
type Envelope<T> = { data: { data: T } };

type Row = {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  assignedToMe: boolean;
  openedSinceThen: boolean;
};
type CatchUp = {
  userId: string;
  counts: { opened: number; resolved: number; active: number };
  active: Row[];
  assignedToMe: Row[];
  recentlyResolved: Row[];
  truncated: { active: boolean; recentlyResolved: boolean };
};
type Similar = {
  incidentId: string;
  basis: string;
  similar: {
    incident: { id: string; serviceName: string; resolvedAt: string | null };
    similarity: number;
    reasons: string[];
    resolutionKind: string | null;
    durationMinutes: number | null;
    lastNote: { excerpt: string } | null;
  }[];
};

describe('catch up (getMyCatchUp, oncall_catch_up)', () => {
  it('is the curated read-only tool oncall_catch_up', () => {
    const operation = MCP_OPERATION_MAP.get('getMyCatchUp')!;
    expect(operation).toMatchObject({ status: 'CURATED', risk: 'R0', tool: 'oncall_catch_up' });
    expect(operation.requiredScopes).toEqual(['incidents:read']);
    expect(isMcpExecutable(operation)).toBe(true);
  });

  it('separates what opened, what resolved and what is still active, most urgent first', async () => {
    const caller = await principal('RESPONDER', ['incidents:read']);
    const service = await createTestService(`Catch-up ${unique()}`);
    const now = Date.now();
    const high = await createTestIncident(`High ${unique()}`, service.id, {
      urgency: 'HIGH',
      assigneeId: caller.user.id,
      createdAt: new Date(now - HOUR),
    });
    const low = await createTestIncident(`Low ${unique()}`, service.id, {
      urgency: 'LOW',
      createdAt: new Date(now - 2 * HOUR),
    });
    const stale = await createTestIncident(`Stale ${unique()}`, service.id, {
      urgency: 'MEDIUM',
      createdAt: new Date(now - 3 * DAY),
    });
    const fixed = await createTestIncident(`Fixed ${unique()}`, service.id, {
      status: 'RESOLVED',
      createdAt: new Date(now - 5 * HOUR),
      resolvedAt: new Date(now - 30 * MINUTE),
    });
    const longAgo = await createTestIncident(`Long ago ${unique()}`, service.id, {
      status: 'RESOLVED',
      createdAt: new Date(now - 5 * DAY),
      resolvedAt: new Date(now - 4 * DAY),
    });

    const result = (await callMcpOperation(caller.ctx(), 'getMyCatchUp', {
      query: { hours: 12, limit: 25 },
    })) as Envelope<CatchUp>;
    const data = result.data.data;
    expect(data.userId).toBe(caller.user.id);
    // Counts cover the whole readable set (other tests share the database), so bound from below.
    expect(data.counts.opened).toBeGreaterThanOrEqual(3);
    expect(data.counts.resolved).toBeGreaterThanOrEqual(1);
    expect(data.counts.active).toBeGreaterThanOrEqual(3);

    const activeIds = data.active.map(row => row.id);
    expect(activeIds).toEqual(expect.arrayContaining([high.id, low.id, stale.id]));
    expect(activeIds).not.toContain(fixed.id);
    // Most urgent first: HIGH before MEDIUM before LOW within what we created.
    const ours = activeIds.filter(id => [high.id, low.id, stale.id].includes(id));
    expect(ours).toEqual([high.id, stale.id, low.id]);
    expect(data.active.find(row => row.id === high.id)).toMatchObject({
      assignedToMe: true,
      openedSinceThen: true,
      serviceName: service.name,
    });
    expect(data.active.find(row => row.id === stale.id)?.openedSinceThen).toBe(false);
    expect(data.assignedToMe.map(row => row.id)).toContain(high.id);
    expect(data.assignedToMe.every(row => row.assignedToMe)).toBe(true);
    const resolvedIds = data.recentlyResolved.map(row => row.id);
    expect(resolvedIds).toContain(fixed.id);
    expect(resolvedIds).not.toContain(longAgo.id);
  });

  it('reports truncation and bounds its inputs', async () => {
    const caller = await principal('ADMIN', ['incidents:read']);
    const service = await createTestService(`Bounded ${unique()}`);
    for (let i = 0; i < 3; i += 1)
      await createTestIncident(`Open ${i} ${unique()}`, service.id, { assigneeId: caller.user.id });
    const limited = (await callMcpOperation(caller.ctx(), 'getMyCatchUp', {
      query: { hours: 1, limit: 1 },
    })) as Envelope<CatchUp>;
    expect(limited.data.data.active).toHaveLength(1);
    expect(limited.data.data.truncated.active).toBe(true);
    for (const query of [{ hours: 169 }, { hours: 0 }, { limit: 26 }, { unknown: 1 }])
      expect(await refused(callMcpOperation(caller.ctx(), 'getMyCatchUp', { query }))).not.toBe(
        'allowed'
      );
  });

  it('shows a scoped user only the incidents they may read, and needs the scope', async () => {
    const scoped = await principal('USER', ['incidents:read']);
    const service = await createTestService(`Scoped ${unique()}`);
    const mine = await createTestIncident(`Mine ${unique()}`, service.id, {
      assigneeId: scoped.user.id,
    });
    const notMine = await createTestIncident(`Not mine ${unique()}`, service.id);
    const result = (await callMcpOperation(scoped.ctx(), 'getMyCatchUp', {
      query: {},
    })) as Envelope<CatchUp>;
    const ids = result.data.data.active.map(row => row.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(notMine.id);

    const noScope = await principal('RESPONDER', ['schedules:read']);
    expect(await refused(callMcpOperation(noScope.ctx(), 'getMyCatchUp', {}))).not.toBe('allowed');
  });
});

describe('similar incidents (listSimilarIncidents, incident_find_similar)', () => {
  it('is the curated read-only tool incident_find_similar', () => {
    const operation = MCP_OPERATION_MAP.get('listSimilarIncidents')!;
    expect(operation).toMatchObject({
      status: 'CURATED',
      risk: 'R0',
      tool: 'incident_find_similar',
    });
    expect(operation.requiredScopes).toEqual(['incidents:read']);
  });

  it('finds past resolved incidents by title overlap and says why and how they ended', async () => {
    const caller = await principal('RESPONDER', ['incidents:read']);
    const author = await createTestUser();
    const tag = unique();
    const service = await createTestService(`Payments ${tag}`);
    const batch = await createTestService(`Batch ${tag}`);
    const now = Date.now();
    const source = await createTestIncident(`Checkout latency spike ${tag}`, service.id, {
      priority: 'P2',
    });
    const match = await createTestIncident(`Checkout latency spike on gateway ${tag}`, service.id, {
      status: 'RESOLVED',
      priority: 'P2',
      resolutionKind: 'MANUAL',
      createdAt: new Date(now - 10 * DAY),
      resolvedAt: new Date(now - 10 * DAY + 90 * MINUTE),
    });
    await db.incidentNote.create({
      data: {
        incidentId: match.id,
        userId: author.id,
        content: `Rolled back the connection pool change. ${'x'.repeat(600)}`,
        createdAt: new Date(now - 10 * DAY + 80 * MINUTE),
      },
    });
    const sameServiceOnly = await createTestIncident(`Disk quota exceeded ${tag}`, service.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(now - 5 * DAY),
    });
    const stillOpen = await createTestIncident(`Checkout latency spike open ${tag}`, service.id);
    const otherService = await createTestIncident(`Nightly batch failed ${tag}`, batch.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(now - 3 * DAY),
    });

    const result = (await callMcpOperation(caller.ctx(), 'listSimilarIncidents', {
      path: { id: source.id },
    })) as Envelope<Similar>;
    const data = result.data.data;
    expect(data.incidentId).toBe(source.id);
    expect(data.basis).toBe('TITLE_AND_SERVICE');
    const ids = data.similar.map(row => row.incident.id);
    expect(ids[0]).toBe(match.id);
    // A shared service alone is not similarity, an open incident has no outcome, other topics stay out.
    expect(ids).not.toContain(sameServiceOnly.id);
    expect(ids).not.toContain(stillOpen.id);
    expect(ids).not.toContain(otherService.id);
    expect(ids).not.toContain(source.id);

    const row = data.similar[0]!;
    expect(row.reasons).toEqual(['TITLE_OVERLAP', 'SAME_SERVICE', 'SAME_PRIORITY']);
    expect(row.similarity).toBeGreaterThan(0.5);
    expect(row.similarity).toBeLessThanOrEqual(1);
    expect(row).toMatchObject({ resolutionKind: 'MANUAL', durationMinutes: 90 });
    expect(row.incident.serviceName).toBe(service.name);
    expect(row.lastNote!.excerpt.startsWith('Rolled back the connection pool change.')).toBe(true);
    // Excerpts are bounded (400 characters plus an ellipsis).
    expect(row.lastNote!.excerpt.length).toBeLessThanOrEqual(401);
  });

  it('only searches incidents the caller may read, bounds its limit and needs the scope', async () => {
    const scoped = await principal('USER', ['incidents:read']);
    const tag = unique();
    const service = await createTestService(`Scoped ${tag}`);
    const hidden = await createTestIncident(`Checkout latency spike ${tag}`, service.id);
    const mine = await createTestIncident(`Checkout latency spike mine ${tag}`, service.id, {
      assigneeId: scoped.user.id,
    });
    await createTestIncident(`Checkout latency spike old ${tag}`, service.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - DAY),
    });
    const visiblePast = await createTestIncident(`Checkout latency spike past ${tag}`, service.id, {
      status: 'RESOLVED',
      assigneeId: scoped.user.id,
      resolvedAt: new Date(Date.now() - DAY),
    });

    // The source itself must be readable.
    expect(
      await refused(
        callMcpOperation(scoped.ctx(), 'listSimilarIncidents', { path: { id: hidden.id } })
      )
    ).not.toBe('allowed');
    const result = (await callMcpOperation(scoped.ctx(), 'listSimilarIncidents', {
      path: { id: mine.id },
    })) as Envelope<Similar>;
    // Only the resolved incident this user can read is a candidate; the unreadable one is not.
    expect(result.data.data.similar.map(row => row.incident.id)).toEqual([visiblePast.id]);

    for (const query of [{ limit: 11 }, { limit: 0 }, { extra: 1 }])
      expect(
        await refused(
          callMcpOperation(scoped.ctx(), 'listSimilarIncidents', { path: { id: mine.id }, query })
        )
      ).not.toBe('allowed');
    const noScope = await principal('RESPONDER', ['schedules:read']);
    expect(
      await refused(
        callMcpOperation(noScope.ctx(), 'listSimilarIncidents', { path: { id: mine.id } })
      )
    ).not.toBe('allowed');
  });
});
