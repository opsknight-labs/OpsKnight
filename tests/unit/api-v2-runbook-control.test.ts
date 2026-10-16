import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  tx: { runbookExecution: { findFirst: vi.fn() }, incident: { findFirst: vi.fn() } },
  resolve: vi.fn(),
  preview: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/api-v2/auth', () => ({
  authenticateV2Request: vi.fn(async () => ({
    actor: {
      id: 'operator',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamIds: [],
      apiKey: { id: 'key', scopes: ['runbooks:execute', 'incidents:read'] },
    },
    apiKey: { id: 'key', scopes: ['runbooks:execute', 'incidents:read'] },
  })),
}));
vi.mock('@/lib/api-v2/rate-limit', () => ({ enforceV2RateLimit: vi.fn(async () => ({})) }));
vi.mock('@/lib/api-v2/runbook-execution', () => ({ resolveV2RunbookExecution: mocks.resolve }));
vi.mock('@/lib/runbooks/orchestrator', () => ({
  previewRunbookExecution: mocks.preview,
  startRunbookExecution: mocks.start,
  cancelExecution: mocks.cancel,
}));
vi.mock('@/lib/api-v2/audit', () => ({ logV2Audit: mocks.audit }));
vi.mock('@/lib/api-v2/idempotency', () => ({
  runV2IdempotentMutation: vi.fn(async (_req, _id, _scope, _body, execute) => ({
    value: await execute(mocks.tx),
    replayed: false,
  })),
  idempotencyResponseHeaders: vi.fn(() => ({})),
}));
import { POST as preview } from '@/app/api/v2/runbooks/[id]/executions/preview/route';
import { POST as cancel } from '@/app/api/v2/runbooks/executions/[id]/cancel/route';
import { POST as execute } from '@/app/api/v2/runbooks/[id]/execute/route';

function call(handler: typeof preview, body: unknown = {}, key = 'one-request') {
  return handler(
    new NextRequest('http://localhost/api/v2/runbooks/test', {
      method: 'POST',
      headers: { 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'resource' }) }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({
    runbookId: 'resource',
    triggeredByUserId: 'operator',
    inputValues: {},
  });
  mocks.preview.mockResolvedValue({
    digest: 'a'.repeat(64),
    versionId: 'version',
    version: 1,
    checksum: 'checksum',
    agentId: 'agent',
    agentPoolId: null,
    timeoutSeconds: 30,
    authorizationToken: 'PRIVATE_PREVIEW_CAPABILITY',
    inputs: { password: 'PRIVATE_INPUT' },
    steps: [
      {
        key: 'verify',
        name: 'Verify',
        type: 'BASH',
        risk: 'READ_ONLY',
        purpose: 'Action',
        requiresApproval: false,
        timeoutSeconds: 30,
        config: { command: 'PRIVATE_COMMAND' },
      },
    ],
  });
  mocks.tx.runbookExecution.findFirst.mockResolvedValue({
    id: 'resource',
    incidentId: null,
    triggeredByUserId: 'operator',
  });
  mocks.tx.incident.findFirst.mockResolvedValue({ id: 'incident' });
  mocks.cancel.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
});

describe('runbook preview and cancellation boundaries', () => {
  it('returns a redacted preview without starting any executable work', async () => {
    const response = await call(preview);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.digest).toBe('a'.repeat(64));
    expect(JSON.stringify(body)).not.toContain('PRIVATE_');
    expect(body.data.steps[0]).not.toHaveProperty('config');
    expect(body.data).not.toHaveProperty('inputs');
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('does not execute a changed plan after a client reviewed a prior preview', async () => {
    const response = await call(execute, { expectedPlanDigest: 'b'.repeat(64) });
    expect(response.status).toBe(412);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('returns cancellation requested and joins the outer transaction', async () => {
    const response = await call(cancel, { reason: 'Stop requested by operator' });
    expect(response.status).toBe(202);
    expect((await response.json()).data).toMatchObject({
      executionId: 'resource',
      status: 'CANCEL_REQUESTED',
    });
    expect(mocks.cancel).toHaveBeenCalledWith(
      'resource',
      'operator',
      'Stop requested by operator',
      mocks.tx
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ tx: mocks.tx, actorId: 'operator', apiKeyId: 'key' })
    );
  });
  it('hides a missing or inaccessible incident-linked execution', async () => {
    mocks.tx.runbookExecution.findFirst.mockResolvedValue({
      id: 'resource',
      incidentId: 'private-incident',
      triggeredByUserId: 'operator',
    });
    mocks.tx.incident.findFirst.mockResolvedValue(null);
    expect((await call(cancel, { reason: 'Stop' })).status).toBe(404);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it('hides another operator incident-less execution and produces no side effects', async () => {
    mocks.tx.runbookExecution.findFirst.mockResolvedValue({
      id: 'resource',
      incidentId: null,
      triggeredByUserId: 'other',
      service: { teamId: 'unrelated' },
    });
    expect((await call(cancel, { reason: 'Stop' })).status).toBe(404);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('requires a bounded reason and does not accept a client-supplied final state', async () => {
    for (const body of [
      {},
      { reason: ' ' },
      { reason: 'x'.repeat(1001) },
      { reason: 'Stop', status: 'CANCELLED' },
    ]) {
      expect((await call(cancel, body)).status).toBe(400);
    }
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
