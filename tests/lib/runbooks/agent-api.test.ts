import { describe, expect, it } from 'vitest';
import {
  agentApiError,
  readBoundedRequestBody,
  RunbookPayloadTooLargeError,
} from '@/lib/runbooks/agent-api';
import { RunbookPreExecutionFenceError, RunbookAgentRevokedError } from '@/lib/runbooks/errors';

describe('Agent API retry contract and error mapping', () => {
  it('treats an invalid 10 MiB artifact as terminal rather than a retryable infrastructure outage', () => {
    expect(
      agentApiError(new Error('Compressed artifact must be between 1 byte and 10 MiB.')).status
    ).toBe(400);
  });
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

  it('maps payload size violations to HTTP 413 Payload Too Large', () => {
    const error = new RunbookPayloadTooLargeError(16384);
    const response = agentApiError(error);
    expect(response.status).toBe(413);
  });

  it('maps artifact quota exceeded errors to HTTP 400 Bad Request', () => {
    const response = agentApiError(
      new Error('Artifact quota exceeded: max 10 artifacts allowed per attempt.')
    );
    expect(response.status).toBe(400);
  });

  it('correctly maps cross-chunk error objects using typed error codes without prototype linkage', () => {
    // Simulates an error thrown across webpack chunks in Next.js standalone bundling
    const simulatedNotFoundError = {
      name: 'RunbookAgentNotFoundError',
      code: 'RUNBOOK_AGENT_NOT_FOUND',
      message: 'Agent not found in database.',
    };
    expect(agentApiError(simulatedNotFoundError).status).toBe(404);

    const simulatedRevokedError = {
      name: 'RunbookAgentRevokedError',
      code: 'RUNBOOK_AGENT_REVOKED',
      message: 'Agent revoked.',
    };
    expect(agentApiError(simulatedRevokedError).status).toBe(403);

    const simulatedFenceError = {
      name: 'RunbookPreExecutionFenceError',
      code: 'RUNBOOK_PRE_EXECUTION_FENCE_FAILED',
      message: 'Fence verification failed.',
    };
    expect(agentApiError(simulatedFenceError).status).toBe(409);

    const simulatedLeaseMismatchError = {
      name: 'RunbookAgentLeaseTokenMismatchError',
      code: 'RUNBOOK_AGENT_LEASE_TOKEN_MISMATCH',
      message: 'Token mismatch.',
    };
    expect(agentApiError(simulatedLeaseMismatchError).status).toBe(409);

    const simulatedLeaseExpiredError = {
      name: 'RunbookAgentLeaseExpiredError',
      code: 'RUNBOOK_AGENT_LEASE_EXPIRED',
      message: 'Lease expired.',
    };
    expect(agentApiError(simulatedLeaseExpiredError).status).toBe(409);

    const simulatedDefinitionError = {
      name: 'RunbookDefinitionError',
      code: 'RUNBOOK_DEFINITION_INVALID',
      message: 'Invalid definition.',
    };
    expect(agentApiError(simulatedDefinitionError).status).toBe(400);
  });

  it('preserves HTTP 500 for genuine database, runtime, and infrastructure outages', () => {
    expect(agentApiError(new Error('PostgreSQL connection terminated unexpectedly')).status).toBe(
      500
    );
    expect(agentApiError(new TypeError('Cannot read property "status" of undefined')).status).toBe(
      500
    );
    expect(agentApiError({ code: 'P2025', message: 'Record not found in prisma' }).status).toBe(
      500
    );
  });
});

describe('readBoundedRequestBody streaming bounds', () => {
  it('rejects early based on Content-Length header exceeding limit', async () => {
    const req = new Request('https://opsknight.example.com/api/runbook-agent/v1/claim', {
      method: 'POST',
      headers: {
        'content-length': '10000',
      },
      body: 'a'.repeat(100),
    });

    await expect(readBoundedRequestBody(req, 1024)).rejects.toThrow(RunbookPayloadTooLargeError);
  });

  it('rejects streaming bodies that exceed maxBytes', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.close();
      },
    });

    const req = new Request('https://opsknight.example.com/api/runbook-agent/v1/claim', {
      method: 'POST',
      body: stream,
      // @ts-expect-error Node fetch duplex option
      duplex: 'half',
    });

    await expect(readBoundedRequestBody(req, 1024)).rejects.toThrow(RunbookPayloadTooLargeError);
  });

  it('successfully reads bodies within maxBytes', async () => {
    const content = JSON.stringify({ ok: true, data: 'test' });
    const req = new Request('https://opsknight.example.com/api/runbook-agent/v1/claim', {
      method: 'POST',
      body: content,
    });

    const body = await readBoundedRequestBody(req, 1024);
    expect(body).toBe(content);
  });
});

it.each([
  'Artifact must be valid gzip with at most 10 MiB of decoded text.',
  'Artifact must contain valid UTF-8 text.',
])('maps rejected artifact content to a client error: %s', async message => {
  const response = agentApiError(new Error(message));
  expect(response.status).toBe(400);
});
