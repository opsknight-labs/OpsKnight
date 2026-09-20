import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  legacyFindMany: vi.fn(),
  objectiveFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    sLADefinition: { findMany: mocks.legacyFindMany },
    serviceObjective: { findMany: mocks.objectiveFindMany },
  },
}));
vi.mock('@/lib/rbac', () => ({
  getCurrentAuthorizationActor: vi.fn(async () => ({ role: 'ADMIN' })),
}));
vi.mock('@/lib/authorization-filters', () => ({ serviceReadWhere: vi.fn(() => ({})) }));
vi.mock('@/lib/slo/authorization', () => ({ serviceObjectiveReadWhere: vi.fn(() => ({})) }));
vi.mock('@/lib/metrics/operational/registry', () => ({ addOperationalMetric: vi.fn() }));

import { GET } from '@/app/api/sla-definitions/route';

describe('legacy SLA definition compatibility list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not resurrect a legacy definition after its migrated objective is retired', async () => {
    const legacy = {
      id: 'legacy-1',
      serviceId: 'service-1',
      activeFrom: new Date('2026-01-01T00:00:00Z'),
      activeTo: null,
      service: { id: 'service-1', name: 'API' },
    };
    mocks.legacyFindMany.mockResolvedValue([legacy]);
    mocks.objectiveFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ legacySlaDefinitionId: 'legacy-1' }]);

    const response = await GET(new NextRequest('http://localhost/api/sla-definitions'));

    expect(await response.json()).toEqual([]);
    expect(mocks.objectiveFindMany.mock.calls[1][0].where).not.toHaveProperty('activeTo');
  });
});
