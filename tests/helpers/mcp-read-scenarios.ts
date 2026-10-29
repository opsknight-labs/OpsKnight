import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateApiKey } from '@/lib/api-keys';
import { MCP_OPERATION_MAP } from '@/lib/mcp/catalog';
import { digestMcpSecret, mcpResource } from '@/lib/mcp/auth/config';
import { CostBudget } from '@/lib/mcp/core/budget';
import { callMcpOperation, type ExecutionContext } from '@/lib/mcp/core/execution';
import { executeMcpPlan, planSchema } from '@/lib/mcp/core/plan';
import { MCP_HANDLERS } from '@/lib/mcp/operations/handlers';
import { createTestUser, resetDatabase, testPrisma as db } from './test-db';

type Role = 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER';
export interface ReadArgs {
  path?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  /** Only for reviewed side-effect-free POST reads. */
  body?: Record<string, unknown>;
}
export interface ReadScenario {
  name: string;
  operationId: string;
  /** Creates the target with `owner` (an administrator) and returns the read's arguments. */
  setup(owner: { id: string }): Promise<ReadArgs>;
}

const SENSITIVE_KEY =
  /(?:secret|password|token|credential|authorization|api.?key|signed.?url|email|phone|payload|rawOutput|stdout|stderr)|^(?:definition|config|inputValues|executionPlan|environment|env)$/i;

/** Every secret-like key in a projection must carry the redaction marker, at any depth. */
export function unredactedSensitiveKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value))
    return value.flatMap((item, index) => unredactedSensitiveKeys(item, `${path}/${index}`));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, child]) =>
      SENSITIVE_KEY.test(key) && child !== '[REDACTED]'
        ? [`${path}/${key}`]
        : unredactedSensitiveKeys(child, `${path}/${key}`)
    );
  return [];
}

export function setupMcpReadDatabase() {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Owned local test database required');
    process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
    process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await resetDatabase();
  }, 60000);
  beforeEach(async () => {
    const policy = {
      enabled: true,
      writesEnabled: false,
      sensitiveReadsEnabled: true,
      requestsPerMinute: 6000,
    };
    await db.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
  });
}

/** An MCP grant and a REST API key for the same user and the same scopes. */
export async function principal(role: Role, scopes: string[]) {
  const user = await createTestUser({ role });
  const client = await db.mcpClient.create({
    data: { name: 'Read certification', scopes, redirectUris: ['http://localhost/callback'] },
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
  const token = await db.mcpToken.create({
    data: {
      grantId: grant.id,
      scopes,
      accessHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
      accessExpiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 3600000),
    },
  });
  const issued = generateApiKey();
  await db.apiKey.create({
    data: {
      name: 'Read parity',
      userId: user.id,
      scopes,
      prefix: issued.prefix,
      tokenHash: issued.tokenHash,
    },
  });
  const ctx = (): ExecutionContext => ({
    grantId: grant.id,
    credentialId: token.id,
    tokenScopes: scopes,
    requestId: 'read-certification',
    budget: new CostBudget(),
  });
  return { user, grant, ctx, restToken: issued.token };
}

/** Calls the same native route handler over REST with an API key. */
async function restStatus(operationId: string, args: ReadArgs, token: string) {
  const operation = MCP_OPERATION_MAP.get(operationId)!;
  const handler = await MCP_HANDLERS.get(operationId)!();
  const values = new Map(Object.entries(args.path ?? {}));
  const path = operation.path.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(values.get(key) ?? '')
  );
  const url = new URL(`http://localhost/api/v2${path}`);
  for (const [key, value] of Object.entries(args.query ?? {}))
    url.searchParams.set(key, String(value));
  const response = await handler(
    new NextRequest(url, {
      method: operation.method.toUpperCase(),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: operation.method === 'get' ? undefined : JSON.stringify(args.body ?? {}),
    }),
    { params: Promise.resolve(args.path ?? {}) }
  );
  return response.status;
}

/** The standard certification every SENSITIVE_READ operation must pass. */
export function describeSensitiveReads(scenarios: ReadScenario[]) {
  describe.each(scenarios)('sensitive read $name ($operationId)', (scenario: ReadScenario) => {
    const scopes = () => MCP_OPERATION_MAP.get(scenario.operationId)!.requiredScopes;

    it('is a reviewed sensitive read', () => {
      const operation = MCP_OPERATION_MAP.get(scenario.operationId)!;
      expect(operation).toMatchObject({ status: 'SENSITIVE_READ', tool: null });
      if (operation.method !== 'get') {
        expect(operation).toMatchObject({ method: 'post', sideEffectFree: true });
        expect(operation.mutation).toMatchObject({ idempotency: 'natural', concurrency: 'none' });
        expect(operation.inputSchema.properties).not.toHaveProperty('idempotencyKey');
        expect(operation.inputSchema.properties).not.toHaveProperty('ifMatch');
      }
    });

    it('writes no audit entry, receipt or job when it is not a GET', async () => {
      if (MCP_OPERATION_MAP.get(scenario.operationId)!.method === 'get') return;
      const admin = await principal('ADMIN', scopes());
      const args = await scenario.setup(admin.user);
      const before = [await db.auditLog.count(), await db.backgroundJob.count()];
      await callMcpOperation(admin.ctx(), scenario.operationId, args);
      await callMcpOperation(admin.ctx(), scenario.operationId, args);
      expect([await db.auditLog.count(), await db.backgroundJob.count()]).toEqual(before);
    });

    it('returns a redacted, bounded projection to an authorized administrator', async () => {
      const admin = await principal('ADMIN', scopes());
      const args = await scenario.setup(admin.user);
      const result = await callMcpOperation(admin.ctx(), scenario.operationId, args);
      expect(result.data).toBeDefined();
      expect(unredactedSensitiveKeys(result.data)).toEqual([]);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(262144);
      expect(result.evidence).toMatchObject({ operationId: scenario.operationId });
    });

    it('is unavailable while the administrator opt-in is off', async () => {
      const admin = await principal('ADMIN', scopes());
      const args = await scenario.setup(admin.user);
      await db.mcpPolicy.update({
        where: { id: 'default' },
        data: { sensitiveReadsEnabled: false },
      });
      await expect(callMcpOperation(admin.ctx(), scenario.operationId, args)).rejects.toThrow(
        'MCP_OPERATION_DISABLED'
      );
    });

    it('is never more permissive than the native REST route', async () => {
      const owner = await createTestUser({ role: 'ADMIN' });
      const args = await scenario.setup(owner);
      for (const role of ['USER', 'AUDITOR', 'RESPONDER'] as const) {
        const caller = await principal(role, scopes());
        const rest = await restStatus(scenario.operationId, args, caller.restToken);
        const mcp = await callMcpOperation(caller.ctx(), scenario.operationId, args).then(
          () => 'allowed' as const,
          () => 'refused' as const
        );
        if (rest >= 400) expect(mcp, `${role}: REST ${rest}`).toBe('refused');
      }
    });

    it('stays out of declarative plans', async () => {
      const admin = await principal('ADMIN', scopes());
      const args = await scenario.setup(admin.user);
      await expect(
        executeMcpPlan(
          admin.ctx(),
          planSchema.parse({
            steps: [{ id: 'a', operationId: scenario.operationId, args }],
          })
        )
      ).rejects.toThrow('MCP_PLAN_READS_ONLY');
    });
  });
}
