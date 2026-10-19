import { gzipSync, gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: vi.fn(),
  incident: vi.fn(),
  service: vi.fn(),
  find: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: mocks.permissions,
  assertCanViewIncident: mocks.incident,
  assertCanViewService: mocks.service,
}));
vi.mock('@/lib/prisma', () => ({ default: { runbookArtifact: { findUnique: mocks.find } } }));
import { GET } from '@/app/api/runbook-artifacts/[id]/route';

const context = { params: Promise.resolve({ id: 'cltestartifact00000000000001' }) };

describe('Runbook artifact read boundary', () => {
  beforeEach(() => vi.resetAllMocks());
  it('rejects users without Runbook read permission before querying artifacts', async () => {
    mocks.permissions.mockResolvedValue({ capabilities: [] });
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(403);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it('rejects ordinary global readers before querying sensitive output', async () => {
    mocks.permissions.mockResolvedValue({ capabilities: ['runbook.read.all'] });
    expect((await GET(new Request('http://localhost'), context)).status).toBe(403);
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it('permits scoped artifact access only after checking its incident', async () => {
    mocks.permissions.mockResolvedValue({
      capabilities: ['runbook.read.scoped', 'runbook.artifact.download'],
    });
    mocks.find
      .mockResolvedValueOnce({
        attempt: {
          executionStep: { execution: { incidentId: 'incident1', serviceId: 'service1' } },
        },
      })
      .mockResolvedValueOnce({
        attemptId: 'attempt1',
        content: gzipSync(Buffer.from('password=hidden-value\nhealthy')),
      });
    mocks.incident.mockResolvedValue({});
    const response = await GET(new Request('http://localhost'), context);
    expect(response.status).toBe(200);
    expect(mocks.incident).toHaveBeenCalledWith('incident1');
    const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString();
    expect(text).not.toContain('hidden-value');
    expect(text).toContain('healthy');
  });
  it('never loads artifact content after a failed scoped access check', async () => {
    mocks.permissions.mockResolvedValue({
      capabilities: ['runbook.read.scoped', 'runbook.artifact.download'],
    });
    mocks.find.mockResolvedValueOnce({
      attempt: { executionStep: { execution: { incidentId: 'incident1', serviceId: 'service1' } } },
    });
    mocks.incident.mockRejectedValue(new Error('Forbidden'));
    await GET(new Request('http://localhost'), context);
    expect(mocks.find).toHaveBeenCalledTimes(1);
  });
});
