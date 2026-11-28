import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  evaluate: vi.fn(),
  actor: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { serviceObjective: { findMany: mocks.findMany } } }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/slo/authorization', () => ({ serviceObjectiveReadWhere: vi.fn(() => ({})) }));
vi.mock('@/lib/slo/evaluator', () => ({ evaluateServiceObjective: mocks.evaluate }));
vi.mock('@/lib/metrics/operational/registry', () => ({ addOperationalMetric: vi.fn() }));

import { AppError } from '@/lib/errors';
import { GET } from '@/app/api/sla/compliance/route';

function objective(index: number) {
  return {
    lineageId: `so_${index}`,
    name: `Objective ${index}`,
    serviceId: 'svc-1',
    service: { id: 'svc-1', name: 'API' },
    metricType: 'UPTIME',
    target: 99.9,
    windowType: 'ROLLING_DAYS',
    windowValue: 30,
  };
}

describe('GET /api/sla/compliance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' });
  });

  it('evaluates objectives with bounded concurrency and keeps their order', async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 23 }, (_, index) => objective(index)));
    let inFlight = 0;
    let peak = 0;
    mocks.evaluate.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 2));
      inFlight -= 1;
      return {
        value: 100,
        breached: false,
        dataState: 'AVAILABLE',
        sampleCount: 1,
        periodEnd: new Date('2026-01-01T00:00:00Z'),
      };
    });

    const response = await GET(new NextRequest('http://localhost/api/sla/compliance'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(peak).toBeLessThanOrEqual(5);
    expect(mocks.evaluate).toHaveBeenCalledTimes(23);
    expect(body.data.definitions.map((item: { definitionId: string }) => item.definitionId)).toEqual(
      Array.from({ length: 23 }, (_, index) => `so_${index}`)
    );
  });

  it('answers an authorization denial with its own status instead of a 500', async () => {
    mocks.actor.mockRejectedValue(new AppError({ code: 'AUTHORIZATION_DENIED' }));

    const response = await GET(new NextRequest('http://localhost/api/sla/compliance'));

    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
