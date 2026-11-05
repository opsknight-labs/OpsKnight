// @vitest-environment node
import { randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { logger } from '@/lib/logger';
import { POST } from '@/app/mcp/route';

/**
 * CERT-08: JSON-RPC fuzzing of the real route with a real (test-minted) grant. Whatever arrives,
 * the route answers with a bounded status and a well-formed error, never a 5xx, a stack trace or
 * an unexpected-error log. Seeded and capped so CI is deterministic.
 */
// No 401: the bearer is always valid, so a 401 would mean input confused authentication.
const ALLOWED_STATUS = new Set([200, 202, 400, 403, 404, 405, 406, 408, 413, 415, 422, 429]);
const KNOWN_METHODS = [
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
  'completion/complete',
  'tasks/get',
  'tasks/cancel',
  'notifications/initialized',
  'logging/setLevel',
];
const VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '1999-01-01', ''];

/** Mostly well-formed input, so most runs reach JSON-RPC handling rather than the door. */
const mostly = <T>(good: fc.Arbitrary<T>, other: fc.Arbitrary<T>) =>
  fc.oneof({ arbitrary: good, weight: 5 }, { arbitrary: other, weight: 1 });

let bearer = '';
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  await resetDatabase();
  const policy = {
    enabled: true,
    writesEnabled: false,
    requestsPerMinute: 100000,
    maxOperations: 8,
  };
  await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
  const scopes = ['incidents:read', 'services:read'];
  const user = await createTestUser({ role: 'RESPONDER' });
  const client = await db.mcpClient.create({
    data: { name: 'Fuzz', scopes, redirectUris: ['http://localhost/callback'] },
  });
  const grant = await db.mcpGrant.create({
    data: {
      clientId: client.id,
      userId: user.id,
      userTokenVersion: user.tokenVersion,
      scopes,
      resource: mcpResource(),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  bearer = randomBytes(32).toString('base64url');
  await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(bearer),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
}, 60000);

const id = fc.oneof(
  fc.integer(),
  fc.double(),
  fc.constant(Number.MAX_SAFE_INTEGER),
  fc.constant(-1),
  fc.constant(null),
  fc.string({ maxLength: 40 }),
  fc.dictionary(fc.string({ maxLength: 4 }), fc.jsonValue({ maxDepth: 1 }), { maxKeys: 2 })
);
const method = fc.oneof(
  fc.constantFrom(...KNOWN_METHODS),
  fc.string({ maxLength: 60 }),
  fc.constant('x'.repeat(5000))
);
const params = mostly(
  fc.oneof(
    fc.constant({}),
    fc.record({
      name: fc.constantFrom('whoami', 'incident_search', 'nope'),
      arguments: fc.oneof(fc.constant({}), fc.jsonValue({ maxDepth: 3 })),
    })
  ),
  fc.jsonValue({ maxDepth: 3 })
);
const envelope = fc
  .tuple(
    fc.record(
      {
        jsonrpc: mostly(
          fc.constant('2.0'),
          fc.oneof(fc.constant('1.0'), fc.jsonValue({ maxDepth: 0 }))
        ),
        id: mostly(fc.integer({ min: 1, max: 1000 }), id),
        method: mostly(fc.constantFrom(...KNOWN_METHODS), method),
        params,
      },
      { requiredKeys: ['jsonrpc', 'method'] }
    ),
    // Now and then an unexpected member.
    fc.option(fc.jsonValue({ maxDepth: 1 }), { freq: 5 })
  )
  .map(([message, extra]) => (extra === null ? message : { ...message, extra }));
/** Bodies a JSON encoder would never produce: batches, deep nesting, duplicate keys, bad UTF-16. */
const rawBody = fc.oneof(
  { arbitrary: envelope.map(value => JSON.stringify(value)), weight: 8 },
  fc.array(envelope, { maxLength: 4 }).map(value => JSON.stringify(value)),
  fc.integer({ min: 1, max: 4000 }).map(depth => `${'['.repeat(depth)}${']'.repeat(depth)}`),
  fc.constant('{"jsonrpc":"2.0","id":1,"id":2,"method":"ping","method":"tools/list"}'),
  fc.constant('{"jsonrpc":"2.0","id":1,"method":"\uD800ping"}'),
  fc.constant('{"jsonrpc":"2.0","id":1e400,"method":"ping"}'),
  fc.string({ maxLength: 200 }),
  fc.constant('')
);
const contentType = mostly(
  fc.constant('application/json'),
  fc.constantFrom(
    'application/json',
    'application/json; charset=utf-8',
    'text/plain',
    'application/x-www-form-urlencoded',
    ''
  )
);
const accept = mostly(
  fc.constant('application/json, text/event-stream'),
  fc.constantFrom(
    'application/json, text/event-stream',
    'application/json',
    'text/event-stream',
    '*/*',
    ''
  )
);

/** Reads at most a few frames: an accepted stream must not hold the run open. */
async function readBounded(response: Response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), deadline - Date.now())),
    ]);
    if (!chunk || chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

function messages(text: string, streamed: boolean) {
  if (!streamed) return text ? [JSON.parse(text) as Record<string, unknown>] : [];
  return text
    .split('\n')
    .filter(line => line.startsWith('data:') && line.slice(5).trim())
    .map(line => JSON.parse(line.slice(5)) as Record<string, unknown>);
}

describe('JSON-RPC fuzz against the real route', () => {
  it('answers every input with a bounded status and a well-formed error', async () => {
    const unexpected = vi.spyOn(logger, 'error');
    const statuses = new Map<number, number>();
    await fc.assert(
      fc.asyncProperty(
        rawBody,
        contentType,
        accept,
        mostly(fc.constantFrom('2025-06-18', '2025-11-25'), fc.constantFrom(...VERSIONS)),
        async (body, type, acceptHeader, version) => {
          const headers: Record<string, string> = { authorization: `Bearer ${bearer}` };
          if (type) headers['content-type'] = type;
          if (acceptHeader) headers.accept = acceptHeader;
          if (version) headers['mcp-protocol-version'] = version;
          const response = await POST(
            new Request(mcpResource(), { method: 'POST', headers, body })
          );
          expect(ALLOWED_STATUS, `${response.status} for ${body.slice(0, 200)}`).toContain(
            response.status
          );
          statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
          const streamed = (response.headers.get('content-type') ?? '').includes(
            'text/event-stream'
          );
          const text = await readBounded(response);
          expect(text).not.toMatch(/node_modules|\/src\/|\.tsx?:\d+|\n\s+at /);
          if (response.status === 202) return;
          for (const message of messages(text, streamed)) {
            if (typeof message.error === 'string') {
              // OAuth/transport style: a stable machine code.
              expect(message.error).toMatch(/^[A-Za-z0-9_]+$/);
            } else if (message.error) {
              const code = (message.error as { code?: unknown }).code;
              expect(Number.isInteger(code), JSON.stringify(message)).toBe(true);
              expect(code as number).toBeGreaterThanOrEqual(-32768);
              expect(code as number).toBeLessThanOrEqual(-32000);
            } else expect(message).toHaveProperty('jsonrpc', '2.0');
          }
        }
      ),
      { seed: 960, numRuns: 400, endOnFailure: true }
    );
    expect(
      unexpected.mock.calls.filter(([event]) => event === 'mcp.request.unexpected_error')
    ).toEqual([]);
    unexpected.mockRestore();
    // The run reached real handling (not just rejection at the door), and real rejections.
    expect(statuses.get(200) ?? 0).toBeGreaterThan(20);
    expect(statuses.get(400) ?? 0).toBeGreaterThan(20);
  }, 180000);
});
