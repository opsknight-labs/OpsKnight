// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:https';
import { request as forward } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentEnrollment } from '@/lib/runbooks/agent-auth';
import { computeDefinitionChecksum, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { previewRunbookExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';
import { requestRulePolicyChecks } from '@/lib/runbooks/policy-checks';
import { evaluateIncidentTriggers } from '@/lib/runbooks/triggers';
import { getRunbookWorkerEvidence } from '@/lib/runbooks/worker-heartbeats';
import { testPrisma, createTestService, createTestUser, resetDatabase } from '../helpers/test-db';

const command = promisify(execFile);
const suite =
  process.env.RUNBOOK_LIVE_DEPLOYMENT === 'true' && process.env.VITEST_USE_REAL_DB === '1'
    ? describe
    : describe.skip;
async function until(check: () => Promise<boolean>, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Live deployment did not reach the expected state.');
}
async function stopProcess(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    await stopped;
  } finally {
    clearTimeout(timer);
  }
}
suite('isolated HTTPS Compose deployment against the real control plane', () => {
  it('enrolls through a token file, executes a signed diagnostic with an artifact, checks policy and preserves identity after restart', async () => {
    if (new URL(process.env.DATABASE_URL!).pathname !== '/rbe_engine_test')
      throw new Error('Dedicated live deployment database required.');
    await resetDatabase();
    const directory = await mkdtemp(join(tmpdir(), 'rbe-live-'));
    const project = `rbe-cert-${crypto.randomUUID().slice(0, 8)}`;
    const appPort = 3216;
    let app: ChildProcess | undefined;
    let worker: ChildProcess | undefined;
    let appOutput = '';
    await command('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      join(directory, 'tls.key'),
      '-out',
      join(directory, 'tls.crt'),
      '-subj',
      '/CN=host.docker.internal',
      '-addext',
      'subjectAltName=DNS:host.docker.internal,IP:172.17.0.1',
    ]);
    const proxy = createServer(
      {
        key: await readFile(join(directory, 'tls.key')),
        cert: await readFile(join(directory, 'tls.crt')),
      },
      (incoming, outgoing) => {
        const request = forward(
          {
            hostname: '127.0.0.1',
            port: appPort,
            path: incoming.url,
            method: incoming.method,
            headers: incoming.headers,
          },
          response => {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
          }
        );
        request.on('error', () => {
          outgoing.writeHead(503);
          outgoing.end();
        });
        incoming.pipe(request);
      }
    );
    proxy.listen(0, '0.0.0.0');
    await once(proxy, 'listening');
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('TLS proxy failed to bind.');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'production',
      OPSKNIGHT_PROCESS_ROLE: 'web',
      NEXTAUTH_SECRET: 'rbe-live-independent-session-secret',
      API_KEY_SECRET: 'rbe-live-independent-api-signing-secret',
      APP_HOST_ALIASES: 'host.docker.internal',
      NEXTAUTH_URL: `http://127.0.0.1:${appPort}`,
      NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${appPort}`,
      TRUST_PROXY_HEADERS: 'false',
      NEXTAUTH_COOKIE_SECURE: 'false',
    };
    const composeFiles = [
      '-p',
      project,
      '-f',
      'deploy/compose/docker-compose.agent.yml',
      '-f',
      'deploy/compose/docker-compose.agent.enrollment-file.yml',
      '-f',
      join(directory, 'override.json'),
    ];
    let composeEnv: NodeJS.ProcessEnv = { ...process.env };
    async function compose(args: string[]) {
      return command('docker', ['compose', ...composeFiles, ...args], {
        env: composeEnv,
        timeout: 60_000,
      });
    }
    try {
      app = spawn(
        process.execPath,
        [
          'node_modules/next/dist/bin/next',
          'start',
          '--hostname',
          '127.0.0.1',
          '--port',
          String(appPort),
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      app.stdout?.on('data', data => {
        appOutput = (appOutput + data).slice(-50_000);
      });
      app.stderr?.on('data', data => {
        appOutput = (appOutput + data).slice(-50_000);
      });
      await until(async () =>
        fetch(`http://127.0.0.1:${appPort}/api/runbook-agent/v1/time`)
          .then(response => response.ok)
          .catch(() => false)
      );
      worker = spawn(
        process.execPath,
        ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3217'],
        {
          env: { ...env, OPSKNIGHT_PROCESS_ROLE: 'runbook-worker' },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      worker.stdout?.on('data', data => {
        appOutput = (appOutput + data).slice(-50_000);
      });
      worker.stderr?.on('data', data => {
        appOutput = (appOutput + data).slice(-50_000);
      });
      await until(async () => (await getRunbookWorkerEvidence(new Date())).status === 'HEALTHY');
      const actor = await createTestUser();
      const service = await createTestService('Live diagnostics');
      const enrollment = await createAgentEnrollment({ name: project, actorId: actor.id });
      await writeFile(join(directory, 'token'), enrollment.token, { mode: 0o644 });
      const policy = JSON.parse(await readFile('agent/policy.container.json', 'utf8'));
      await writeFile(
        join(directory, 'policy.json'),
        JSON.stringify({ ...policy, linuxDiagnostics: ['summary', 'processes'] })
      );
      await writeFile(
        join(directory, 'override.json'),
        JSON.stringify({
          services: {
            'opsknight-agent': {
              extra_hosts: ['host.docker.internal:host-gateway'],
              environment: { NODE_EXTRA_CA_CERTS: '/etc/rbe/tls.crt' },
              volumes: [`${join(directory, 'tls.crt')}:/etc/rbe/tls.crt:ro`],
              healthcheck: { interval: '1s', timeout: '5s', start_period: '5s', retries: 3 },
            },
          },
        })
      );
      composeEnv = {
        ...process.env,
        OPSKNIGHT_AGENT_IMAGE:
          process.env.OPSKNIGHT_LIVE_AGENT_IMAGE ?? 'opsknight-agent:rbe-local',
        OPSKNIGHT_PULL_POLICY: 'never',
        OPSKNIGHT_AGENT_URL: `https://host.docker.internal:${address.port}`,
        OPSKNIGHT_EXECUTION_PUBLIC_KEY: enrollment.executionPublicKey,
        OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_PATH: join(directory, 'token'),
        OPSKNIGHT_AGENT_POLICY_PATH: join(directory, 'policy.json'),
      };
      await compose(['up', '-d', 'opsknight-agent']);
      await until(
        async () =>
          (await testPrisma.runbookAgent.findUniqueOrThrow({ where: { id: enrollment.agent.id } }))
            .status === 'ONLINE'
      );
      await until(async () =>
        compose([
          'exec',
          '-T',
          'opsknight-agent',
          'node',
          '/usr/local/bin/opsknight-agent-healthcheck.mjs',
          'readiness',
        ])
          .then(() => true)
          .catch(() => false)
      );
      // A harmless process inside this disposable Agent produces enough read-only
      // `ps` output to exercise the real bounded artifact upload path (>32 KiB).
      await compose([
        'exec',
        '-d',
        'opsknight-agent',
        'node',
        '-e',
        'setInterval(() => {}, 1000)',
        'artifact-fixture-'.repeat(3000),
      ]);
      const definition = parseRunbookDefinition({
        steps: [
          {
            key: 'diagnose',
            name: 'Read-only diagnostics',
            type: 'LINUX_DIAGNOSTICS',
            riskClass: 'READ_ONLY',
            config: { diagnostic: 'processes' },
          },
        ],
      });
      const runbook = await testPrisma.runbook.create({
        data: { name: 'Live diagnostic workflow', slug: project },
      });
      const version = await testPrisma.runbookVersion.create({
        data: {
          runbookId: runbook.id,
          version: 1,
          state: 'PUBLISHED',
          checksum: computeDefinitionChecksum(definition),
          definition: definition as unknown as Prisma.InputJsonValue,
        },
      });
      await testPrisma.runbook.update({
        where: { id: runbook.id },
        data: { publishedVersionId: version.id },
      });
      const rule = await testPrisma.serviceAutomationRule.create({
        data: {
          runbookId: runbook.id,
          serviceId: service.id,
          defaultAgentId: enrollment.agent.id,
          runbookVersionId: version.id,
          versionStrategy: 'PINNED',
        },
      });
      const request = {
        runbookId: runbook.id,
        bindingId: rule.id,
        serviceId: service.id,
        triggeredByUserId: actor.id,
      };
      // Enrollment may briefly precede the first readiness-reporting heartbeat.
      // Require both local progress and the current authoritative fleet state.
      await until(
        async () =>
          (await testPrisma.runbookAgent.findUniqueOrThrow({ where: { id: enrollment.agent.id } }))
            .status === 'ONLINE'
      );
      const preview = await previewRunbookExecution(request);
      const execution = await startRunbookExecution({
        ...request,
        expectedPlanDigest: preview.digest,
        previewAuthorizationToken: preview.authorizationToken,
      });
      await until(async () => {
        const current = await testPrisma.runbookExecution.findUniqueOrThrow({
          where: { id: execution.id },
          select: { status: true, failureCode: true },
        });
        if (['FAILED', 'TIMED_OUT', 'CANCELLED'].includes(current.status))
          throw new Error(
            `Live diagnostic ${current.status}: ${current.failureCode ?? 'unspecified'}`
          );
        return current.status === 'SUCCEEDED';
      });
      const artifacts = await testPrisma.runbookArtifact.count({
        where: { attempt: { executionStep: { executionId: execution.id } } },
      });
      expect(artifacts).toBeGreaterThan(0);
      await testPrisma.runbookTrigger.create({
        data: {
          bindingId: rule.id,
          event: 'INCIDENT_CREATED',
          conditions: { create: { field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH' } },
        },
      });
      const manualIncident = await testPrisma.incident.create({
        data: { serviceId: service.id, title: 'Manual remains unarmed', urgency: 'HIGH' },
      });
      expect(await evaluateIncidentTriggers(manualIncident.id, 'live-manual')).toMatchObject({
        matched: 0,
        started: 0,
        suggested: 0,
      });
      await testPrisma.serviceAutomationRule.update({
        where: { id: rule.id },
        data: { mode: 'SUGGESTED' },
      });
      const suggestedIncident = await testPrisma.incident.create({
        data: { serviceId: service.id, title: 'Suggested diagnostic', urgency: 'HIGH' },
      });
      expect(await evaluateIncidentTriggers(suggestedIncident.id, 'live-suggested')).toMatchObject({
        started: 0,
        suggested: 1,
      });
      expect(
        await testPrisma.runbookExecution.count({ where: { incidentId: suggestedIncident.id } })
      ).toBe(0);
      await testPrisma.serviceAutomationRule.update({
        where: { id: rule.id },
        data: { mode: 'AUTOMATIC' },
      });
      const ignoredIncident = await testPrisma.incident.create({
        data: { serviceId: service.id, title: 'Nonmatching diagnostic', urgency: 'LOW' },
      });
      expect(await evaluateIncidentTriggers(ignoredIncident.id, 'live-ignored')).toMatchObject({
        matched: 0,
        started: 0,
      });
      await until(
        async () =>
          (await testPrisma.runbookAgent.findUniqueOrThrow({ where: { id: enrollment.agent.id } }))
            .status === 'ONLINE'
      );
      const automaticIncident = await testPrisma.incident.create({
        data: { serviceId: service.id, title: 'Automatic read-only diagnostic', urgency: 'HIGH' },
      });
      expect(await evaluateIncidentTriggers(automaticIncident.id, 'live-automatic')).toMatchObject({
        started: 1,
      });
      await evaluateIncidentTriggers(automaticIncident.id, 'live-automatic');
      const automatic = await testPrisma.runbookExecution.findFirstOrThrow({
        where: { incidentId: automaticIncident.id },
      });
      expect(
        await testPrisma.runbookExecution.count({ where: { incidentId: automaticIncident.id } })
      ).toBe(1);
      await until(
        async () =>
          (await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: automatic.id } }))
            .status === 'SUCCEEDED'
      );
      await requestRulePolicyChecks(service.id, rule.id, actor.id);
      await until(
        async () =>
          (await testPrisma.runbookPolicyCheck.findFirstOrThrow({ where: { ruleId: rule.id } }))
            .status === 'PASSED'
      );
      const identityBefore = (
        await compose([
          'exec',
          '-T',
          'opsknight-agent',
          'node',
          '-e',
          'process.stdout.write(JSON.parse(require("fs").readFileSync("/var/lib/opsknight-agent/identity.json")).agentId)',
        ])
      ).stdout;
      await compose(['restart', 'opsknight-agent']);
      await until(async () =>
        compose([
          'exec',
          '-T',
          'opsknight-agent',
          'node',
          '/usr/local/bin/opsknight-agent-healthcheck.mjs',
          'readiness',
        ])
          .then(() => true)
          .catch(() => false)
      );
      const identityAfter = (
        await compose([
          'exec',
          '-T',
          'opsknight-agent',
          'node',
          '-e',
          'process.stdout.write(JSON.parse(require("fs").readFileSync("/var/lib/opsknight-agent/identity.json")).agentId)',
        ])
      ).stdout;
      expect(identityAfter).toBe(identityBefore);
      expect(identityAfter).toBe(enrollment.agent.id);
      expect(
        (await testPrisma.runbookAgent.findUniqueOrThrow({ where: { id: enrollment.agent.id } }))
          .enrollmentTokenHash
      ).toBeNull();
      await mkdir('test-results/runbook-engine', { recursive: true });
      await writeFile(
        'test-results/runbook-engine/live-compose.json',
        JSON.stringify(
          {
            measuredAt: new Date().toISOString(),
            topology:
              'Local production Next server, real PostgreSQL, trusted self-signed HTTPS proxy, locked-down Compose Agent',
            image: composeEnv.OPSKNIGHT_AGENT_IMAGE,
            gates: {
              enrollment: 'PASS',
              signedDiagnostic: 'PASS',
              outputArtifact: 'PASS',
              localPolicyCheck: 'PASS',
              restartIdentity: 'PASS',
              manualTriggerInactive: 'PASS',
              suggestedDoesNotExecute: 'PASS',
              automaticReadOnlyExecution: 'PASS',
              negativeTriggerCondition: 'PASS',
              duplicateEventFenced: 'PASS',
              dedicatedWorkerDispatch: 'PASS',
            },
            artifacts,
            limitations: [
              'Local built candidate, not a published release',
              'No external TLS proxy or native Linux host certification',
            ],
          },
          null,
          2
        )
      );
      if (process.env.RUNBOOK_FLEET_SMOKE === 'true') {
        const { smokeAgentFleet } = await import('../helpers/runbook-agent-fleet-smoke');
        await smokeAgentFleet(
          directory,
          actor.id,
          `https://${process.env.RUNBOOK_FLEET_HOST ?? 'host.docker.internal'}:${address.port}`,
          composeEnv.OPSKNIGHT_AGENT_IMAGE!
        );
      }
      if (process.env.RUNBOOK_KIND_SMOKE === 'true') {
        const { smokeRunbookKind } = await import('../helpers/runbook-kind-smoke');
        await smokeRunbookKind(directory, actor.id, `https://host.docker.internal:${address.port}`);
      }
    } catch (error) {
      await mkdir('test-results/runbook-engine', { recursive: true });
      await writeFile('test-results/runbook-engine/live-compose-app.log', appOutput);
      // Capture states and stable error codes, excluding tokens, payloads and output.
      const state = await Promise.all([
        testPrisma.runbookExecution.findMany({
          select: {
            id: true,
            status: true,
            failureCode: true,
            steps: {
              select: {
                status: true,
                errorCode: true,
                attempts: {
                  select: { status: true, errorCode: true, claimedAt: true, completedAt: true },
                },
              },
            },
          },
        }),
        testPrisma.backgroundJob.findMany({
          where: { type: 'RUNBOOK' },
          select: { id: true, status: true, attempts: true, scheduledAt: true },
        }),
        getRunbookWorkerEvidence(new Date()),
      ]).catch(() => null);
      await writeFile(
        'test-results/runbook-engine/live-compose-state.json',
        JSON.stringify(state, null, 2)
      );
      if (composeEnv.OPSKNIGHT_AGENT_IMAGE) {
        const logs = await compose(['logs', '--no-color', '--tail', '50']).catch(() => null);
        if (logs)
          await writeFile(
            'test-results/runbook-engine/live-compose-agent.log',
            logs.stdout + logs.stderr
          );
      }
      throw error;
    } finally {
      if (composeEnv.OPSKNIGHT_AGENT_IMAGE)
        await compose(['down', '-v', '--remove-orphans']).catch(() => undefined);
      await Promise.all([stopProcess(app), stopProcess(worker)]);
      proxy.closeAllConnections();
      await new Promise<void>(resolve => proxy.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 1_200_000);
});
