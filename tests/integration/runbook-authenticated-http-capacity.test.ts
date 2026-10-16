// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { POST } from '@/app/api/runbook-agent/v1/claim/route';
import { agentSignaturePayload } from '@/lib/runbooks/agent-auth';
import { runtimeOperationalMetrics } from '@/lib/metrics/operational/registry';
import { testPrisma, resetDatabase } from '../helpers/test-db';
const suite =
  process.env.RUNBOOK_HTTP_CAPACITY === 'true' && process.env.VITEST_USE_REAL_DB === '1'
    ? describe
    : describe.skip;
const quantile = (values: number[], q: number) =>
  [...values]
    .sort((a, b) => a - b)
    .at(Math.min(values.length - 1, Math.floor(values.length * q))) ?? null;
suite('authenticated HTTP idle-fleet workload (not production throughput certification)', () => {
  it('measures 10/100/500/1000 simultaneous Agents across repeated actual 25-second long polls', async () => {
    const database = new URL(process.env.DATABASE_URL!).pathname;
    if (!['/rbe_enterprise_test', '/rbe_http_test'].includes(database))
      throw new Error('Dedicated disposable capacity database required.');
    await resetDatabase();
    const rounds = Number(process.env.RUNBOOK_HTTP_ROUNDS ?? 2);
    if (!Number.isInteger(rounds) || rounds < 2 || rounds > 30)
      throw new Error('RUNBOOK_HTTP_ROUNDS must be 2–30.');
    const samples: unknown[] = [];
    const server = createServer(async (incoming, outgoing) => {
      try {
        const parts: Buffer[] = [];
        for await (const part of incoming) parts.push(Buffer.from(part));
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers))
          if (typeof value === 'string') headers.set(key, value);
        const controller = new AbortController();
        outgoing.once('close', () => {
          if (!outgoing.writableEnded) controller.abort();
        });
        const response = await POST(
          new Request(`http://127.0.0.1${incoming.url}`, {
            method: 'POST',
            headers,
            body: Buffer.concat(parts).toString(),
            signal: controller.signal,
          })
        );
        outgoing.writeHead(response.status);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        outgoing.writeHead(500);
        outgoing.end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP fixture failed to listen');
    try {
      for (const count of [10, 100, 500, 1000]) {
        const agents = Array.from({ length: count }, () => ({
          id: `http-${randomUUID()}`,
          ...generateKeyPairSync('ed25519', {
            privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
            publicKeyEncoding: { format: 'pem', type: 'spki' },
          }),
        }));
        await testPrisma.runbookAgent.createMany({
          data: agents.map(agent => ({
            id: agent.id,
            name: agent.id,
            publicKey: agent.publicKey,
            status: 'ONLINE',
            lastHeartbeatAt: new Date(),
          })),
        });
        const durations: number[] = [],
          sentinels: number[] = [];
        const started = performance.now(),
          cpu = process.cpuUsage();
        const probes = () =>
          runtimeOperationalMetrics()
            .get('opsknight_runbook_claim_availability_probes_total')
            ?.reduce((sum, row) => sum + row.value, 0) ?? 0;
        const beforeProbes = probes();
        let sentinelBusy = false;
        let sentinelFailure: unknown;
        const timer = setInterval(() => {
          if (sentinelBusy) return;
          sentinelBusy = true;
          const before = performance.now();
          void testPrisma.incident
            .count()
            .then(() => sentinels.push(performance.now() - before))
            .catch(error => {
              sentinelFailure = error;
            })
            .finally(() => {
              sentinelBusy = false;
            });
        }, 1000);
        try {
          for (let round = 0; round < rounds; round++) {
            await Promise.all(
              agents.map(async agent => {
                const path = '/api/runbook-agent/v1/claim?waitSeconds=25&mode=READ_ONLY_ONLY';
                const timestamp = new Date().toISOString(),
                  nonce = randomUUID(),
                  body = '{}';
                const signature = sign(
                  null,
                  Buffer.from(
                    agentSignaturePayload({ method: 'POST', target: path, timestamp, nonce, body })
                  ),
                  agent.privateKey
                ).toString('base64');
                const before = performance.now();
                const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
                  method: 'POST',
                  body,
                  headers: {
                    'x-opsknight-agent-id': agent.id,
                    'x-opsknight-timestamp': timestamp,
                    'x-opsknight-nonce': nonce,
                    'x-opsknight-signature': signature,
                  },
                  signal: AbortSignal.timeout(90000),
                });
                expect(response.status).toBe(204);
                await response.arrayBuffer();
                durations.push(performance.now() - before);
              })
            );
          }
          expect(sentinelFailure).toBeUndefined();
          const connections = await testPrisma.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()`;
          const artifacts = await testPrisma.runbookArtifact.aggregate({
            _sum: { sizeBytes: true },
          });
          samples.push({
            agents: count,
            simultaneousLongPolls: count,
            rounds,
            waitSeconds: 25,
            elapsedMs: performance.now() - started,
            httpP50Ms: quantile(durations, 0.5),
            httpP95Ms: quantile(durations, 0.95),
            httpP99Ms: quantile(durations, 0.99),
            coalescedAvailabilityQueries: probes() - beforeProbes,
            incidentReadP95Ms: quantile(sentinels, 0.95),
            databaseConnections: Number(connections[0].count),
            artifactBytes: artifacts._sum.sizeBytes ?? 0,
            cpuMicroseconds: process.cpuUsage(cpu),
            memoryBytes: process.memoryUsage(),
          });
        } finally {
          clearInterval(timer);
          while (sentinelBusy) await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      await mkdir('plans/runbook-engine/evidence', { recursive: true });
      await writeFile(
        'plans/runbook-engine/evidence/authenticated-http-current.json',
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            sourceRevision: process.env.GITHUB_SHA ?? null,
            samples,
            limitations: [
              'Loopback HTTP route adapter with real signatures, nonce persistence and PostgreSQL; not the production Next/TLS/proxy topology',
              'Idle claims; no physical actions, active dispatch latency or recovery-load measurement',
              `${rounds} 25-second rounds per size; idle regression measurement, not active production capacity`,
              'Load generator and handler share a process; CPU/memory include both',
              'Incident reads share the database; other notification/escalation workloads are not certified',
            ],
          },
          null,
          2
        )
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 3300000);
});
