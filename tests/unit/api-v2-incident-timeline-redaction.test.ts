/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

const auth = vi.hoisted(() => ({ capabilities: undefined as Set<string> | undefined }));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi
    .fn()
    .mockResolvedValue({ allowed: true, remaining: 119, resetAt: Date.now() + 60000, count: 1 }),
}));
vi.mock('@/lib/api-v2/auth', () => ({
  authenticateV2Request: vi.fn(async () => ({
    apiKey: { id: 'key_test', scopes: ['incidents:read'] },
    actor: {
      id: 'usr_1',
      role: 'ADMIN',
      status: 'ACTIVE',
      teamIds: [],
      apiKey: { id: 'key_test', scopes: ['incidents:read'] },
      ...(auth.capabilities ? { capabilities: auth.capabilities } : {}),
    },
  })),
}));

import { GET } from '@/app/api/v2/incidents/[id]/timeline/route';

const PAYLOAD = 'Re-triggered by event {"host":"db-1","secret":"hunter2"}';

async function timeline() {
  const req = new NextRequest('http://localhost:3000/api/v2/incidents/inc_1/timeline');
  const res = await GET(req, { params: Promise.resolve({ id: 'inc_1' }) });
  expect(res.status).toBe(200);
  return JSON.stringify(await res.json());
}

describe('GET /api/v2/incidents/[id]/timeline source redaction', () => {
  beforeEach(() => {
    auth.capabilities = undefined;
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      id: 'inc_1',
      assigneeId: null,
      visibility: 'PUBLIC',
      teamId: null,
      automationSourceRestricted: true,
      automationDecision: null,
      automationTraces: [],
      service: { id: 'svc_1', name: 'Svc', teamId: null },
      watchers: [],
    } as any);
    vi.mocked(prisma.incidentEvent.findMany).mockResolvedValue([
      { id: 'ev_1', type: null, message: PAYLOAD, createdAt: new Date() },
    ] as any);
  });

  it('redacts the raw alert payload without incident.sensitive.read', async () => {
    // Effective capabilities replace the role's built-in set, as for a custom role.
    auth.capabilities = new Set(['incident.read.all']);
    const body = await timeline();
    expect(body).not.toContain('hunter2');
    expect(body).toContain('Source content is restricted');
  });

  it('keeps the payload for actors holding incident.sensitive.read', async () => {
    expect(await timeline()).toContain('hunter2');
  });
});
