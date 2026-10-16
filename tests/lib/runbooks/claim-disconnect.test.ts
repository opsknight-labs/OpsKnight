import { it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({ claim: vi.fn(), hint: vi.fn() }));
vi.mock('@/lib/runbooks/agent-api', () => ({
  authenticatedAgentJson: async () => ({ agent: { id: 'agent' } }),
  agentApiError: () => new Response(null, { status: 500 }),
}));
vi.mock('@/lib/runbooks/agent-claims', () => ({ claimAgentAttempt: mock.claim }));
vi.mock('@/lib/runbooks/claim-availability', () => ({ mayHaveAgentWork: mock.hint }));
import { POST } from '@/app/api/runbook-agent/v1/claim/route';
it('does not claim work for a disconnected authenticated request', async () => {
  vi.clearAllMocks();
  const signal = AbortSignal.abort();
  expect(
    (await POST(new Request('http://localhost/claim?waitSeconds=25', { method: 'POST', signal })))
      .status
  ).toBe(204);
  expect(mock.hint).not.toHaveBeenCalled();
  expect(mock.claim).not.toHaveBeenCalled();
});
it('releases its long poll promptly when the caller disconnects', async () => {
  vi.clearAllMocks();
  mock.hint.mockResolvedValue(false);
  const controller = new AbortController();
  const response = POST(
    new Request('http://localhost/claim?waitSeconds=25', {
      method: 'POST',
      signal: controller.signal,
    })
  );
  setTimeout(() => controller.abort(), 10);
  expect((await response).status).toBe(204);
  expect(mock.claim).not.toHaveBeenCalled();
});

it('rechecks disconnect after the shared availability probe resolves', async () => {
  vi.clearAllMocks();
  const controller = new AbortController();
  mock.hint.mockImplementationOnce(async () => {
    controller.abort();
    return true;
  });
  expect(
    (
      await POST(
        new Request('http://localhost/claim', { method: 'POST', signal: controller.signal })
      )
    ).status
  ).toBe(204);
  expect(mock.claim).not.toHaveBeenCalled();
});
