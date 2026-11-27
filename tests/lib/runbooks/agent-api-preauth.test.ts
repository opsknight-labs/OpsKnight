import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  preauthenticateAgentRequest: vi.fn(),
  verifyAgentRequestSignature: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/runbooks/agent-auth', () => ({
  preauthenticateAgentRequest: mocks.preauthenticateAgentRequest,
  verifyAgentRequestSignature: mocks.verifyAgentRequestSignature,
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));

import {
  agentApiError,
  authenticatedAgentJson,
  enforceAgentEnrollRateLimit,
} from '@/lib/runbooks/agent-api';

const AGENT = { id: 'agent-1', status: 'ONLINE', publicKey: 'key' };

function post(body: string) {
  return new Request('https://opsknight.example.com/api/runbook-agent/v1/artifacts', {
    method: 'POST',
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preauthenticateAgentRequest.mockResolvedValue({
    agent: AGENT,
    timestamp: 't',
    nonce: 'n',
    signature: 's',
  });
  mocks.verifyAgentRequestSignature.mockResolvedValue(AGENT);
  mocks.checkRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 1,
    resetAt: Date.now() + 30_000,
    count: 1,
  });
});

describe('authenticated agent routes', () => {
  it('does not read the body when the request fails pre-authentication', async () => {
    mocks.preauthenticateAgentRequest.mockRejectedValue(new Error('Missing agent authentication headers.'));
    const request = post('x'.repeat(1024));
    const text = vi.spyOn(request, 'text');
    await expect(authenticatedAgentJson(request, 15 * 1024 * 1024)).rejects.toThrow('Missing agent');
    expect(request.bodyUsed).toBe(false);
    expect(text).not.toHaveBeenCalled();
    expect(mocks.verifyAgentRequestSignature).not.toHaveBeenCalled();
  });

  it('rate-limits before buffering and answers 429 with Retry-After', async () => {
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 12_000,
      count: 1201,
    });
    const request = post('{}');
    const failure = await authenticatedAgentJson(request).catch(error => error);
    expect(request.bodyUsed).toBe(false);
    const response = agentApiError(failure);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(11);
    expect(mocks.checkRateLimit.mock.calls[0][0]).toContain('agent-1');
  });

  it('reads and verifies the body once the request passes pre-authentication', async () => {
    const result = await authenticatedAgentJson(post('{"a":1}'));
    expect(mocks.verifyAgentRequestSignature).toHaveBeenCalledWith(
      expect.any(Request),
      '{"a":1}',
      expect.objectContaining({ agent: AGENT })
    );
    expect(result).toEqual({ agent: AGENT, json: { a: 1 } });
  });

  it('rate-limits unauthenticated enrollment per address', async () => {
    await enforceAgentEnrollRateLimit(post('{}'));
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.stringMatching(/^runbook-agent-enroll:/),
      20,
      60_000
    );
  });
});
