import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { it } from 'vitest';

// Runs only as a child of scripts/mcp/mixed-load.cjs: MCP reads in their own OS process and pool.
const child = process.env.MCP_LOAD_CHILD === '1';

it.skipIf(!child)(
  'mixed-load child: sustains concurrent MCP reads until told to stop',
  async () => {
    process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
    const { testPrisma: prisma } = await import('../helpers/test-db');
    const { digestMcpSecret, loadMcpRuntime, mcpResource } = await import('@/lib/mcp/auth/config');
    // Uses the database-managed origin and credential secret; no MCP environment is required.
    await loadMcpRuntime();
    const { CostBudget } = await import('@/lib/mcp/core/budget');
    const { callMcpOperation } = await import('@/lib/mcp/core/execution');
    const concurrency = Number(process.env.MCP_LOAD_CONCURRENCY);
    const scopes = ['incidents:read', 'services:read'];
    await prisma.mcpPolicy.upsert({
      where: { id: 'default' },
      create: { enabled: true, requestsPerMinute: 600 },
      update: { enabled: true },
    });
    const user = await prisma.user.create({
      data: {
        email: `mcp-load-${randomBytes(6).toString('hex')}@example.test`,
        name: 'MCP load',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    const client = await prisma.mcpClient.create({
      data: { name: 'Mixed load', scopes, redirectUris: ['http://localhost/callback'] },
    });
    // Real concurrency comes from many principals, each under its own quotas.
    const grants: { grantId: string; credentialId: string }[] = [];
    for (let i = 0; i < concurrency; i++) {
      const grant = await prisma.mcpGrant.create({
        data: {
          clientId: client.id,
          userId: user.id,
          userTokenVersion: user.tokenVersion,
          scopes,
          resource: mcpResource(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const token = await prisma.mcpToken.create({
        data: {
          grantId: grant.id,
          scopes,
          accessHash: digestMcpSecret(randomBytes(32).toString('base64url')),
          refreshHash: digestMcpSecret(randomBytes(32).toString('base64url')),
          accessExpiresAt: new Date(Date.now() + 3600000),
          refreshExpiresAt: new Date(Date.now() + 3600000),
        },
      });
      grants.push({ grantId: grant.id, credentialId: token.id });
    }
    const service = await prisma.service.create({
      data: { name: `MCP load ${randomBytes(4).toString('hex')}` },
    });
    const incidents: string[] = [];
    for (let i = 0; i < 20; i++)
      incidents.push(
        (
          await prisma.incident.create({
            data: { title: `Load ${i}`, serviceId: service.id, status: 'OPEN', urgency: 'HIGH' },
          })
        ).id
      );
    const samples: number[] = [];
    const outcomes = new Map<string, number>();
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- orchestrator-owned temporary file
    writeFileSync(process.env.MCP_LOAD_READY_FILE!, 'ready');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- orchestrator-owned temporary file
    const stop = () => existsSync(process.env.MCP_LOAD_STOP_FILE!);
    await Promise.all(
      grants.map(async (grant, worker) => {
        let i = worker;
        while (!stop()) {
          const id = incidents[i++ % incidents.length];
          const context = {
            ...grant,
            tokenScopes: scopes,
            requestId: 'mixed-load',
            budget: new CostBudget(8, 262144, undefined, 10000),
          };
          const started = performance.now();
          let outcome = 'served';
          try {
            // Ordinary investigation reads: one incident and a bounded incident list.
            await callMcpOperation(context, 'getIncident', { path: { id } });
            await callMcpOperation(context, 'listIncidents', { query: { limit: 5 } });
          } catch (error) {
            const e = error as { code?: string; status?: number; message?: string };
            outcome = e.code ? `${e.code}:${e.status}` : String(e.message).slice(0, 80);
          }
          samples.push(performance.now() - started);
          outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
        }
      })
    );
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (p: number) =>
      sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- orchestrator-owned temporary file
    writeFileSync(
      process.env.MCP_LOAD_RESULT_FILE!,
      JSON.stringify({
        concurrency,
        requests: samples.length,
        latencyMs: { p50: at(0.5), p95: at(0.95), p99: at(0.99) },
        outcomes: Object.fromEntries(outcomes),
      })
    );
  },
  900_000
);
