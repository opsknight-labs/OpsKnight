import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const m = vi.hoisted(() => ({
  actor: { current: null as unknown },
  serviceObjectiveFindMany: vi.fn(),
}));

vi.mock('@/lib/api-v2/observability', () => ({
  withV2Observability: (handler: unknown) => handler,
}));
vi.mock('@/lib/api-v2', () => ({
  authenticateV2Request: async () => ({ apiKey: { id: 'key-1' }, actor: m.actor.current }),
  enforceV2RateLimit: async () => ({}),
  enforceV2Authorization: () => undefined,
  apiV2Success: (data: unknown) => Response.json({ data }),
  apiV2Error: (error: unknown) => {
    throw error;
  },
}));
vi.mock('@/lib/escalation/target-resolution', () => ({ resolveEscalationTargetDetailed: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    service: {
      findFirst: async () => ({
        id: 'svc-1',
        name: 'Checkout',
        status: 'OPERATIONAL',
        escalationPolicyId: null,
        policy: null,
      }),
    },
    incident: { count: async () => 0, findMany: async () => [] },
    alert: { count: async () => 0 },
    notification: { count: async () => 0 },
    serviceObjective: { findMany: m.serviceObjectiveFindMany },
  },
}));

import { GET } from '@/app/api/v2/services/[id]/health-summary/route';

const scoped: AuthorizationActor = {
  id: 'user-1',
  role: 'USER',
  status: 'ACTIVE',
  teamIds: ['team-1'],
};
const admin: AuthorizationActor = { ...scoped, id: 'admin-1', role: 'ADMIN' };

const snapshot = {
  periodEnd: new Date('2026-01-01'),
  value: 99.1,
  breached: false,
  dataState: 'OK',
};

async function call(actor: AuthorizationActor) {
  m.actor.current = actor;
  const response = await GET(
    new NextRequest('http://localhost/api/v2/services/svc-1/health-summary'),
    {
      params: Promise.resolve({ id: 'svc-1' }),
    }
  );
  return (await response.json()).data;
}

describe('GET /api/v2/services/{id}/health-summary objectives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Honour `take` the way the database would, so the test fails if the route asks for a snapshot.
    m.serviceObjectiveFindMany.mockImplementation(
      async ({ select }: { select: { snapshots: { take: number } } }) => [
        {
          lineageId: 'lineage-1',
          name: 'Availability',
          metricType: 'AVAILABILITY',
          target: 99.9,
          snapshots: [snapshot].slice(0, select.snapshots.take),
        },
      ]
    );
  });

  it('withholds the shared snapshot from a scoped reader and reports the objective lineage id', async () => {
    const body = await call(scoped);

    expect(body.objectives).toEqual([
      expect.objectContaining({ id: 'lineage-1', latestSnapshot: null }),
    ]);
  });

  it('still gives the latest snapshot to a reader with global metrics visibility', async () => {
    const body = await call(admin);

    expect(body.objectives[0].latestSnapshot).toMatchObject({ value: 99.1, dataState: 'OK' });
  });
});
