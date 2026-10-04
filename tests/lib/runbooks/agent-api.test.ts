import { describe, expect, it } from 'vitest';
import { agentApiError } from '@/lib/runbooks/agent-api';
import { RunbookPreExecutionFenceError, RunbookAgentRevokedError } from '@/lib/runbooks/errors';

describe('Agent API retry contract', () => {
  it('keeps unexpected infrastructure failures retryable', () => {
    expect(agentApiError(new Error('database connection pool exhausted')).status).toBe(500);
  });
  it('distinguishes terminal fences and revocation from authentication retries', () => {
    expect(agentApiError(new RunbookPreExecutionFenceError('attempt1', 'superseded')).status).toBe(
      409
    );
    expect(agentApiError(new RunbookAgentRevokedError('agent1')).status).toBe(403);
    expect(agentApiError(new Error('Agent request replay detected.')).status).toBe(401);
  });
});
