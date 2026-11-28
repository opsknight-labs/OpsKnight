import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

import { CLIENT_LOG_BUFFER_MAX, getLogBuffer, logger } from '@/lib/logger';
import { POST } from '@/app/api/logs/ingest/route';

const postClientLog = (message: string) =>
  POST(
    new NextRequest('http://localhost/api/logs/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'error', message, context: { route: '/x' } }),
    })
  );

describe('client log entries have their own bounded buffer', () => {
  beforeEach(() => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation(() => {});
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps the client ring small', () => {
    expect(CLIENT_LOG_BUFFER_MAX).toBeGreaterThan(0);
    expect(CLIENT_LOG_BUFFER_MAX).toBeLessThanOrEqual(100);
  });

  it('never lets a flood of ingested client entries evict a server entry', async () => {
    const tag = `server-${Date.now()}`;
    // Fill the server ring completely, so any eviction by the client flood would be visible.
    for (let i = 0; i < 500; i += 1) logger.info(`${tag}-${i}`);

    for (let i = 0; i < 1000; i += 1) await postClientLog(`forged-${tag}-${i}`);

    const entries = getLogBuffer(500);
    const server = entries.filter(entry => entry.message.startsWith(tag));
    const client = entries.filter(entry => entry.message.startsWith(`forged-${tag}`));
    expect(server.map(entry => entry.message)).toEqual(
      Array.from({ length: 500 }, (_, i) => `${tag}-${i}`)
    );
    // Only the newest client entries survive, up to the ring size.
    expect(client).toHaveLength(CLIENT_LOG_BUFFER_MAX);
    expect(client.at(-1)?.message).toBe(`forged-${tag}-999`);
    expect(client.every(entry => entry.context?.source === 'client')).toBe(true);
  });

  it('counts only server entries against the requested limit', async () => {
    const tag = `limit-${Date.now()}`;
    logger.info(`${tag}-a`);
    logger.info(`${tag}-b`);
    await postClientLog(`forged-${tag}`);

    const entries = getLogBuffer(2);
    const messages = entries.map(entry => entry.message);
    expect(messages).toContain(`${tag}-a`);
    expect(messages).toContain(`${tag}-b`);
    expect(messages).toContain(`forged-${tag}`);
    expect([...entries].map(entry => entry.timestamp)).toEqual(
      [...entries].map(entry => entry.timestamp).sort()
    );
  });
});
