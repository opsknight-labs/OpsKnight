import { describe, expect, it } from 'vitest';
import {
  agentApiError,
  readBoundedRequestBody,
  RunbookPayloadTooLargeError,
} from '@/lib/runbooks/agent-api';
import { RunbookPreExecutionFenceError, RunbookAgentRevokedError } from '@/lib/runbooks/errors';

describe('Agent API retry contract and error mapping', () => {
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
