// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { AgentApiError } from '../../../agent/src/client';
import { deliverSpoolRecord } from '../../../agent/src/result-delivery';
import { ResultSpool } from '../../../agent/src/spool';
import { boundOutput, MAX_DECODED_OUTPUT_BYTES } from '../../../agent/src/output-limits';
import { sanitizeCompressedArtifact } from '@/lib/runbooks/artifact-safety';
import type { SpoolRecord } from '../../../agent/src/types';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'rbe-delivery-'));
  directories.push(directory);
  const spool = new ResultSpool(directory);
  const record: SpoolRecord = {
    attemptId: 'attempt123',
    leaseToken: 'lease',
    producedAt: new Date().toISOString(),
    status: 'SUCCEEDED',
    exitCode: 0,
    outputPreview: 'action completed',
    localOutput: 'x'.repeat(MAX_DECODED_OUTPUT_BYTES) + '\n[output truncated]',
  };
  await spool.put(record);
  return { spool, record };
}
it('reports maximum highly compressible output within the server decoded limit, including markers', async () => {
  const { spool, record } = await fixture();
  const client = {
    uploadArtifact: vi.fn(async (input: Record<string, unknown>) => {
      const content = Buffer.from(String(input.contentBase64), 'base64');
      expect(gunzipSync(content).length).toBeLessThanOrEqual(MAX_DECODED_OUTPUT_BYTES);
      await expect(sanitizeCompressedArtifact(content)).resolves.toBeDefined();
      return { id: 'artifact123' };
    }),
    submit: vi.fn(async () => ({ accepted: true })),
  };
  await deliverSpoolRecord(client, spool, record);
  expect(client.submit).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'SUCCEEDED', outputArtifactId: 'artifact123' })
  );
  expect(client.submit).toHaveBeenCalledWith(
    expect.not.objectContaining({ localOutput: expect.anything() })
  );
});
it('bounds output after credential sanitization expands short values', async () => {
  const { spool, record } = await fixture();
  record.localOutput = 'token=x\n'.repeat(1_000_000);
  const client = {
    uploadArtifact: vi.fn(async (input: Record<string, unknown>) => {
      const decoded = gunzipSync(Buffer.from(String(input.contentBase64), 'base64'));
      expect(decoded.length).toBeLessThanOrEqual(MAX_DECODED_OUTPUT_BYTES);
      expect(decoded.toString()).not.toContain('token=x');
      expect(input.truncated).toBe(true);
      return { id: 'artifact123' };
    }),
    submit: vi.fn(async () => ({ accepted: true })),
  };
  await deliverSpoolRecord(client, spool, record);
  expect(client.submit).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCEEDED' }));
});
it.each([400, 413, 503])('still submits and durably explains artifact HTTP %s', async status => {
  const { spool, record } = await fixture();
  const client = {
    uploadArtifact: vi.fn().mockRejectedValue(new AgentApiError('secret remote response', status)),
    submit: vi.fn().mockResolvedValue({ accepted: true }),
  };
  await deliverSpoolRecord(client, spool, record);
  expect(client.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'SUCCEEDED',
      exitCode: 0,
      outputPreview: expect.stringContaining(`Artifact unavailable: HTTP ${status}`),
    })
  );
  expect((await spool.list())[0].outputPreview).not.toContain('secret remote response');
  expect((await spool.list())[0].localOutput === undefined).toBe(status === 400 || status === 413);
  expect(await spool.deadLetterDepth()).toBe(0);
});
it.each([false, true])(
  'submits the already-spooled outcome when metadata fsync fails, artifact rejected=%s',
  async rejected => {
    const { spool, record } = await fixture();
    const client = {
      uploadArtifact: rejected
        ? vi.fn().mockRejectedValue(new AgentApiError('rejected', 400))
        : vi.fn().mockResolvedValue({ id: 'artifact123' }),
      submit: vi.fn().mockResolvedValue({ accepted: true }),
    };
    await deliverSpoolRecord(
      client,
      { put: vi.fn().mockRejectedValue(new Error('ENOSPC')) },
      record
    );
    expect(client.submit).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUCCEEDED' }));
    expect((await spool.list())[0]).toMatchObject({
      status: 'SUCCEEDED',
      localOutput: record.localOutput,
    });
  }
);
it('recovers interrupted upload and result submission from the durable spool without repeating a write', async () => {
  const { spool, record } = await fixture();
  const client = {
    uploadArtifact: vi
      .fn()
      .mockRejectedValueOnce(new Error('socket interrupted'))
      .mockResolvedValue({ id: 'artifact123' }),
    submit: vi
      .fn()
      .mockRejectedValueOnce(new Error('result connection lost'))
      .mockResolvedValue({ accepted: true }),
  };
  await expect(deliverSpoolRecord(client, spool, record)).rejects.toThrow('result connection lost');
  const restartedSpool = new ResultSpool(directories[0]);
  const [pending] = await restartedSpool.list();
  expect(pending).toMatchObject({
    status: 'SUCCEEDED',
    localOutput: record.localOutput,
    outputPreview: expect.stringContaining('upload interrupted'),
  });
  await deliverSpoolRecord(client, restartedSpool, pending);
  await restartedSpool.remove(pending.attemptId);
  expect(await restartedSpool.depth()).toBe(0);
  expect(client.submit).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: 'SUCCEEDED',
      outputArtifactId: 'artifact123',
      outputPreview: expect.not.stringContaining('Artifact unavailable'),
    })
  );
});
it('bounds Unicode and sanitization expansion while reserving the marker bytes', () => {
  const result = boundOutput('界'.repeat(MAX_DECODED_OUTPUT_BYTES));
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(MAX_DECODED_OUTPUT_BYTES);
  expect(result.text.endsWith('[output truncated]')).toBe(true);
  expect(result.text).not.toContain('\uFFFD');
});
