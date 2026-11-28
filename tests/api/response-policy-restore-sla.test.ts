import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  default: { incidentSlaPolicy: { findUnique: m.findUnique } },
}));
vi.mock('@/lib/response-policy-api-auth', () => ({
  authorizeResponsePolicyApi: async () => ({ ok: true, actor: { id: 'admin-1' } }),
  responsePolicyAuthError: vi.fn(),
}));
vi.mock('@/lib/metrics/operational/registry', () => ({ addOperationalMetric: vi.fn() }));
// Validate with the real input schema; only the database write is replaced.
vi.mock('@/lib/incident-sla/policy-config', async () => {
  const { incidentSlaPolicyInputSchema } = await import('@/lib/incident-sla/policy-validation');
  return {
    saveIncidentSlaPolicy: async (input: unknown) => incidentSlaPolicyInputSchema.parse(input),
  };
});

import { POST } from '@/app/api/v1/response-policy/restore/route';

describe('POST /api/v1/response-policy/restore (sla)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restores a version whose rules were stored without labels', async () => {
    m.findUnique.mockResolvedValue({
      sealedAt: new Date('2026-01-01T00:00:00Z'),
      inheritWorkspace: false,
      baseAckTargetMs: 60_000,
      baseResolveTargetMs: 600_000,
      rules: [{ priority: 'P1', ackTargetMs: 30_000, resolveTargetMs: 300_000, label: null }],
    });

    const response = await POST(
      new NextRequest('http://localhost/api/v1/response-policy/restore', {
        method: 'POST',
        body: JSON.stringify({
          resource: 'sla',
          scopeKey: 'workspace',
          version: 2,
          expectedVersion: 3,
        }),
      })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain('"priority":"P1"');
  });
});
