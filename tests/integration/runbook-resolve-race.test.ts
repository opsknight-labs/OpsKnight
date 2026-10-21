import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import {
  computeDefinitionChecksum,
  computeTriggerFingerprint,
  parseRunbookDefinition,
} from '@/lib/runbooks/definition';
import { createServiceBinding } from '@/lib/runbooks/bindings';
import { processRunbookJob, startTriggeredRunbookExecution } from '@/lib/runbooks/orchestrator';
import type { RunbookDefinition } from '@/lib/runbooks/types';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const ITERATIONS = 30;

const READ_ONLY_CHECK: RunbookDefinition = {
  steps: [
    {
      key: 'check',
      name: 'Check api',
      type: 'SYSTEMD',
      riskClass: 'READ_ONLY',
      config: { action: 'status', unit: 'api.service' },
    },
  ],
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function createFixture() {
  const runbook = await testPrisma.runbook.create({
    data: { name: `Race ${crypto.randomUUID()}`, slug: `race-${crypto.randomUUID()}` },
  });
  const parsed = parseRunbookDefinition(READ_ONLY_CHECK as unknown as Prisma.InputJsonValue, []);
  const version = await testPrisma.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      publishedAt: new Date(),
      definition: parsed as unknown as Prisma.InputJsonValue,
      checksum: computeDefinitionChecksum(parsed),
    },
  });
  await testPrisma.runbook.update({
    where: { id: runbook.id },
    data: { publishedVersionId: version.id },
  });
  const [service, admin, agent] = await Promise.all([
    createTestService('Runbook resolve race'),
    createTestUser({ role: 'ADMIN' }),
    testPrisma.runbookAgent.create({
      data: {
        name: `agent-${crypto.randomUUID()}`,
        status: 'ONLINE',
        capabilities: ['RUNBOOK_SYSTEMD'],
        lastHeartbeatAt: new Date(),
      },
    }),
  ]);
  const pool = await testPrisma.runbookAgentPool.create({
    data: { name: `pool-${crypto.randomUUID()}`, members: { create: { agentId: agent.id } } },
  });
  const created = await createServiceBinding(
    service.id,
    {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      enabled: true,
      mode: 'AUTOMATIC',
      versionStrategy: 'PINNED',
      defaultAgentPoolId: pool.id,
      inputValues: {},
    },
    admin.id
  );
  const trigger = await testPrisma.runbookTrigger.create({
    data: { bindingId: created.id, event: 'INCIDENT_CREATED' },
  });
  // Trigger creation pauses AUTOMATIC bindings by database invariant.
  const binding = await testPrisma.serviceAutomationRule.update({
    where: { id: created.id },
    data: { enabled: true },
  });
  return { runbook, version, service, binding, trigger };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function startAutomatic(fixture: Fixture, incidentId: string) {
  const sourceEventId = crypto.randomUUID();
  const { configurationRevision } = await prisma.serviceAutomationRule.findUniqueOrThrow({
    where: { id: fixture.binding.id },
  });
  return startTriggeredRunbookExecution({
    expectedRuleRevision: configurationRevision,
    runbookId: fixture.runbook.id,
    runbookVersionId: fixture.version.id,
    incidentId,
    serviceId: fixture.service.id,
    bindingId: fixture.binding.id,
    triggerId: fixture.trigger.id,
    sourceEventId,
    triggerFingerprint: computeTriggerFingerprint({
      sourceEventId,
      bindingId: fixture.binding.id,
      runbookVersionId: fixture.version.id,
    }),
    evaluationSource: 'MANUAL',
  });
}

function evaluationJob(incidentId: string) {
  return processRunbookJob({
    kind: 'EVALUATE_TRIGGER',
    incidentId,
    sourceEventId: crypto.randomUUID(),
    source: 'MANUAL',
  });
}

async function resolveIncident(incidentId: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        tx =>
          applyIncidentLifecycleCommand(tx, { incidentId, command: 'RESOLVE', source: 'SYSTEM' }),
        { isolationLevel: 'Serializable' }
      );
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2034' || attempt >= 5) throw error;
    }
  }
}

async function skipMessages(incidentId: string) {
  const events = await testPrisma.incidentEvent.findMany({
    where: { incidentId, type: 'RUNBOOK_SKIPPED' },
  });
  return events.map(event => event.message);
}

describeIfRealDB('automatic runbook start vs incident resolve (real PostgreSQL)', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    await resetDatabase();
    // DB-clock audit of when the resolve UPDATE and the execution INSERT actually happened.
    await testPrisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS race_test_log (incident_id text, kind text, at timestamptz)`
    );
    await testPrisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION race_test_log_incident() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'RESOLVED' AND OLD.status <> 'RESOLVED' THEN
          INSERT INTO race_test_log VALUES (NEW.id, 'RESOLVE', clock_timestamp());
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await testPrisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION race_test_log_execution() RETURNS trigger AS $$
      BEGIN
        INSERT INTO race_test_log VALUES (NEW."incidentId", 'EXEC', clock_timestamp());
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await testPrisma.$executeRawUnsafe(
      `CREATE TRIGGER race_test_incident AFTER UPDATE ON "Incident" FOR EACH ROW EXECUTE FUNCTION race_test_log_incident()`
    );
    await testPrisma.$executeRawUnsafe(
      `CREATE TRIGGER race_test_execution AFTER INSERT ON "RunbookExecution" FOR EACH ROW EXECUTE FUNCTION race_test_log_execution()`
    );
    fixture = await createFixture();
  }, 600_000);

  afterAll(async () => {
    await testPrisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS race_test_incident ON "Incident"`);
    await testPrisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS race_test_execution ON "RunbookExecution"`
    );
    await testPrisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS race_test_log_incident()`);
    await testPrisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS race_test_log_execution()`);
    await testPrisma.$executeRawUnsafe(`DROP TABLE IF EXISTS race_test_log`);
    await testPrisma.$disconnect();
  }, 60_000);

  it('resolve first, then the evaluation job: no execution and one INCIDENT_NOT_OPEN skip', async () => {
    const incident = await createTestIncident('Resolved first', fixture.service.id);
    await resolveIncident(incident.id);
    await expect(evaluationJob(incident.id)).resolves.toBeUndefined();
    await expect(evaluationJob(incident.id)).resolves.toBeUndefined();
    expect(await testPrisma.runbookExecution.count({ where: { incidentId: incident.id } })).toBe(0);
    expect(await skipMessages(incident.id)).toEqual([
      `Runbook skipped: ${fixture.runbook.name}: INCIDENT_NOT_OPEN: incident is RESOLVED`,
    ]);
  });

  it('resolve first, then the automatic start: rejected inside the creation transaction', async () => {
    const incident = await createTestIncident('Resolved first direct', fixture.service.id);
    await resolveIncident(incident.id);
    await expect(startAutomatic(fixture, incident.id)).rejects.toThrow(/INCIDENT_NOT_OPEN/);
    expect(await testPrisma.runbookExecution.count({ where: { incidentId: incident.id } })).toBe(0);
  });

  it('a resolve committing while the job waits on the incident lock prevents the execution', async () => {
    const incident = await createTestIncident('Resolve in flight', fixture.service.id);
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    let markApplied!: () => void;
    const applied = new Promise<void>(resolve => (markApplied = resolve));
    const resolving = prisma.$transaction(
      async tx => {
        await applyIncidentLifecycleCommand(tx, {
          incidentId: incident.id,
          command: 'RESOLVE',
          source: 'SYSTEM',
        });
        markApplied();
        await gate;
      },
      { timeout: 60_000 }
    );
    await applied;
    // The job reads the committed OPEN status, then blocks on the incident row lock.
    const job = evaluationJob(incident.id);
    for (let i = 0; ; i++) {
      const [waiting] = await testPrisma.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE '%FOR NO KEY UPDATE%'`;
      if (waiting.count > 0) break;
      if (i > 200) throw new Error('Job never waited on the incident lock.');
      await sleep(25);
    }
    release();
    await resolving;
    await expect(job).resolves.toBeUndefined();
    expect(await testPrisma.runbookExecution.count({ where: { incidentId: incident.id } })).toBe(0);
    expect(await skipMessages(incident.id)).toEqual([
      `Runbook skipped: ${fixture.runbook.name}: INCIDENT_NOT_OPEN: incident is RESOLVED`,
    ]);
  }, 120_000);

  it(`never creates an execution after a committed resolve (${ITERATIONS} concurrent iterations)`, async () => {
    const outcomes = { executedBeforeResolve: 0, skipped: 0 };
    for (let i = 0; i < ITERATIONS; i++) {
      const incident = await createTestIncident(`Race ${i}`, fixture.service.id);
      const viaJob = i % 2 === 0;
      const start = async () => {
        await sleep(Math.floor(Math.random() * 15));
        if (viaJob) return evaluationJob(incident.id);
        await startAutomatic(fixture, incident.id).catch(error => {
          if (!/INCIDENT_NOT_OPEN/.test((error as Error).message)) throw error;
        });
      };
      const resolve = async () => {
        await sleep(Math.floor(Math.random() * 15));
        await resolveIncident(incident.id);
      };
      await Promise.all(Math.random() < 0.5 ? [start(), resolve()] : [resolve(), start()]);

      const current = await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
      expect(current.status).toBe('RESOLVED');
      const executions = await testPrisma.runbookExecution.findMany({
        where: { incidentId: incident.id },
      });
      expect(executions.length).toBeLessThanOrEqual(1);
      const log = await testPrisma.$queryRaw<{ kind: string; at: Date }[]>`
        SELECT kind, at FROM race_test_log WHERE incident_id = ${incident.id}`;
      const resolvedAt = log.find(row => row.kind === 'RESOLVE')!.at;
      const executedAt = log.find(row => row.kind === 'EXEC')?.at;
      if (executions.length) {
        // The execution held the incident lock first; the resolve came strictly after it.
        expect(executedAt!.getTime()).toBeLessThanOrEqual(resolvedAt.getTime());
        outcomes.executedBeforeResolve++;
      } else {
        expect(executedAt).toBeUndefined();
        if (viaJob)
          expect(await skipMessages(incident.id)).toEqual([
            `Runbook skipped: ${fixture.runbook.name}: INCIDENT_NOT_OPEN: incident is RESOLVED`,
          ]);
        outcomes.skipped++;
      }
    }
    expect(outcomes.executedBeforeResolve + outcomes.skipped).toBe(ITERATIONS);
    process.stdout.write(`resolve race outcomes ${JSON.stringify(outcomes)}\n`);
  }, 600_000);
});
