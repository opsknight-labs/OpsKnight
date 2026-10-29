import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import prisma, { disconnectPrisma } from '@/lib/prisma';
import { withMcpDatabase } from '@/lib/database-workload';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { POST } from '@/app/mcp/route';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

// Opt-in artifacts contain aggregate counters only: never SQL, parameters,
// business text, actor/resource IDs, token hashes or bearer credentials.
type Sample = {
  statements: number;
  reads: number;
  writes: number;
  transactionStatements: number;
  authenticationReads: number;
  policyReads: number;
  quotaWrites: number;
  domainReads: number;
  sqlDurationMs: number;
  wallDurationMs: number;
};
const profiles: {
  scenario: string;
  requests: number;
  chargedOperations: number;
  sample: Sample;
}[] = [];
const statementBudgets = new Map([
  ['tools/list', 4],
  ['incident_search', 10],
  ['incident_get_context', 24],
  ['execute_plan:3', 24],
  ['incident_search:4-concurrent-same-grant', 40],
]);
let collecting: Sample | undefined;
let accessToken: string;
let incidentId: string;
let grantId: string;
const tables = (sql: string, names: readonly string[]) =>
  names.some(name => sql.includes(`"${name}"`));
function observe(event: Prisma.QueryEvent) {
  if (!collecting) return;
  const sql = event.query;
  collecting.statements++;
  collecting.sqlDurationMs += event.duration;
  const read = /^\s*(SELECT|WITH)\b/i.test(sql);
  const write = /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql);
  if (read) collecting.reads++;
  if (write) collecting.writes++;
  if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET)\b/i.test(sql)) collecting.transactionStatements++;
  if (read && tables(sql, ['McpToken', 'McpGrant', 'McpClient', 'User', 'TeamMember']))
    collecting.authenticationReads++;
  else if (read && tables(sql, ['McpPolicy'])) collecting.policyReads++;
  else if (read) collecting.domainReads++;
  if (write && tables(sql, ['RateLimit'])) collecting.quotaWrites++;
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local PostgreSQL test database required');
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.MCP_DATABASE_POOL_SIZE = '2';
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  await resetDatabase();
  await db.mcpPolicy.create({
    data: { enabled: true, writesEnabled: false, requestsPerMinute: 600 },
  });
  const user = await createTestUser({ role: 'ADMIN' });
  const scopes = ['incidents:read'];
  const client = await db.mcpClient.create({
    data: { name: 'Local query profile', redirectUris: ['http://localhost/callback'], scopes },
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
  grantId = grant.id;
  accessToken = randomBytes(32).toString('base64url');
  await db.mcpToken.create({
    data: {
      grantId,
      scopes,
      accessHash: digestMcpSecret(accessToken),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  const service = await createTestService('Query profile');
  incidentId = (await createTestIncident('Local query profile incident', service.id)).id;
  // Initialize before attaching listeners. Prisma emits query events outside
  // async request context; this serial suite brackets the owned MCP pool itself.
  await withMcpDatabase(() => prisma.$connect());
  globalThis.prismaMcpGlobal!.$on('query', observe);
  // Warm module imports and protocol schemas separately from measured requests.
  await rpc('tools/list');
  await tool('incident_search', { query: { limit: 5 } });
  await tool('incident_get_context', { id: incidentId });
  await new Promise(resolve => setTimeout(resolve, 25));
}, 60000);

afterAll(async () => {
  collecting = undefined;
  await disconnectPrisma();
  await db.$disconnect();
  const output = process.env.MCP_QUERY_PROFILE_OUTPUT;
  if (!output) return;
  const target = resolve(output);
  if (!isAbsolute(output) || !relative(process.cwd(), target).startsWith(`..${sep}`))
    throw new Error('Query profile output must be an absolute path outside the repository');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- explicit local test artifact, validated outside repository; never an HTTP input
  writeFileSync(
    target,
    JSON.stringify(
      {
        schemaVersion: 1,
        certified: false,
        sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        workingTreeDirty: Boolean(
          execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
        ),
        measuredAt: new Date().toISOString(),
        fixture: 'one local incident; direct PostgreSQL; two MCP connections; warm process',
        limitations: [
          'Not a mixed ingestion/paging workload or capacity certification.',
          'SQL duration sums engine query events; it is not an independent pool-wait measurement.',
          'Parallel requests share a grant; counters are aggregate, without per-request attribution.',
          'Prisma may batch identical concurrent ORM reads; concurrent counts are not serial per-request costs.',
        ],
        profiles,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
});

async function rpc(method: string, params: Record<string, unknown> = {}) {
  return POST(
    new Request(mcpResource(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': {
              name: 'owned-local-query-profile',
              version: '1',
            },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })
  );
}
async function measured(
  scenario: string,
  requests: number,
  chargedOperations: number,
  action: () => Promise<void>,
  protectedQuotaWrites = 0
) {
  const sample: Sample = {
    statements: 0,
    reads: 0,
    writes: 0,
    transactionStatements: 0,
    authenticationReads: 0,
    policyReads: 0,
    quotaWrites: 0,
    domainReads: 0,
    sqlDurationMs: 0,
    wallDurationMs: 0,
  };
  const started = performance.now();
  collecting = sample;
  try {
    await action();
  } finally {
    sample.wallDurationMs = Number((performance.now() - started).toFixed(2));
    // Prisma query events arrive from the engine asynchronously. Drain their
    // delivery after all awaited request work before switching sample buckets.
    await new Promise(resolve => setTimeout(resolve, 25));
    collecting = undefined;
    profiles.push({ scenario, requests, chargedOperations, sample });
  }
  expect(sample.statements).toBeGreaterThan(0);
  expect(sample.statements).toBeLessThanOrEqual(statementBudgets.get(scenario)!);
  expect(sample.authenticationReads).toBeLessThanOrEqual(requests * 2 + chargedOperations);
  expect(sample.quotaWrites).toBe(requests + protectedQuotaWrites);
  // Read-only investigations must not introduce any other write-side effects.
  expect(sample.writes).toBe(sample.quotaWrites);
  return sample;
}
async function tool(name: string, args: Record<string, unknown>) {
  const response = await rpc('tools/call', { name, arguments: args });
  expect(response.status).toBe(200);
  const result = (await response.json()).result;
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  return result;
}

describe('MCP investigation database amplification', () => {
  it('profiles discovery, a single read and joined context through the real route', async () => {
    await measured('tools/list', 1, 1, async () => {
      expect((await rpc('tools/list')).status).toBe(200);
    });
    await measured('incident_search', 1, 1, async () => {
      await tool('incident_search', { query: { limit: 5 } });
    });
    await measured(
      'incident_get_context',
      1,
      3,
      async () => {
        await tool('incident_get_context', { id: incidentId });
      },
      1
    );
  });

  it('charges a bounded three-step investigation once at admission', async () => {
    const before = await db.rateLimit.aggregate({
      where: { key: { startsWith: `mcp:${grantId}:` } },
      _sum: { count: true },
    });
    await measured(
      'execute_plan:3',
      1,
      3,
      async () => {
        const result = await tool('execute_plan', {
          steps: [
            {
              id: 'incident',
              operationId: 'getIncident',
              args: { path: { id: incidentId } },
              dependsOn: [],
            },
            {
              id: 'timeline',
              operationId: 'getIncidentTimeline',
              args: { path: { id: incidentId }, query: { limit: 5 } },
              dependsOn: ['incident'],
            },
            {
              id: 'related',
              operationId: 'listRelatedIncidents',
              args: { path: { id: incidentId } },
              dependsOn: ['incident'],
            },
          ],
        });
        expect(
          result.structuredContent.steps.map((step: { status: string }) => step.status)
        ).toEqual(['completed', 'completed', 'completed']);
      },
      1
    );
    const after = await db.rateLimit.aggregate({
      where: { key: { startsWith: `mcp:${grantId}:` } },
      _sum: { count: true },
    });
    expect(after._sum.count! - before._sum.count!).toBe(3);
  });

  it('measures shared-grant quota contention without dropping admitted accounting', async () => {
    await measured('incident_search:4-concurrent-same-grant', 4, 4, async () => {
      await Promise.all(
        Array.from({ length: 4 }, () => tool('incident_search', { query: { limit: 5 } }))
      );
    });
  });
});
