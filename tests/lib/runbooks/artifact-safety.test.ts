import { describe, it, expect } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import { sanitizeCompressedArtifact } from '@/lib/runbooks/artifact-safety';
import { sanitizeOutputText } from '../../../agent/src/output-safety';

describe('sensitive output pipeline', () => {
  it('removes unrelated Docker environment credentials and Kubernetes data payloads', () => {
    const input = {
      Id: 'container-a',
      Config: { Env: ['DATABASE_PASSWORD=unrelated-secret', 'OPAQUE_VALUE=also-sensitive'] },
      data: { encoded: 'b3BhcXVl' },
      healthy: true,
    };
    const output = sanitizeOutputText(JSON.stringify(input));
    expect(JSON.parse(output)).toMatchObject({
      Id: 'container-a',
      Config: { Env: '[REDACTED]' },
      data: '[REDACTED]',
      healthy: true,
    });
    expect(output).not.toContain('unrelated-secret');
    expect(output).not.toContain('also-sensitive');
    expect(output).not.toContain('b3BhcXVl');
  });
  it('redacts quoted values, connection strings, truncated private keys and known inputs before spooling', () => {
    const output = sanitizeOutputText(
      'DB_PASSWORD="a value with spaces"\npostgresql://user:database-pass@db.internal/app\nAuthorization: Bearer bearer-credential\nknown-sensitive\n-----BEGIN RSA PRIVATE KEY-----\nprivate-key-body',
      ['known-sensitive']
    );
    for (const secret of [
      'a value with spaces',
      'database-pass',
      'bearer-credential',
      'known-sensitive',
      'private-key-body',
    ])
      expect(output).not.toContain(secret);
  });
  it('sanitizes a legacy gzip payload without truncating it to the preview limit', async () => {
    const result = await sanitizeCompressedArtifact(
      gzipSync(Buffer.from('healthy\n'.repeat(5000) + 'API_TOKEN=unrelated-token'))
    );
    const text = gunzipSync(result.content).toString();
    expect(text).not.toContain('unrelated-token');
    expect(text.length).toBeGreaterThan(32768);
    expect(result.truncated).toBe(false);
    expect((await sanitizeCompressedArtifact(result.content)).content).toEqual(result.content);
  });
  it('rejects invalid gzip, invalid UTF-8 and decompression bombs', async () => {
    await expect(sanitizeCompressedArtifact(Buffer.from('plain'))).rejects.toThrow('valid gzip');
    await expect(sanitizeCompressedArtifact(gzipSync(Buffer.from([0xff, 0xfe])))).rejects.toThrow(
      'UTF-8'
    );
    await expect(
      sanitizeCompressedArtifact(gzipSync(Buffer.alloc(10 * 1024 * 1024 + 1)))
    ).rejects.toThrow('10 MiB');
  });
  it('keeps truncated Unicode output valid for later downloads', async () => {
    const result = await sanitizeCompressedArtifact(gzipSync(Buffer.from('界'.repeat(500000))));
    await expect(sanitizeCompressedArtifact(result.content)).resolves.toBeDefined();
  });
  it('bounds retained output and records truncation', async () => {
    const result = await sanitizeCompressedArtifact(
      gzipSync(Buffer.from('x'.repeat(2 * 1024 * 1024)))
    );
    expect(result.truncated).toBe(true);
    expect(gunzipSync(result.content).length).toBeLessThan(1024 * 1024 + 100);
  });
});

it('bounds nested structured output before reaching stack exhaustion', () => {
  let nested: unknown = { Env: ['OPAQUE_VALUE=must-not-leak'] };
  for (let depth = 0; depth < 100; depth++) nested = { inner: nested };
  const text = sanitizeOutputText(JSON.stringify(nested));
  expect(text).not.toContain('must-not-leak');
  expect(text).toContain('REDACTED NESTED OUTPUT');
});

it('removes multiline quoted credentials and query-string tokens from legacy text', async () => {
  const legacy =
    'APP_PASSWORD="first sensitive line\nsecond sensitive line"\nhttps://app.test/path?access_token=query-credential&mode=read';
  const normalized = await sanitizeCompressedArtifact(gzipSync(Buffer.from(legacy)));
  const text = gunzipSync(normalized.content).toString();
  for (const secret of ['first sensitive line', 'second sensitive line', 'query-credential'])
    expect(text).not.toContain(secret);
  expect(text).toContain('[REDACTED]');
});
