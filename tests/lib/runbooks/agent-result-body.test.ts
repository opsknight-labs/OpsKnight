// @vitest-environment node
import { expect, it } from 'vitest';
import { MAX_AGENT_RESULT_BODY_BYTES } from '../../../agent/src/output-limits';
import { readBoundedRequestBody } from '@/lib/runbooks/agent-api';
import { agentJobResultSchema } from '@/lib/runbooks/schemas';

it('accepts the worst-case JSON escaping of a valid result instead of losing its outcome', async () => {
  const evidence = {
    capturedAt: new Date().toISOString(),
    disk: '\0'.repeat(4096),
    processes: '\0'.repeat(4096),
    containerState: '\0'.repeat(4096),
    logSummary: '\0'.repeat(4096),
    serviceState: '\0'.repeat(100),
    captureError: '\0'.repeat(200),
    healthChecks: Array.from({ length: 16 }, () => ({
      url: '\0'.repeat(2048),
      status: 200,
      healthy: true,
    })),
    ports: Array.from({ length: 32 }, () => ({ port: 65535, listening: true })),
  };
  const result = agentJobResultSchema.parse({
    attemptId: 'cm123456789012345678901234',
    leaseToken: 'lease',
    status: 'SUCCEEDED',
    producedAt: new Date().toISOString(),
    outputPreview: '\0'.repeat(32768),
    errorMessage: '\0'.repeat(5000),
    preState: evidence,
    postState: evidence,
  });
  const body = JSON.stringify(result);
  expect(Buffer.byteLength(body)).toBeGreaterThan(128 * 1024);
  const received = await readBoundedRequestBody(
    new Request('http://localhost/result', { method: 'POST', body }),
    MAX_AGENT_RESULT_BODY_BYTES
  );
  expect(agentJobResultSchema.parse(JSON.parse(received))).toEqual(result);
});
it('still rejects oversized streamed result bodies', async () => {
  const request = new Request('http://localhost/result', {
    method: 'POST',
    body: 'x'.repeat(MAX_AGENT_RESULT_BODY_BYTES + 1),
  });
  await expect(readBoundedRequestBody(request, MAX_AGENT_RESULT_BODY_BYTES)).rejects.toThrow(
    'Payload exceeds'
  );
});
