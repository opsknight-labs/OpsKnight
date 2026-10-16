/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import type { Runbook, ServiceAutomationRule } from '@prisma/client';

// Ensure mockPrisma has runbook and serviceAutomationRule models
(prisma as any).runbook = {
  findUnique: vi.fn().mockResolvedValue(null),
  findFirst: vi.fn().mockResolvedValue(null),
};
(prisma as any).serviceAutomationRule = {
  findMany: vi.fn().mockResolvedValue([]),
};

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60000,
    count: 1,
  }),
}));

let currentMockActor: any = {
  id: 'usr_responder_1',
  role: 'RESPONDER',
  status: 'ACTIVE',
  teamIds: ['team_alpha'],
  apiKey: { id: 'key_resp_1', scopes: ['runbooks:read', 'runbooks:execute', 'incidents:read'] },
};

vi.mock('@/lib/api-v2/auth', () => ({
  authenticateV2Request: vi.fn().mockImplementation(async () => ({
    apiKey: currentMockActor.apiKey,
    actor: currentMockActor,
  })),
}));

vi.mock('@/lib/runbooks/orchestrator', () => ({
  previewRunbookExecution: vi.fn().mockResolvedValue({
    digest: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    authorizationToken: 'token1234567890token1234567890token1234567890token1234567890',
    checksum: 'chk_123',
    inputs: {},
  }),
  startRunbookExecution: vi.fn().mockResolvedValue({
    id: 'exec_abc_123',
    status: 'RUNNING',
  }),
}));

vi.mock('@/lib/api-v2/audit', () => ({
  logV2Audit: vi.fn().mockResolvedValue(undefined),
}));

import { POST as executeRunbookRoute } from '@/app/api/v2/runbooks/[id]/execute/route';
import { previewRunbookExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';

describe('POST /api/v2/runbooks/[id]/execute execution boundary & authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMockActor = {
      id: 'usr_responder_1',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamIds: ['team_alpha'],
      apiKey: { id: 'key_resp_1', scopes: ['runbooks:read', 'runbooks:execute', 'incidents:read'] },
    };
  });

  it('rejects execution when runbook does not exist or is unpublished', async () => {
    vi.mocked(prisma.runbook.findUnique).mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/v2/runbooks/rb_missing/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-missing-1',
      },
      body: JSON.stringify({}),
    });

    const res = await executeRunbookRoute(req, { params: Promise.resolve({ id: 'rb_missing' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('RUNBOOK_NOT_FOUND');
  });

  it('rejects incident-linked execution when incident does not exist', async () => {
    vi.mocked(prisma.runbook.findUnique).mockResolvedValue({
      id: 'rb_1',
      name: 'Restart Pods',
      archivedAt: null,
      publishedVersionId: 'ver_pub_1',
    } as any);

    vi.mocked(prisma.incident.findFirst).mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/v2/runbooks/rb_1/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-inc-missing',
      },
      body: JSON.stringify({ incidentId: 'inc_nonexistent' }),
    });

    const res = await executeRunbookRoute(req, { params: Promise.resolve({ id: 'rb_1' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('INCIDENT_NOT_FOUND');
  });

  it('treats an incident the caller cannot read as not found, applying the canonical read filter', async () => {
    currentMockActor = {
      id: 'usr_responder_2',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamIds: ['team_other'],
      apiKey: { id: 'key_resp_2', scopes: ['runbooks:read', 'runbooks:execute', 'incidents:read'] },
    };

    vi.mocked(prisma.runbook.findUnique).mockResolvedValue({
      id: 'rb_1',
      name: 'Restart Pods',
      archivedAt: null,
      publishedVersionId: 'ver_pub_1',
    } as any);
    // The read filter excludes the incident, so the database returns nothing for it.
    vi.mocked(prisma.incident.findFirst).mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/v2/runbooks/rb_1/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-private-inc-user' },
      body: JSON.stringify({ incidentId: 'inc_private' }),
    });

    const res = await executeRunbookRoute(req, { params: Promise.resolve({ id: 'rb_1' }) });
    // Indistinguishable from a missing incident: existence is not revealed.
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('INCIDENT_NOT_FOUND');
    expect(prisma.incident.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ id: 'inc_private' }, expect.anything()] } })
    );
  });

  it('permits incident-linked execution when incident is private and caller is a RESPONDER', async () => {
    currentMockActor = {
      id: 'usr_responder_1',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamIds: ['team_other'],
      apiKey: { id: 'key_resp_1', scopes: ['runbooks:read', 'runbooks:execute', 'incidents:read'] },
    };

    vi.mocked(prisma.runbook.findUnique).mockResolvedValue({
      id: 'rb_1',
      name: 'Restart Pods',
      archivedAt: null,
      publishedVersionId: 'ver_pub_1',
    } as any);

    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc_private_resp',
      serviceId: 'svc_alpha',
      visibility: 'RESTRICTED',
      assigneeId: 'usr_other',
      watchers: [],
      service: { id: 'svc_alpha', name: 'Alpha', teamId: 'team_alpha' },
    } as any);

    vi.mocked(prisma.serviceAutomationRule.findMany).mockResolvedValue([
      {
        id: 'bind_rb1_svcalpha',
        runbookId: 'rb_1',
        serviceId: 'svc_alpha',
        enabled: true,
        versionStrategy: 'PINNED',
        runbookVersionId: 'ver_pinned_99',
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/v2/runbooks/rb_1/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-private-inc-responder',
      },
      body: JSON.stringify({ incidentId: 'inc_private_resp' }),
    });

    const res = await executeRunbookRoute(req, { params: Promise.resolve({ id: 'rb_1' }) });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.executionId).toBe('exec_abc_123');
  });

  it('rejects when runbook is not bound to the incident service', async () => {
    vi.mocked(prisma.runbook.findUnique).mockResolvedValue({
      id: 'rb_1',
      name: 'Restart Pods',
      archivedAt: null,
      publishedVersionId: 'ver_pub_1',
    } as any);

    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc_100',
      serviceId: 'svc_beta',
      visibility: 'PUBLIC',
      assigneeId: null,
      watchers: [],
      service: { id: 'svc_beta', name: 'Beta', teamId: 'team_beta' },
    } as any);

    // No binding between rb_1 and svc_beta
    vi.mocked(prisma.serviceAutomationRule.findMany).mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/v2/runbooks/rb_1/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-no-binding',
      },
      body: JSON.stringify({ incidentId: 'inc_100' }),
    });

    const res = await executeRunbookRoute(req, { params: Promise.resolve({ id: 'rb_1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('RUNBOOK_DEFINITION_INVALID');
    expect(body.detail).toContain('not bound to service');
  });

  it('resolves incident service boundary and binding, passing them to orchestrator', async () => {
    vi.mocked(prisma.runbook.findUnique).mockResolvedValue({
      id: 'rb_1',
      name: 'Restart Pods',
      archivedAt: null,
      publishedVersionId: 'ver_pub_1',
    } as any);

    vi.mocked(prisma.incident.findFirst).mockResolvedValue({
      id: 'inc_100',
      serviceId: 'svc_alpha',
      visibility: 'PUBLIC',
      assigneeId: null,
      watchers: [],
      service: { id: 'svc_alpha', name: 'Alpha', teamId: 'team_alpha' },
    } as any);

    vi.mocked(prisma.serviceAutomationRule.findMany).mockResolvedValue([
      {
        id: 'bind_rb1_svcalpha',
        runbookId: 'rb_1',
        serviceId: 'svc_alpha',
        enabled: true,
        versionStrategy: 'PINNED',
        runbookVersionId: 'ver_pinned_99',
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/v2/runbooks/rb_1/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-success-exec-1',
      },
      body: JSON.stringify({
        incidentId: 'inc_100',
      }),
    });

    const res = await executeRunbookRoute(req, { params: Promise.resolve({ id: 'rb_1' }) });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.data).toMatchObject({
      executionId: 'exec_abc_123',
      status: 'RUNNING',
      runbookId: 'rb_1',
      incidentId: 'inc_100',
      serviceId: 'svc_alpha',
    });

    // Check previewRunbookExecution was called with serviceId, bindingId, and versionId
    expect(previewRunbookExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runbookId: 'rb_1',
        runbookVersionId: 'ver_pinned_99',
        serviceId: 'svc_alpha',
        bindingId: 'bind_rb1_svcalpha',
        incidentId: 'inc_100',
        triggeredByUserId: 'usr_responder_1',
        inputValues: {},
      }),
      expect.anything()
    );

    // Check startRunbookExecution was called with all resolved boundaries
    expect(startRunbookExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runbookId: 'rb_1',
        runbookVersionId: 'ver_pinned_99',
        serviceId: 'svc_alpha',
        bindingId: 'bind_rb1_svcalpha',
        incidentId: 'inc_100',
        triggeredByUserId: 'usr_responder_1',
        inputValues: {},
        expectedPlanDigest: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        previewAuthorizationToken: 'token1234567890token1234567890token1234567890token1234567890',
      }),
      expect.anything(),
      { apiClientId: 'key_resp_1' }
    );
  });

  it('allows global execution without incidentId when no incident is passed', async () => {
    vi.mocked(prisma.runbook.findUnique).mockResolvedValue({
      id: 'rb_1',
      name: 'Global Check',
      archivedAt: null,
      publishedVersionId: 'ver_pub_1',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/v2/runbooks/rb_1/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'idem-global-1',
      },
      body: JSON.stringify({
        parameters: { test: true },
      }),
    });

    const res = await executeRunbookRoute(req, { params: Promise.resolve({ id: 'rb_1' }) });
    expect(res.status).toBe(202);

    expect(previewRunbookExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runbookId: 'rb_1',
        runbookVersionId: 'ver_pub_1',
        incidentId: undefined,
        serviceId: undefined,
        bindingId: undefined,
      }),
      expect.anything()
    );
  });
  it.each([false, true])(
    'requires explicit selection when multiple rules exist (binding supplied: %s)',
    async explicit => {
      vi.mocked(prisma.runbook.findUnique).mockResolvedValue({
        id: 'rb_1',
        name: 'Shared workflow',
        archivedAt: null,
        publishedVersionId: 'ver_pub_1',
      } as Runbook);
      const rule = {
        id: 'selected_rule',
        serviceId: 'svc_alpha',
        enabled: true,
        versionStrategy: 'PINNED',
        runbookVersionId: 'ver_pinned_99',
      };
      vi.mocked(prisma.serviceAutomationRule.findMany).mockResolvedValue(
        (explicit ? [rule] : [rule, { ...rule, id: 'another_rule' }]) as ServiceAutomationRule[]
      );
      const res = await executeRunbookRoute(
        new NextRequest('http://localhost:3000/api/v2/runbooks/rb_1/execute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': `multi-rule-${explicit}`,
          },
          body: JSON.stringify({
            serviceId: 'svc_alpha',
            ...(explicit ? { bindingId: rule.id } : {}),
          }),
        }),
        { params: Promise.resolve({ id: 'rb_1' }) }
      );
      expect(prisma.serviceAutomationRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            detachedAt: null,
            enabled: true,
            ...(explicit ? { id: rule.id } : {}),
          }),
          take: 2,
        })
      );
      expect(res.status).toBe(explicit ? 202 : 400);
      if (!explicit) {
        expect((await res.json()).detail).toContain('Specify bindingId');
        expect(startRunbookExecution).not.toHaveBeenCalled();
      }
    }
  );
  it('rejects bound-rule parameters instead of silently using different saved inputs', async () => {
    vi.mocked(prisma.runbook.findUnique).mockResolvedValue({
      id: 'rb_1',
      name: 'Bound rule',
      archivedAt: null,
      publishedVersionId: 'ver_1',
    } as Runbook);
    vi.mocked(prisma.serviceAutomationRule.findMany).mockResolvedValue([
      {
        id: 'bound_rule',
        serviceId: 'service_1',
        enabled: true,
        versionStrategy: 'PINNED',
        runbookVersionId: 'ver_1',
      },
    ] as ServiceAutomationRule[]);
    const response = await executeRunbookRoute(
      new NextRequest('http://localhost:3000/api/v2/runbooks/rb_1/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'bound-override' },
        body: JSON.stringify({ bindingId: 'bound_rule', parameters: { environment: 'staging' } }),
      }),
      { params: Promise.resolve({ id: 'rb_1' }) }
    );
    expect(response.status).toBe(400);
    expect((await response.json()).detail).toContain('Service rules use their saved inputs');
    expect(previewRunbookExecution).not.toHaveBeenCalled();
    expect(startRunbookExecution).not.toHaveBeenCalled();
  });
});
