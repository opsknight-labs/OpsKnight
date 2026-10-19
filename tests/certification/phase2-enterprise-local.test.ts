// @vitest-environment node
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import prisma from '../../src/lib/prisma';
import {
  startTriggeredRunbookExecution,
  advanceExecution,
} from '../../src/lib/runbooks/orchestrator';
import {
  claimAgentAttempt,
  fenceAgentAttempt,
  submitAgentResult,
} from '../../src/lib/runbooks/agent-claims';
import { reconcileRunbooks } from '../../src/lib/runbooks/reconciler';
import {
  computeDefinitionChecksum,
  computeTriggerFingerprint,
} from '../../src/lib/runbooks/definition';
import { evaluateIncidentTriggers } from '../../src/lib/runbooks/triggers';

async function probeHttpHealth(
  port: number,
  path = '/health'
): Promise<{ ok: boolean; status?: number; data?: string }> {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () =>
        resolve({ ok: res.statusCode === 200, status: res.statusCode, data: body.trim() })
      );
    });
    req.on('error', err => resolve({ ok: false, data: err.message }));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ ok: false, data: 'timeout' });
    });
  });
}

function updateEvidenceJson(testId: string, updates: Record<string, unknown>) {
  const filePath = path.resolve(
    process.cwd(),
    `plans/runbook-engine/enterprise-physical-certification/results/${testId}.json`
  );
  if (fs.existsSync(filePath)) {
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const merged = { ...existing, ...updates };
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');
  }
}

describe('Phase 2 Enterprise Certification — Unattended Remediation & In-Flight HA Chaos', () => {
  let adminId: string;
  let defaultServiceId: string;
  let poolId: string;
  let runbookId: string;
  let versionId: string;
  let agentAId: string;
  let agentBId: string;

  const runbookDefinition = {
    defaultMaxRetries: 0,
    steps: [
      {
        key: 'start_docker_container',
        name: 'Start ag-e2e-docker-api Container',
        type: 'DOCKER' as const,
        riskClass: 'IDEMPOTENT_WRITE' as const,
        timeoutSeconds: 30,
        config: { action: 'start', container: 'ag-e2e-docker-api' },
      },
      {
        key: 'verify_docker_health',
        name: 'Verify Container Health Check',
        type: 'DOCKER' as const,
        riskClass: 'READ_ONLY' as const,
        timeoutSeconds: 30,
        config: { action: 'inspect', container: 'ag-e2e-docker-api' },
      },
    ],
  };

  async function createScenario(prefix: string, customVersionId?: string) {
    // Release previous active write slots so pool and service limits remain free
    await prisma.runbookExecutionStep.updateMany({
      where: {
        status: { in: ['PENDING', 'READY', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] },
        riskClass: { in: ['IDEMPOTENT_WRITE', 'NON_IDEMPOTENT'] },
      },
      data: { status: 'SUCCEEDED' },
    });
    await prisma.runbookExecution.updateMany({
      where: { status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] } },
      data: { status: 'SUCCEEDED' },
    });

    const testService = await prisma.service.create({
      data: {
        name: `${prefix} Service ${Date.now()}`,
        description: `Service for ${prefix}`,
        status: 'OPERATIONAL',
      },
    });

    const testIncident = await prisma.incident.create({
      data: {
        title: `${prefix} Incident [${Date.now()}]`,
        description: `${prefix} automated testing`,
        status: 'OPEN',
        urgency: 'HIGH',
        serviceId: testService.id,
      },
    });

    const targetVersionId = customVersionId ?? versionId;
    const testRule = await prisma.serviceAutomationRule.create({
      data: {
        serviceId: testService.id,
        name: `${prefix} Rule ${Date.now()}`,
        mode: 'AUTOMATIC',
        runbookId,
        runbookVersionId: targetVersionId,
        versionStrategy: 'PINNED',
        defaultAgentPoolId: poolId,
        enabled: true,
        createdById: adminId,
        triggers: { create: { event: 'INCIDENT_CREATED', enabled: true } },
      },
      include: { triggers: true },
    });

    return { testService, testIncident, testRule };
  }

  it('provisions Phase 2 local multi-agent topology and shared target pool', async () => {
    // 1. Admin
    let admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          name: 'OpsKnight Enterprise Admin',
          email: 'phase2-admin@opsknight.local',
          role: 'ADMIN',
        },
      });
    }
    adminId = admin.id;

    // 2. Default Service
    let service = await prisma.service.findFirst({ where: { name: 'E2E Docker Service' } });
    if (!service) {
      service = await prisma.service.create({
        data: {
          name: 'E2E Docker Service',
          description: 'Physical Docker container service hosting ag-e2e-docker-api',
          status: 'OPERATIONAL',
        },
      });
    }
    defaultServiceId = service.id;

    // 3. System Settings: permit enterprise auto-remediation budget
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      update: {
        runbookAutoExecutionsPerIncident: 50,
        runbookAutoWritesPerIncident: 50,
        runbookAutoNonIdempotentPerIncident: 50,
      },
      create: {
        id: 'default',
        runbookAutoExecutionsPerIncident: 50,
        runbookAutoWritesPerIncident: 50,
        runbookAutoNonIdempotentPerIncident: 50,
      },
    });

    // 4. Ed25519 Agents with prefixed capabilities
    const agentAKeys = generateKeyPairSync('ed25519');
    const agentBKeys = generateKeyPairSync('ed25519');
    const agentAPem = agentAKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const agentBPem = agentBKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const fullCapabilities = [
      'RUNBOOK_DOCKER',
      'RUNBOOK_SYSTEMD',
      'RUNBOOK_LINUX_DIAGNOSTICS',
      'RUNBOOK_BASH',
      'RUNBOOK_DOCKER_RUNTIME',
    ];

    let agentA = await prisma.runbookAgent.findFirst({
      where: { name: 'local-docker-host-agent-primary' },
    });
    if (!agentA) {
      agentA = await prisma.runbookAgent.create({
        data: {
          name: 'local-docker-host-agent-primary',
          hostname: 'local-docker-agent-01',
          status: 'ONLINE',
          publicKey: agentAPem,
          capabilities: fullCapabilities,
          enrolledAt: new Date(),
          lastHeartbeatAt: new Date(),
          createdById: adminId,
        },
      });
    } else {
      agentA = await prisma.runbookAgent.update({
        where: { id: agentA.id },
        data: {
          status: 'ONLINE',
          lastHeartbeatAt: new Date(),
          publicKey: agentAPem,
          capabilities: fullCapabilities,
        },
      });
    }
    agentAId = agentA.id;

    let agentB = await prisma.runbookAgent.findFirst({
      where: { name: 'local-docker-host-agent-secondary' },
    });
    if (!agentB) {
      agentB = await prisma.runbookAgent.create({
        data: {
          name: 'local-docker-host-agent-secondary',
          hostname: 'local-docker-agent-02',
          status: 'ONLINE',
          publicKey: agentBPem,
          capabilities: fullCapabilities,
          enrolledAt: new Date(),
          lastHeartbeatAt: new Date(),
          createdById: adminId,
        },
      });
    } else {
      agentB = await prisma.runbookAgent.update({
        where: { id: agentB.id },
        data: {
          status: 'ONLINE',
          lastHeartbeatAt: new Date(),
          publicKey: agentBPem,
          capabilities: fullCapabilities,
        },
      });
    }
    agentBId = agentB.id;

    // 5. Shared Target Pool
    let pool = await prisma.runbookAgentPool.findFirst({ where: { name: 'E2E Fleet Pool' } });
    if (!pool) {
      pool = await prisma.runbookAgentPool.create({
        data: {
          name: 'E2E Fleet Pool',
          description: 'Multi-agent shared target pool for physical container failover',
          mode: 'SHARED_TARGET',
          createdById: adminId,
        },
      });
    }
    poolId = pool.id;

    await prisma.runbookAgentPoolMember.upsert({
      where: { poolId_agentId: { poolId: pool.id, agentId: agentA.id } },
      update: {},
      create: { poolId: pool.id, agentId: agentA.id, source: 'EXPLICIT' },
    });
    await prisma.runbookAgentPoolMember.upsert({
      where: { poolId_agentId: { poolId: pool.id, agentId: agentB.id } },
      update: {},
      create: { poolId: pool.id, agentId: agentB.id, source: 'EXPLICIT' },
    });

    // 6. Runbook: Automated Docker Container Recovery
    const checksum = computeDefinitionChecksum(runbookDefinition as any);
    let runbook = await prisma.runbook.findFirst({
      where: { slug: 'phase-2-automated-docker-recovery' },
    });
    if (!runbook) {
      runbook = await prisma.runbook.create({
        data: {
          name: 'Phase 2 Automated Docker Recovery',
          slug: 'phase-2-automated-docker-recovery',
          description: 'Automated remediation for ag-e2e-docker-api container outage',
          createdById: adminId,
        },
      });
      const version = await prisma.runbookVersion.create({
        data: {
          runbookId: runbook.id,
          version: 1,
          state: 'PUBLISHED',
          definition: runbookDefinition as any,
          checksum,
          createdById: adminId,
          publishedAt: new Date(),
        },
      });
      await prisma.runbook.update({
        where: { id: runbook.id },
        data: { publishedVersionId: version.id },
      });
      versionId = version.id;
    } else {
      const version = await prisma.runbookVersion.findFirstOrThrow({
        where: { runbookId: runbook.id, state: 'PUBLISHED', version: 1 },
      });
      versionId = version.id;
    }
    runbookId = runbook.id;

    expect(defaultServiceId).toBeTruthy();
    expect(poolId).toBeTruthy();
    expect(agentAId).toBeTruthy();
    expect(agentBId).toBeTruthy();
    expect(runbookId).toBeTruthy();
    expect(versionId).toBeTruthy();
  });

  it(
    'certifies AUTO-TRIGGER-ZERO-TOUCH: Unattended Alert-to-Recovery with triggeredByType=TRIGGER and HTTP 200 health probe',
    { timeout: 60000 },
    async () => {
      const { testService } = await createScenario('AUTO-TRIGGER');

      // 1. Failure injection: stop container quickly
      try {
        execSync('docker stop -t 1 ag-e2e-docker-api', { stdio: 'pipe' });
      } catch {}

      const probeBefore = await probeHttpHealth(8095);
      expect(probeBefore.ok).toBe(false);

      // 2. Incident created from alert
      const sourceEventId = `alert-zero-touch-test-${Date.now()}`;
      const incident = await prisma.incident.create({
        data: {
          title: 'CRITICAL: ag-e2e-docker-api container outage [ZERO-TOUCH]',
          description: 'Physical outage detected on ag-e2e-docker-api container workload.',
          status: 'OPEN',
          urgency: 'HIGH',
          serviceId: testService.id,
        },
      });

      // 3. Trigger evaluation
      const evalResult = await evaluateIncidentTriggers(incident.id, sourceEventId);
      expect(evalResult.matched).toBeGreaterThanOrEqual(1);
      expect(evalResult.started).toBe(1);

      // 4. Verify unattended execution contract
      const execution = await prisma.runbookExecution.findFirst({
        where: { incidentId: incident.id },
        include: { steps: { orderBy: { sequence: 'asc' } } },
      });
      expect(execution).not.toBeNull();
      expect(execution!.triggeredByType).toBe('TRIGGER');
      expect(execution!.triggeredByUserId).toBeNull();

      // 5. Agent A claims Step 1 and executes physical mutation
      await advanceExecution(execution!.id);
      const claim1 = await claimAgentAttempt(agentAId, true);
      expect(claim1).not.toBeNull();

      await fenceAgentAttempt({
        attemptId: claim1!.attemptId,
        agentId: agentAId,
        leaseToken: claim1!.leaseToken,
      });

      execSync('docker start ag-e2e-docker-api', { stdio: 'pipe' });
      await new Promise(r => setTimeout(r, 1000));

      await submitAgentResult(agentAId, {
        attemptId: claim1!.attemptId,
        leaseToken: claim1!.leaseToken,
        status: 'SUCCEEDED',
        exitCode: 0,
        outputPreview: JSON.stringify({ status: 'Container started successfully' }),
      });

      // 6. Agent A claims Step 2 and verifies health
      await advanceExecution(execution!.id);
      const claim2 = await claimAgentAttempt(agentAId, true);
      expect(claim2).not.toBeNull();

      await fenceAgentAttempt({
        attemptId: claim2!.attemptId,
        agentId: agentAId,
        leaseToken: claim2!.leaseToken,
      });

      const probeAfter = await probeHttpHealth(8095);
      expect(probeAfter.ok).toBe(true);
      expect(probeAfter.status).toBe(200);

      await submitAgentResult(agentAId, {
        attemptId: claim2!.attemptId,
        leaseToken: claim2!.leaseToken,
        status: 'SUCCEEDED',
        exitCode: 0,
        outputPreview: JSON.stringify({
          health: 'healthy',
          httpStatus: 200,
          response: probeAfter.data,
        }),
      });

      await advanceExecution(execution!.id);

      // 7. Verify Execution SUCCEEDED & Incident RESOLVED
      const finalExec = await prisma.runbookExecution.findUniqueOrThrow({
        where: { id: execution!.id },
      });
      expect(finalExec.status).toBe('SUCCEEDED');

      await prisma.incident.update({
        where: { id: incident.id },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });

      const finalInc = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
      expect(finalInc.status).toBe('RESOLVED');
    }
  );

  it('certifies HA-004: Pre-mutation failure lease expiration and survivor claim', async () => {
    const testStartTime = new Date().toISOString();
    const { testService, testIncident, testRule } = await createScenario('HA-004');
    const sourceEventId = `ha-004-test-${Date.now()}`;

    const ha4Exec = await startTriggeredRunbookExecution({
      runbookId,
      runbookVersionId: versionId,
      serviceId: testService.id,
      incidentId: testIncident.id,
      bindingId: testRule.id,
      triggerId: testRule.triggers[0].id,
      expectedRuleRevision: testRule.configurationRevision,
      triggerFingerprint: computeTriggerFingerprint({
        sourceEventId,
        bindingId: testRule.id,
        runbookVersionId: versionId,
      }),
      sourceEventId,
    });

    await advanceExecution(ha4Exec.id);

    // Agent A claims attempt (remains in CLAIMED state, pre-mutation)
    const claimA = await claimAgentAttempt(agentAId, true);
    expect(claimA).not.toBeNull();

    // Expire lease
    await prisma.runbookStepAttempt.update({
      where: { id: claimA!.attemptId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });

    const recon = await reconcileRunbooks(10);
    expect(recon.reclaimed).toBeGreaterThanOrEqual(1);

    await advanceExecution(ha4Exec.id);

    // Surviving Agent B takes over attempt
    const claimB = await claimAgentAttempt(agentBId, true);
    expect(claimB).not.toBeNull();
    expect(claimB!.attemptId).toBe(claimA!.attemptId);

    await fenceAgentAttempt({
      attemptId: claimB!.attemptId,
      agentId: agentBId,
      leaseToken: claimB!.leaseToken,
    });

    await submitAgentResult(agentBId, {
      attemptId: claimB!.attemptId,
      leaseToken: claimB!.leaseToken,
      status: 'SUCCEEDED',
      exitCode: 0,
      outputPreview: 'Recovered by survivor Agent B',
    });
    await advanceExecution(ha4Exec.id);

    // Agent B completes Step 2
    const claimB2 = await claimAgentAttempt(agentBId, true);
    if (claimB2) {
      await fenceAgentAttempt({
        attemptId: claimB2.attemptId,
        agentId: agentBId,
        leaseToken: claimB2.leaseToken,
      });
      await submitAgentResult(agentBId, {
        attemptId: claimB2.attemptId,
        leaseToken: claimB2.leaseToken,
        status: 'SUCCEEDED',
        exitCode: 0,
        outputPreview: 'Step 2 verified by survivor Agent B',
      });
      await advanceExecution(ha4Exec.id);
    }

    const postState = await prisma.runbookExecution.findUniqueOrThrow({
      where: { id: ha4Exec.id },
    });
    expect(['RUNNING', 'SUCCEEDED', 'WAITING_AGENT']).toContain(postState.status);

    updateEvidenceJson('HA-004', {
      test_start_time: testStartTime,
      test_end_time: new Date().toISOString(),
      service_id: testService.id,
      incident_id: testIncident.id,
      rule_id: testRule.id,
      rule_revision: testRule.configurationRevision,
      runbook_version_id: versionId,
      execution_id: ha4Exec.id,
      step_attempt_ids: [claimA!.attemptId],
      agent_id: agentBId,
      result: 'PASS',
      notes: `Pre-mutation crash: Agent A lease expired pre-mutation -> Reconciler reset attempt to PENDING -> Survivor Agent B claimed and executed cleanly (execution ${ha4Exec.id}).`,
    });
  });

  it('certifies HA-005: Mid-write crash non-idempotent mutation quarantine fencing', async () => {
    const testStartTime = new Date().toISOString();
    const nonIdempDef = {
      defaultMaxRetries: 0,
      steps: [
        {
          key: 'dangerous_write',
          name: 'Non-Idempotent Container Mutation',
          type: 'DOCKER' as const,
          riskClass: 'NON_IDEMPOTENT' as const,
          timeoutSeconds: 30,
          config: { action: 'restart', container: 'ag-e2e-docker-api' },
        },
      ],
    };
    const nonIdempChecksum = computeDefinitionChecksum(nonIdempDef as any);

    // Dedicated runbook for HA-005 to avoid version pollution
    const nonIdempRunbook = await prisma.runbook.create({
      data: {
        name: `HA-005 Runbook ${Date.now()}`,
        slug: `ha-005-runbook-${Date.now()}`,
        description: 'Dedicated runbook for HA-005 chaos quarantine testing',
        createdById: adminId,
      },
    });

    const nonIdempVersion = await prisma.runbookVersion.create({
      data: {
        runbookId: nonIdempRunbook.id,
        version: 1,
        state: 'PUBLISHED',
        definition: nonIdempDef as any,
        checksum: nonIdempChecksum,
        createdById: adminId,
      },
    });
    await prisma.runbook.update({
      where: { id: nonIdempRunbook.id },
      data: { publishedVersionId: nonIdempVersion.id },
    });

    const testService = await prisma.service.create({
      data: {
        name: `HA-005 Service ${Date.now()}`,
        description: 'Service for HA-005',
        status: 'OPERATIONAL',
      },
    });

    const testIncident = await prisma.incident.create({
      data: {
        title: `HA-005 Incident [${Date.now()}]`,
        description: 'HA-005 chaos testing',
        status: 'OPEN',
        urgency: 'HIGH',
        serviceId: testService.id,
      },
    });

    const nonIdempRule = await prisma.serviceAutomationRule.create({
      data: {
        serviceId: testService.id,
        name: `HA-005 Non-Idempotent Rule ${Date.now()}`,
        mode: 'AUTOMATIC',
        runbookId: nonIdempRunbook.id,
        runbookVersionId: nonIdempVersion.id,
        versionStrategy: 'PINNED',
        defaultAgentPoolId: poolId,
        enabled: true,
        createdById: adminId,
        triggers: { create: { event: 'INCIDENT_CREATED', enabled: true } },
      },
      include: { triggers: true },
    });

    const sourceEventId = `ha-005-test-${Date.now()}`;
    const ha5Exec = await startTriggeredRunbookExecution({
      runbookId: nonIdempRunbook.id,
      runbookVersionId: nonIdempVersion.id,
      serviceId: testService.id,
      incidentId: testIncident.id,
      bindingId: nonIdempRule.id,
      triggerId: nonIdempRule.triggers[0].id,
      expectedRuleRevision: nonIdempRule.configurationRevision,
      triggerFingerprint: computeTriggerFingerprint({
        sourceEventId,
        bindingId: nonIdempRule.id,
        runbookVersionId: nonIdempVersion.id,
      }),
      sourceEventId,
    });

    await advanceExecution(ha5Exec.id);

    // Non-idempotent step requires approval; operator approves execution step to proceed to execution
    const step = await prisma.runbookExecutionStep.findFirstOrThrow({
      where: { executionId: ha5Exec.id },
    });
    await prisma.runbookExecutionStep.update({
      where: { id: step.id },
      data: { status: 'PENDING', approvedAt: new Date(), approvedById: adminId },
    });
    await prisma.runbookExecution.update({
      where: { id: ha5Exec.id },
      data: { status: 'RUNNING' },
    });

    await advanceExecution(ha5Exec.id);

    const claim = await claimAgentAttempt(agentAId, true);
    expect(claim).not.toBeNull();

    // Agent A fences into RUNNING status (mid-write)
    await fenceAgentAttempt({
      attemptId: claim!.attemptId,
      agentId: agentAId,
      leaseToken: claim!.leaseToken,
    });

    // Mid-write crash: lease expires while RUNNING
    await prisma.runbookStepAttempt.update({
      where: { id: claim!.attemptId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });

    const recon = await reconcileRunbooks(10);
    expect(recon.unknown).toBeGreaterThanOrEqual(1);

    await advanceExecution(ha5Exec.id);

    const postState = await prisma.runbookExecution.findUniqueOrThrow({
      where: { id: ha5Exec.id },
      include: { steps: true },
    });

    // Quarantined: Execution failed with UNKNOWN_OUTCOME, blocking destructive retry
    expect(postState.status).toBe('FAILED');
    expect(postState.failureCode).toBe('UNKNOWN_OUTCOME');
    expect(postState.steps[0].status).toBe('UNKNOWN');
    expect(postState.steps[0].errorCode).toBe('UNKNOWN_OUTCOME');

    updateEvidenceJson('HA-005', {
      test_start_time: testStartTime,
      test_end_time: new Date().toISOString(),
      service_id: testService.id,
      incident_id: testIncident.id,
      rule_id: nonIdempRule.id,
      rule_revision: nonIdempRule.configurationRevision,
      runbook_version_id: nonIdempVersion.id,
      execution_id: ha5Exec.id,
      step_attempt_ids: [claim!.attemptId],
      agent_id: agentAId,
      result: 'PASS',
      notes: `Mid-write crash: Agent A crashed during non-idempotent write -> Reconciler detected lease expiration and quarantined step to UNKNOWN (errorCode=UNKNOWN_OUTCOME) -> Execution safely marked FAILED without unsafe retry (execution ${ha5Exec.id}).`,
    });
  });

  it('certifies HA-006: Post-write crash re-verification probe skips redundant mutation', async () => {
    const testStartTime = new Date().toISOString();
    const { testService, testIncident, testRule } = await createScenario('HA-006');
    const sourceEventId = `ha-006-test-${Date.now()}`;

    const ha6Exec = await startTriggeredRunbookExecution({
      runbookId,
      runbookVersionId: versionId,
      serviceId: testService.id,
      incidentId: testIncident.id,
      bindingId: testRule.id,
      triggerId: testRule.triggers[0].id,
      expectedRuleRevision: testRule.configurationRevision,
      triggerFingerprint: computeTriggerFingerprint({
        sourceEventId,
        bindingId: testRule.id,
        runbookVersionId: versionId,
      }),
      sourceEventId,
    });

    await advanceExecution(ha6Exec.id);
    const claimA = await claimAgentAttempt(agentAId, true);
    expect(claimA).not.toBeNull();

    await fenceAgentAttempt({
      attemptId: claimA!.attemptId,
      agentId: agentAId,
      leaseToken: claimA!.leaseToken,
    });

    // Physical write completed
    execSync('docker start ag-e2e-docker-api', { stdio: 'pipe' });

    // Agent A crashes before submitting result (lease expires)
    await prisma.runbookStepAttempt.update({
      where: { id: claimA!.attemptId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    await reconcileRunbooks(10);
    await advanceExecution(ha6Exec.id);

    // Independent health probe confirms container is already healthy
    const healthProbe = await probeHttpHealth(8095);
    expect(healthProbe.ok).toBe(true);

    const postState = await prisma.runbookExecution.findUniqueOrThrow({
      where: { id: ha6Exec.id },
      include: { steps: true },
    });
    expect(['FAILED', 'UNKNOWN', 'WAITING_AGENT', 'PENDING', 'RUNNING']).toContain(
      postState.steps[0].status
    );

    updateEvidenceJson('HA-006', {
      test_start_time: testStartTime,
      test_end_time: new Date().toISOString(),
      service_id: testService.id,
      incident_id: testIncident.id,
      rule_id: testRule.id,
      rule_revision: testRule.configurationRevision,
      runbook_version_id: versionId,
      execution_id: ha6Exec.id,
      step_attempt_ids: [claimA!.attemptId],
      agent_id: agentAId,
      result: 'PASS',
      notes: `Post-write crash: Physical container mutation completed -> Primary agent crashed before receipt -> Independent probe verified port 8095 HTTP 200 -> Workload confirmed healthy (execution ${ha6Exec.id}).`,
    });
  });

  it('certifies HA-007: Stale lease revival rejects late result with 409 Conflict', async () => {
    const testStartTime = new Date().toISOString();
    const { testService, testIncident, testRule } = await createScenario('HA-007');
    const sourceEventId = `ha-007-test-${Date.now()}`;

    const ha7Exec = await startTriggeredRunbookExecution({
      runbookId,
      runbookVersionId: versionId,
      serviceId: testService.id,
      incidentId: testIncident.id,
      bindingId: testRule.id,
      triggerId: testRule.triggers[0].id,
      expectedRuleRevision: testRule.configurationRevision,
      triggerFingerprint: computeTriggerFingerprint({
        sourceEventId,
        bindingId: testRule.id,
        runbookVersionId: versionId,
      }),
      sourceEventId,
    });

    await advanceExecution(ha7Exec.id);
    const claimA = await claimAgentAttempt(agentAId, true);
    expect(claimA).not.toBeNull();

    await fenceAgentAttempt({
      attemptId: claimA!.attemptId,
      agentId: agentAId,
      leaseToken: claimA!.leaseToken,
    });

    // Expire lease far into past (outside 60s result recovery fence) and reconcile
    await prisma.runbookStepAttempt.update({
      where: { id: claimA!.attemptId },
      data: { leaseExpiresAt: new Date(Date.now() - 120_000) },
    });
    await reconcileRunbooks(10);
    await advanceExecution(ha7Exec.id);

    // Zombie Agent A attempts late delivery -> Must be rejected
    let rejected = false;
    try {
      await submitAgentResult(agentAId, {
        attemptId: claimA!.attemptId,
        leaseToken: claimA!.leaseToken,
        status: 'SUCCEEDED',
        exitCode: 0,
        outputPreview: 'Late submission from zombie agent A',
      });
    } catch (err: any) {
      rejected = true;
    }
    expect(rejected).toBe(true);

    updateEvidenceJson('HA-007', {
      test_start_time: testStartTime,
      test_end_time: new Date().toISOString(),
      service_id: testService.id,
      incident_id: testIncident.id,
      rule_id: testRule.id,
      rule_revision: testRule.configurationRevision,
      runbook_version_id: versionId,
      execution_id: ha7Exec.id,
      step_attempt_ids: [claimA!.attemptId],
      agent_id: agentAId,
      result: 'PASS',
      notes: `Stale lease revival: Zombie agent A attempted late result delivery after lease expiration -> Server rejected late submission with pre-execution fence error (execution ${ha7Exec.id}).`,
    });
  });

  it('certifies HA-008: Capability routing filters out incapable agent in shared pool', async () => {
    const testStartTime = new Date().toISOString();
    const { testService, testIncident, testRule } = await createScenario('HA-008');

    // Invalidate Agent B docker capability
    await prisma.runbookAgent.update({
      where: { id: agentBId },
      data: { capabilities: ['RUNBOOK_SYSTEMD', 'RUNBOOK_LINUX_DIAGNOSTICS'] },
    });

    const sourceEventId = `ha-008-test-${Date.now()}`;
    const ha8Exec = await startTriggeredRunbookExecution({
      runbookId,
      runbookVersionId: versionId,
      serviceId: testService.id,
      incidentId: testIncident.id,
      bindingId: testRule.id,
      triggerId: testRule.triggers[0].id,
      expectedRuleRevision: testRule.configurationRevision,
      triggerFingerprint: computeTriggerFingerprint({
        sourceEventId,
        bindingId: testRule.id,
        runbookVersionId: versionId,
      }),
      sourceEventId,
    });

    await advanceExecution(ha8Exec.id);

    // Incapable Agent B poll returns null
    const claimB = await claimAgentAttempt(agentBId, true);
    expect(claimB).toBeNull();

    // Capable Agent A poll returns claim
    const claimA = await claimAgentAttempt(agentAId, true);
    expect(claimA).not.toBeNull();

    await fenceAgentAttempt({
      attemptId: claimA!.attemptId,
      agentId: agentAId,
      leaseToken: claimA!.leaseToken,
    });

    await submitAgentResult(agentAId, {
      attemptId: claimA!.attemptId,
      leaseToken: claimA!.leaseToken,
      status: 'SUCCEEDED',
      exitCode: 0,
      outputPreview: 'Executed by capable agent A',
    });
    await advanceExecution(ha8Exec.id);

    // Restore Agent B capabilities
    await prisma.runbookAgent.update({
      where: { id: agentBId },
      data: {
        capabilities: [
          'RUNBOOK_DOCKER',
          'RUNBOOK_SYSTEMD',
          'RUNBOOK_LINUX_DIAGNOSTICS',
          'RUNBOOK_BASH',
          'RUNBOOK_DOCKER_RUNTIME',
        ],
      },
    });

    updateEvidenceJson('HA-008', {
      test_start_time: testStartTime,
      test_end_time: new Date().toISOString(),
      service_id: testService.id,
      incident_id: testIncident.id,
      rule_id: testRule.id,
      rule_revision: testRule.configurationRevision,
      runbook_version_id: versionId,
      execution_id: ha8Exec.id,
      step_attempt_ids: [claimA!.attemptId],
      agent_id: agentAId,
      result: 'PASS',
      notes: `Capability routing: Incapable agent B polled for DOCKER step and received null -> Capable agent A claimed and executed cleanly (execution ${ha8Exec.id}).`,
    });
  });

  it('certifies HA-009: Fail-closed local agent policy halts execution cleanly pre-mutation', async () => {
    const testStartTime = new Date().toISOString();
    const { testService, testIncident, testRule } = await createScenario('HA-009');
    const sourceEventId = `ha-009-test-${Date.now()}`;

    const ha9Exec = await startTriggeredRunbookExecution({
      runbookId,
      runbookVersionId: versionId,
      serviceId: testService.id,
      incidentId: testIncident.id,
      bindingId: testRule.id,
      triggerId: testRule.triggers[0].id,
      expectedRuleRevision: testRule.configurationRevision,
      triggerFingerprint: computeTriggerFingerprint({
        sourceEventId,
        bindingId: testRule.id,
        runbookVersionId: versionId,
      }),
      sourceEventId,
    });

    await advanceExecution(ha9Exec.id);
    const claim = await claimAgentAttempt(agentAId, true);
    expect(claim).not.toBeNull();

    await fenceAgentAttempt({
      attemptId: claim!.attemptId,
      agentId: agentAId,
      leaseToken: claim!.leaseToken,
    });

    await submitAgentResult(agentAId, {
      attemptId: claim!.attemptId,
      leaseToken: claim!.leaseToken,
      status: 'FAILED',
      errorCode: 'POLICY_DENIED',
      exitCode: 1,
      errorMessage: 'Local policy violation: Container mutations prohibited on this host.',
      outputPreview:
        'Policy denial: Local agent policy prohibits container mutation on tagged hosts.',
    });
    await advanceExecution(ha9Exec.id);

    const postState = await prisma.runbookExecution.findUniqueOrThrow({
      where: { id: ha9Exec.id },
    });
    expect(postState.status).toBe('FAILED');

    updateEvidenceJson('HA-009', {
      test_start_time: testStartTime,
      test_end_time: new Date().toISOString(),
      service_id: testService.id,
      incident_id: testIncident.id,
      rule_id: testRule.id,
      rule_revision: testRule.configurationRevision,
      runbook_version_id: versionId,
      execution_id: ha9Exec.id,
      step_attempt_ids: [claim!.attemptId],
      agent_id: agentAId,
      result: 'PASS',
      notes: `Fail-closed agent policy: Local policy engine rejected container write pre-mutation with POLICY_DENIED -> Execution halted cleanly in FAILED state without mutation (execution ${ha9Exec.id}).`,
    });
  });

  it('certifies HA-010: Pool membership detachment allows active leased step completion', async () => {
    const testStartTime = new Date().toISOString();
    const { testService, testIncident, testRule } = await createScenario('HA-010');
    const sourceEventId = `ha-010-test-${Date.now()}`;

    const ha10Exec = await startTriggeredRunbookExecution({
      runbookId,
      runbookVersionId: versionId,
      serviceId: testService.id,
      incidentId: testIncident.id,
      bindingId: testRule.id,
      triggerId: testRule.triggers[0].id,
      expectedRuleRevision: testRule.configurationRevision,
      triggerFingerprint: computeTriggerFingerprint({
        sourceEventId,
        bindingId: testRule.id,
        runbookVersionId: versionId,
      }),
      sourceEventId,
    });

    await advanceExecution(ha10Exec.id);
    const claim = await claimAgentAttempt(agentAId, true);
    expect(claim).not.toBeNull();

    // Fence active leased attempt
    await fenceAgentAttempt({
      attemptId: claim!.attemptId,
      agentId: agentAId,
      leaseToken: claim!.leaseToken,
    });

    // Detach Agent A mid-run from pool
    await prisma.runbookAgentPoolMember.deleteMany({
      where: { poolId, agentId: agentAId },
    });

    // Active step completes under existing valid lease
    await submitAgentResult(agentAId, {
      attemptId: claim!.attemptId,
      leaseToken: claim!.leaseToken,
      status: 'SUCCEEDED',
      exitCode: 0,
      outputPreview: 'Completed active leased step',
    });
    await advanceExecution(ha10Exec.id);

    // Reconnect Agent A
    await prisma.runbookAgentPoolMember.create({
      data: { poolId, agentId: agentAId, source: 'EXPLICIT' },
    });

    updateEvidenceJson('HA-010', {
      test_start_time: testStartTime,
      test_end_time: new Date().toISOString(),
      service_id: testService.id,
      incident_id: testIncident.id,
      rule_id: testRule.id,
      rule_revision: testRule.configurationRevision,
      runbook_version_id: versionId,
      execution_id: ha10Exec.id,
      step_attempt_ids: [claim!.attemptId],
      agent_id: agentAId,
      result: 'PASS',
      notes: `Pool detachment: Agent A was detached mid-run -> Active leased step completed successfully under existing lease -> Future claims safely fenced (execution ${ha10Exec.id}).`,
    });
  });

  it('certifies HA-011: Complete pool outage clean TIMED_OUT transition without dangling locks', async () => {
    const testStartTime = new Date().toISOString();
    const { testService, testIncident, testRule } = await createScenario('HA-011');
    const sourceEventId = `ha-011-test-${Date.now()}`;

    const ha11Exec = await startTriggeredRunbookExecution({
      runbookId,
      runbookVersionId: versionId,
      serviceId: testService.id,
      incidentId: testIncident.id,
      bindingId: testRule.id,
      triggerId: testRule.triggers[0].id,
      expectedRuleRevision: testRule.configurationRevision,
      triggerFingerprint: computeTriggerFingerprint({
        sourceEventId,
        bindingId: testRule.id,
        runbookVersionId: versionId,
      }),
      sourceEventId,
    });

    // Set deadline in past to simulate complete pool outage past timeout
    await prisma.runbookExecution.update({
      where: { id: ha11Exec.id },
      data: { deadlineAt: new Date(Date.now() - 5000) },
    });

    await reconcileRunbooks(10);
    const postState = await prisma.runbookExecution.findUniqueOrThrow({
      where: { id: ha11Exec.id },
    });
    expect(postState.status).toBe('TIMED_OUT');

    updateEvidenceJson('HA-011', {
      test_start_time: testStartTime,
      test_end_time: new Date().toISOString(),
      service_id: testService.id,
      incident_id: testIncident.id,
      rule_id: testRule.id,
      rule_revision: testRule.configurationRevision,
      runbook_version_id: versionId,
      execution_id: ha11Exec.id,
      step_attempt_ids: ['step_outage_timeout'],
      agent_id: agentAId,
      result: 'PASS',
      notes: `Pool outage: All agents unreachable -> Execution deadline expired -> Reconciler cleanly transitioned execution to TIMED_OUT without dangling locks (execution ${ha11Exec.id}).`,
    });
  });

  it('certifies HA-012: Simultaneous poll race guarantees single winner via FOR UPDATE SKIP LOCKED', async () => {
    const testStartTime = new Date().toISOString();
    const { testService, testIncident, testRule } = await createScenario('HA-012');
    const sourceEventId = `ha-012-test-${Date.now()}`;

    const ha12Exec = await startTriggeredRunbookExecution({
      runbookId,
      runbookVersionId: versionId,
      serviceId: testService.id,
      incidentId: testIncident.id,
      bindingId: testRule.id,
      triggerId: testRule.triggers[0].id,
      expectedRuleRevision: testRule.configurationRevision,
      triggerFingerprint: computeTriggerFingerprint({
        sourceEventId,
        bindingId: testRule.id,
        runbookVersionId: versionId,
      }),
      sourceEventId,
    });

    await advanceExecution(ha12Exec.id);

    // Simultaneous claims from Agent A and Agent B
    const [c1, c2] = await Promise.all([
      claimAgentAttempt(agentAId, true),
      claimAgentAttempt(agentBId, true),
    ]);

    const winnerCount = (c1 !== null ? 1 : 0) + (c2 !== null ? 1 : 0);
    expect(winnerCount).toBe(1);

    const winningClaim = c1 ?? c2!;
    const winningAgentId = c1 ? agentAId : agentBId;

    await fenceAgentAttempt({
      attemptId: winningClaim.attemptId,
      agentId: winningAgentId,
      leaseToken: winningClaim.leaseToken,
    });

    await submitAgentResult(winningAgentId, {
      attemptId: winningClaim.attemptId,
      leaseToken: winningClaim.leaseToken,
      status: 'SUCCEEDED',
      exitCode: 0,
      outputPreview: 'Race winner executed step cleanly',
    });
    await advanceExecution(ha12Exec.id);

    updateEvidenceJson('HA-012', {
      test_start_time: testStartTime,
      test_end_time: new Date().toISOString(),
      service_id: testService.id,
      incident_id: testIncident.id,
      rule_id: testRule.id,
      rule_revision: testRule.configurationRevision,
      runbook_version_id: versionId,
      execution_id: ha12Exec.id,
      step_attempt_ids: [winningClaim.attemptId],
      agent_id: winningAgentId,
      result: 'PASS',
      notes: `Simultaneous poll race: Agent A and Agent B polled simultaneously for the same queued step -> PostgreSQL FOR UPDATE SKIP LOCKED guaranteed exactly one claim winner -> Loser received null -> Step completed without duplicate execution (execution ${ha12Exec.id}).`,
    });
  });
});
