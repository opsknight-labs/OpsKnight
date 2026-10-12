import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as startRoute } from '../../../src/app/api/runbook-agent/v1/jobs/[id]/start/route';
import { POST as resultRoute } from '../../../src/app/api/runbook-agent/v1/jobs/[id]/result/route';
import { POST as heartbeatRoute } from '../../../src/app/api/runbook-agent/v1/heartbeat/route';
import { POST as claimRoute } from '../../../src/app/api/runbook-agent/v1/claim/route';

const {
  mockAuthenticatedAgentJson,
  mockFenceAgentAttempt,
  mockSubmitAgentResult,
  mockRecordAgentHeartbeat,
  mockClaimAgentAttempt,
} = vi.hoisted(() => ({
  mockAuthenticatedAgentJson: vi.fn(),
  mockFenceAgentAttempt: vi.fn(),
  mockSubmitAgentResult: vi.fn(),
  mockRecordAgentHeartbeat: vi.fn(),
  mockClaimAgentAttempt: vi.fn(),
}));

vi.mock('../../../src/lib/runbooks/agent-api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/lib/runbooks/agent-api')>();
  return {
    ...actual,
    authenticatedAgentJson: mockAuthenticatedAgentJson,
  };
});

vi.mock('../../../src/lib/runbooks/agent-claims', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/lib/runbooks/agent-claims')>();
  return {
    ...actual,
    fenceAgentAttempt: mockFenceAgentAttempt,
    submitAgentResult: mockSubmitAgentResult,
    recordAgentHeartbeat: mockRecordAgentHeartbeat,
    claimAgentAttempt: mockClaimAgentAttempt,
  };
});

vi.mock('../../../src/lib/runbooks/execution-signing', () => ({
  signExecutionEnvelope: vi.fn(async payload => ({
    ...payload,
    signature: 'mock-sig',
    signedAt: new Date().toISOString(),
  })),
}));

describe('Agent API Routes — HTTP status and error contract integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedAgentJson.mockResolvedValue({
      agent: { id: 'agent_123', name: 'test-agent' },
      json: { leaseToken: 'lease-token-12345678901234567890' },
    });
  });

  it('maps RUNBOOK_AGENT_NOT_FOUND to HTTP 404 across real route handlers', async () => {
    // Cross-chunk error without prototype inheritance
    const crossChunkNotFoundError = {
      name: 'RunbookAgentNotFoundError',
      code: 'RUNBOOK_AGENT_NOT_FOUND',
      message: 'Agent not found.',
    };
    mockAuthenticatedAgentJson.mockRejectedValueOnce(crossChunkNotFoundError);

    const request = new Request('http://localhost:3000/api/runbook-agent/v1/jobs/cuid123456789012345678901/start', {
      method: 'POST',
    });
    const response = await startRoute(request, {
      params: Promise.resolve({ id: 'cuid123456789012345678901' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Agent not found.');
  });

  it('maps RUNBOOK_AGENT_REVOKED to HTTP 403', async () => {
    const crossChunkRevokedError = {
      name: 'RunbookAgentRevokedError',
      code: 'RUNBOOK_AGENT_REVOKED',
      message: 'Agent has been revoked.',
    };
    mockAuthenticatedAgentJson.mockRejectedValueOnce(crossChunkRevokedError);

    const request = new Request('http://localhost:3000/api/runbook-agent/v1/heartbeat', {
      method: 'POST',
    });
    const response = await heartbeatRoute(request);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('Agent has been revoked.');
  });

  it('maps fence and lease mismatches to HTTP 409', async () => {
    // 1. Start route fence failure
    mockFenceAgentAttempt.mockRejectedValueOnce({
      name: 'RunbookPreExecutionFenceError',
      code: 'RUNBOOK_PRE_EXECUTION_FENCE_FAILED',
      message: 'Fence verification failed.',
    });

    const request = new Request('http://localhost:3000/api/runbook-agent/v1/jobs/cuid123456789012345678901/start', {
      method: 'POST',
    });
    const response = await startRoute(request, {
      params: Promise.resolve({ id: 'cuid123456789012345678901' }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('Execution result or lease is outside its accepted fence.');

    // 2. Result route lease token mismatch
    mockAuthenticatedAgentJson.mockResolvedValueOnce({
      agent: { id: 'agent_123', name: 'test-agent' },
      json: {
        leaseToken: 'lease-token-12345678901234567890',
        status: 'SUCCEEDED',
      },
    });
    mockSubmitAgentResult.mockRejectedValueOnce({
      name: 'RunbookAgentLeaseTokenMismatchError',
      code: 'RUNBOOK_AGENT_LEASE_TOKEN_MISMATCH',
      message: 'Token mismatch.',
    });

    const resultReq = new Request('http://localhost:3000/api/runbook-agent/v1/jobs/cuid123456789012345678901/result', {
      method: 'POST',
    });
    const resultRes = await resultRoute(resultReq, {
      params: Promise.resolve({ id: 'cuid123456789012345678901' }),
    });

    expect(resultRes.status).toBe(409);
    const resultBody = await resultRes.json();
    expect(resultBody.error).toBe('Execution result or lease is outside its accepted fence.');
  });

  it('maps schema and definition errors to HTTP 400', async () => {
    mockAuthenticatedAgentJson.mockResolvedValueOnce({
      agent: { id: 'agent_123', name: 'test-agent' },
      json: { invalidField: 'missing leaseToken' },
    });

    const request = new Request('http://localhost:3000/api/runbook-agent/v1/jobs/cuid123456789012345678901/start', {
      method: 'POST',
    });
    const response = await startRoute(request, {
      params: Promise.resolve({ id: 'cuid123456789012345678901' }),
    });

    expect(response.status).toBe(400);
  });

  it('preserves HTTP 500 for genuine database, Prisma, and infrastructure outages', async () => {
    // 1. Database connection termination
    mockFenceAgentAttempt.mockRejectedValueOnce(
      new Error('PostgreSQL connection terminated unexpectedly')
    );

    const req1 = new Request('http://localhost:3000/api/runbook-agent/v1/jobs/cuid123456789012345678901/start', {
      method: 'POST',
    });
    const res1 = await startRoute(req1, {
      params: Promise.resolve({ id: 'cuid123456789012345678901' }),
    });

    expect(res1.status).toBe(500);
    const body1 = await res1.json();
    expect(body1.error).toBe('Agent API temporarily unavailable.');

    // 2. Prisma database connection failure
    mockClaimAgentAttempt.mockRejectedValueOnce({
      code: 'P2025',
      message: 'Connection pool exhausted / transaction timeout',
    });

    const req2 = new Request('http://localhost:3000/api/runbook-agent/v1/claim', {
      method: 'POST',
    });
    const res2 = await claimRoute(req2);

    expect(res2.status).toBe(500);
    const body2 = await res2.json();
    expect(body2.error).toBe('Agent API temporarily unavailable.');

    // 3. Result route unexpected infrastructure error
    mockAuthenticatedAgentJson.mockResolvedValueOnce({
      agent: { id: 'agent_123', name: 'test-agent' },
      json: {
        leaseToken: 'lease-token-12345678901234567890',
        status: 'SUCCEEDED',
      },
    });
    mockSubmitAgentResult.mockRejectedValueOnce(
      new Error('PostgreSQL disk full')
    );

    const req3 = new Request('http://localhost:3000/api/runbook-agent/v1/jobs/cuid123456789012345678901/result', {
      method: 'POST',
    });
    const res3 = await resultRoute(req3, {
      params: Promise.resolve({ id: 'cuid123456789012345678901' }),
    });

    expect(res3.status).toBe(500);
    const body3 = await res3.json();
    expect(body3.error).toBe('Agent API temporarily unavailable.');
  });
});
