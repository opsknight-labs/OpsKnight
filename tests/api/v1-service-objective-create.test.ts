import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    service: { findUnique: vi.fn() },
    serviceObjective: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
  };
  return { tx, emitAuditEvent: vi.fn() };
});

vi.mock('@/lib/rbac', () => ({
  assertAdmin: async () => ({ id: 'admin-1' }),
  getCurrentAuthorizationActor: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: { service: { findUnique: async () => ({ id: 'svc-1' }) } },
}));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: async (op: (tx: typeof m.tx) => unknown) => op(m.tx),
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: m.emitAuditEvent }));

import { POST } from '@/app/api/v1/service-objectives/route';

const body = {
  serviceId: 'svc-1',
  name: 'Checkout uptime',
  metricType: 'UPTIME',
  target: 99.9,
  comparator: 'GREATER_THAN_OR_EQUAL',
  windowType: 'THIRTY_DAYS',
};

const post = () =>
  POST(
    new NextRequest('http://localhost/api/v1/service-objectives', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  );

describe('POST /api/v1/service-objectives', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.tx.service.findUnique.mockResolvedValue({ id: 'svc-1' });
  });

  it('answers 409 and keeps the active objective when the slot is already taken', async () => {
    m.tx.serviceObjective.findFirst.mockResolvedValue({ id: 'so_active', version: 3 });

    const response = await post();

    expect(response.status).toBe(409);
    expect(m.tx.serviceObjective.update).not.toHaveBeenCalled();
    expect(m.tx.serviceObjective.create).not.toHaveBeenCalled();
  });

  it('creates the objective when the slot is empty', async () => {
    m.tx.serviceObjective.findFirst.mockResolvedValue(null);
    m.tx.serviceObjective.create.mockImplementation(async ({ data }: { data: object }) => ({
      ...data,
      version: 1,
    }));

    const response = await post();

    expect(response.status).toBe(201);
    expect(m.tx.serviceObjective.update).not.toHaveBeenCalled();
  });
});
