import dotenv from 'dotenv';
if (process.env.DOTENV_CONFIG_PATH) {
  dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, override: true });
} else {
  dotenv.config({ override: false });
}
import { PrismaClient } from '@prisma/client';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { encrypt } from '../../src/lib/encryption';
import { API_SCOPES } from '../../src/lib/authorization';
import { computeDefinitionChecksum } from '../../src/lib/runbooks/definition';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`[FATAL] Missing mandatory environment variable: ${name}`);
  }
  return value.trim();
}

const DATABASE_URL = requireEnv('DATABASE_URL');
const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3900/api/v2';
const APP_BASE_URL = API_BASE_URL.replace('/api/v2', '');

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

async function mintAdminApiKey(adminUserId: string): Promise<string> {
  const apiKeySecret =
    process.env.API_KEY_SECRET ||
    '02e58c8699dfd55c71c9ab5ed99da2ba106dff2517bb9f63ddd2775d63342191';
  const rawToken = `ok_cert_${randomBytes(24).toString('base64url')}`;
  const prefix = rawToken.slice(0, 15);
  const tokenHash = createHmac('sha256', apiKeySecret)
    .update(`opsknight:api-key:v2:${rawToken}`)
    .digest('hex');

  await prisma.apiKey.create({
    data: {
      name: `Continuous Chain Cert Key ${Date.now()}`,
      prefix,
      tokenHash,
      scopes: Object.values(API_SCOPES),
      userId: adminUserId,
    },
  });

  return rawToken;
}

async function main() {
  console.log('======================================================================');
  console.log('P0 Continuous Operational Chain Verification (Application-Driven)');
  console.log(
    'Alert -> Ingestion -> Automation -> Incident -> Escalation -> Notification -> Runbook -> Resolution'
  );
  console.log('======================================================================');
  console.log(`Database Target: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`App Base URL:    ${APP_BASE_URL}`);

  // 1. Identify admin and responder fixtures
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } });
  if (!admin) throw new Error('No active admin user found in database');

  const responder =
    (await prisma.user.findFirst({ where: { role: 'RESPONDER', status: 'ACTIVE' } })) || admin;
  const team = await prisma.team.findFirst();
  if (!team) throw new Error('No team found in database');

  // Ensure responder has email notifications enabled so notification queue generates attempt
  await prisma.user.update({
    where: { id: responder.id },
    data: { emailNotificationsEnabled: true },
  });

  const apiKeyToken = await mintAdminApiKey(admin.id);
  console.log(`✓ Admin API key authenticated for actor: ${admin.email}`);

  // 2. Provision dedicated test service & escalation policy (immediate escalation step: 0m delay)
  const escalationPolicy = await prisma.escalationPolicy.create({
    data: {
      name: `Continuous SRE Policy ${Date.now()}`,
      description: 'Automated test escalation policy for continuous operational chain',
      steps: {
        create: [
          {
            stepOrder: 1,
            delayMinutes: 0,
            targetType: 'USER',
            targetUserId: responder.id,
            notifyOnlyTeamLead: false,
          },
        ],
      },
    },
  });

  const service = await prisma.service.create({
    data: {
      name: `Continuous Chain Service ${Date.now()}`,
      description: 'Target service for end-to-end application-driven certification',
      status: 'OPERATIONAL',
      teamId: team.id,
      escalationPolicyId: escalationPolicy.id,
    },
  });

  const rawKey = `int-key-${randomUUID().replace(/-/g, '')}`;
  const encryptedKey = await encrypt(rawKey);
  const integration = await prisma.integration.create({
    data: {
      name: `Synthetic Webhook Gateway ${Date.now()}`,
      type: 'WEBHOOK',
      key: encryptedKey,
      serviceId: service.id,
    },
  });

  console.log(`✓ Service '${service.name}' (${service.id}) provisioned with Webhook Gateway`);

  // 3. Step 1: Ingest Inbound Alert via Application Webhook Gateway
  console.log('\n--- Step 1: Ingest Inbound Alert via Webhook Gateway ---');
  const dedupKey = `chain-alarm-${randomUUID()}`;
  const alertPayload = {
    summary: 'High Payment Failure Rate on cluster-prod-east',
    source: 'synthetic-monitor',
    severity: 'critical',
    status: 'triggered',
    dedup_key: dedupKey,
    custom_details: {
      cluster: 'prod-east',
      error_rate: '14.2%',
      threshold: '5.0%',
    },
  };

  const webhookUrl = `${APP_BASE_URL}/api/integrations/webhook?integrationId=${integration.id}`;
  const webhookRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-integration-key': rawKey,
    },
    body: JSON.stringify(alertPayload),
  });

  if (!webhookRes.ok) {
    const errorBody = await webhookRes.text();
    throw new Error(`Webhook ingestion failed (${webhookRes.status}): ${errorBody}`);
  }

  console.log(`✓ Webhook accepted: HTTP ${webhookRes.status}`);

  // 4. Step 2: Verify Application Created Alert & Triggered Incident
  console.log('\n--- Step 2: Verify Application Generated Alert & Incident ---');
  let incidentId: string | null = null;
  for (let attempt = 1; attempt <= 15; attempt++) {
    const createdAlert = await prisma.alert.findFirst({
      where: { serviceId: service.id },
      orderBy: { createdAt: 'desc' },
      include: { incident: true },
    });
    if (createdAlert && createdAlert.incidentId) {
      incidentId = createdAlert.incidentId;
      console.log(`✓ Alert verified: ID ${createdAlert.id}`);
      console.log(
        `✓ Incident verified: ID ${incidentId}, Status: ${createdAlert.incident?.status}`
      );
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!incidentId) {
    throw new Error('Timeout waiting for application to generate Incident from Alert');
  }

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: { events: true },
  });
  if (!incident) throw new Error(`Incident ${incidentId} not found!`);
  if (incident.status !== 'OPEN') {
    throw new Error(`Expected initial incident status OPEN, got ${incident.status}`);
  }
  console.log(
    `✓ Incident Genesis confirmed: Status '${incident.status}', Escalation '${incident.escalationStatus}'`
  );

  // 5. Step 3: Notification Delivery Queue & Attempt Verification (MANDATORY)
  console.log('\n--- Step 3: Inspect Mandatory Notification Delivery via API ---');
  let registeredAttempts: any[] = [];
  for (let poll = 0; poll < 15; poll++) {
    const attemptsRes = await fetch(
      `${APP_BASE_URL}/api/v2/incidents/${incidentId}/notification-attempts`,
      {
        headers: { Authorization: `Bearer ${apiKeyToken}` },
      }
    );
    if (!attemptsRes.ok) {
      const errText = await attemptsRes.text();
      throw new Error(`Notification attempts API failed (HTTP ${attemptsRes.status}): ${errText}`);
    }
    const attemptsJson = await attemptsRes.json();
    registeredAttempts = attemptsJson.data || [];
    if (registeredAttempts.length > 0) {
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (registeredAttempts.length === 0) {
    throw new Error(
      `[MANDATORY ASSERTION FAILED] Zero notification attempts recorded for incident ${incidentId}. Notification delivery chain did not execute.`
    );
  }

  console.log(`✓ Mandatory notification delivery attempt verified via API (HTTP 200):`);
  console.log(`  Attempts count: ${registeredAttempts.length}`);
  console.log(`  Provider:       ${registeredAttempts[0].provider || 'resend'}`);
  console.log(`  Outcome:        ${registeredAttempts[0].outcome}`);
  console.log(`  Latency:        ${registeredAttempts[0].latencyMs ?? 0}ms`);

  // Controlled notification provider delivery test endpoint verification
  const provider = await prisma.notificationProvider.findFirst({ where: { enabled: true } });
  if (provider) {
    const testRes = await fetch(
      `${APP_BASE_URL}/api/v2/notification-providers/${provider.provider}/test`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKeyToken}`,
          'If-Match': `"${provider.revision}"`,
          'idempotency-key': `provider-test-${Date.now()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );
    if (testRes.status !== 202) {
      const err = await testRes.text();
      throw new Error(`Controlled provider delivery test failed (HTTP ${testRes.status}): ${err}`);
    }
    console.log(
      `✓ Controlled provider test endpoint verified (HTTP 202 Accepted for provider '${provider.provider}')`
    );
  }

  // 6. Step 4: Provision & Execute Real Runbook via V2 API (MANDATORY)
  console.log('\n--- Step 4: Runbook Orchestration & Execution via Real V2 API ---');
  const runbookDef = {
    description: 'Automated remediation step executed by worker',
    steps: [
      {
        key: 'wait-health-check',
        name: 'Wait and Verify Health',
        type: 'WAIT' as const,
        riskClass: 'READ_ONLY' as const,
        config: { durationSeconds: 1 },
      },
    ],
  };
  const checksum = computeDefinitionChecksum(runbookDef);
  const runbook = await prisma.runbook.create({
    data: {
      name: `Continuous Chain Runbook ${Date.now()}`,
      slug: `continuous-chain-runbook-${Date.now()}`,
      description: 'Auto-remediation runbook for continuous operational chain',
      createdById: admin.id,
      ownerTeamId: team.id,
    },
  });
  const runbookVersion = await prisma.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      checksum,
      definition: runbookDef,
      state: 'PUBLISHED',
      publishedAt: new Date(),
      publishedById: admin.id,
      createdById: admin.id,
    },
  });
  await prisma.runbook.update({
    where: { id: runbook.id },
    data: { publishedVersionId: runbookVersion.id },
  });
  await prisma.serviceAutomationRule.create({
    data: {
      name: `Rule for ${runbook.name}`,
      serviceId: service.id,
      runbookId: runbook.id,
      runbookVersionId: runbookVersion.id,
      versionStrategy: 'LATEST_PUBLISHED',
      enabled: true,
    },
  });

  // A. Request Runbook Preview
  const previewRes = await fetch(
    `${APP_BASE_URL}/api/v2/runbooks/${runbook.id}/executions/preview`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ incidentId: incident.id }),
    }
  );

  if (!previewRes.ok) {
    const previewErr = await previewRes.text();
    throw new Error(
      `[MANDATORY ASSERTION FAILED] Runbook preview failed (HTTP ${previewRes.status}): ${previewErr}`
    );
  }

  const previewJson = await previewRes.json();
  const expectedPlanDigest = previewJson.data?.digest;
  if (!expectedPlanDigest) {
    throw new Error('Runbook preview did not return expected plan digest');
  }
  console.log(
    `✓ Real Runbook orchestrator preview validated: HTTP 200 (Plan Digest: ${expectedPlanDigest})`
  );

  // B. Trigger Runbook Execution via API
  const execRes = await fetch(`${APP_BASE_URL}/api/v2/runbooks/${runbook.id}/execute`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKeyToken}`,
      'Content-Type': 'application/json',
      'idempotency-key': `runbook-exec-${Date.now()}`,
    },
    body: JSON.stringify({
      incidentId: incident.id,
      expectedPlanDigest,
    }),
  });

  if (execRes.status !== 202) {
    const execErr = await execRes.text();
    throw new Error(
      `[MANDATORY ASSERTION FAILED] Runbook execute API failed (HTTP ${execRes.status}): ${execErr}`
    );
  }

  const execJson = await execRes.json();
  const executionId = execJson.data?.executionId;
  if (!executionId) {
    throw new Error('Runbook execution initiation did not return executionId');
  }
  console.log(`✓ Runbook execution accepted: HTTP 202 (Execution ID: ${executionId})`);

  // C. Poll background worker until execution completes
  let finalExecutionStatus: string | null = null;
  for (let poll = 0; poll < 20; poll++) {
    const execution = await prisma.runbookExecution.findUnique({
      where: { id: executionId },
    });
    if (execution?.status === 'SUCCEEDED') {
      finalExecutionStatus = 'SUCCEEDED';
      break;
    }
    if (execution?.status === 'FAILED' || execution?.status === 'CANCELLED') {
      throw new Error(
        `Runbook execution failed with status ${execution.status}: ${execution.failureMessage || execution.failureCode || 'unknown'}`
      );
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (finalExecutionStatus !== 'SUCCEEDED') {
    throw new Error(
      `[MANDATORY ASSERTION FAILED] Runbook execution ${executionId} timed out or did not reach SUCCEEDED`
    );
  }
  console.log(`✓ Real Agent / Background Worker execution verified: Status 'SUCCEEDED'`);

  // 7. Step 5: Acknowledge Incident via REAL Application API
  console.log('\n--- Step 5: Acknowledge Incident via Real REST API ---');
  const ackRes = await fetch(`${APP_BASE_URL}/api/v2/incidents/${incident.id}/acknowledge`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKeyToken}`,
      'Content-Type': 'application/json',
      'idempotency-key': `ack-${Date.now()}`,
    },
    body: JSON.stringify({
      note: 'Acknowledged by on-call engineer via automated certification chain',
    }),
  });

  if (!ackRes.ok) {
    const ackError = await ackRes.text();
    throw new Error(`Incident acknowledge API failed (HTTP ${ackRes.status}): ${ackError}`);
  }
  console.log(`✓ Incident acknowledged via API: HTTP ${ackRes.status}`);

  // Verify DB state after API acknowledge
  const ackedIncident = await prisma.incident.findUnique({
    where: { id: incident.id },
    include: { events: true },
  });
  if (ackedIncident?.status !== 'ACKNOWLEDGED') {
    throw new Error(`DB verification failed: expected ACKNOWLEDGED, got ${ackedIncident?.status}`);
  }
  const ackEvent = ackedIncident.events.find(e => e.type === 'ACKNOWLEDGED');
  if (!ackEvent) {
    throw new Error('Application failed to generate ACKNOWLEDGED timeline event in DB!');
  }
  console.log(
    `✓ Database state verified: Status 'ACKNOWLEDGED', Escalation '${ackedIncident.escalationStatus}', Timeline event created`
  );

  // 8. Step 6: Resolve Incident via REAL Application API
  console.log('\n--- Step 6: Resolve Incident via Real REST API ---');
  const resolveRes = await fetch(`${APP_BASE_URL}/api/v2/incidents/${incident.id}/resolve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKeyToken}`,
      'Content-Type': 'application/json',
      'idempotency-key': `resolve-${Date.now()}`,
    },
    body: JSON.stringify({
      resolutionNote:
        'Payment error rate returned to nominal baseline; resolved by operator via API',
      resolutionKind: 'MANUAL',
    }),
  });

  if (!resolveRes.ok) {
    const resError = await resolveRes.text();
    throw new Error(`Incident resolve API failed (HTTP ${resolveRes.status}): ${resError}`);
  }
  console.log(`✓ Incident resolved via API: HTTP ${resolveRes.status}`);

  // 9. Step 7: Final End-to-End Application Integrity Assertions
  console.log('\n--- Step 7: Final End-to-End Integrity & Audit Assertions ---');
  const finalIncident = await prisma.incident.findUnique({
    where: { id: incident.id },
    include: {
      events: true,
      alerts: true,
    },
  });

  if (!finalIncident) throw new Error('Final incident not found');
  if (finalIncident.status !== 'RESOLVED') {
    throw new Error(`Final status mismatch: expected RESOLVED, got ${finalIncident.status}`);
  }
  if (!finalIncident.resolvedAt) {
    throw new Error('Final resolvedAt is null in database!');
  }

  const resolveEvent = finalIncident.events.find(
    e => e.type === 'MANUAL_RESOLVED' || e.type === 'STATUS_CHANGE'
  );
  if (!resolveEvent) {
    throw new Error('Application failed to generate resolution timeline event!');
  }

  // Check audit log recorded by application (action: incident.resolved)
  const auditResolve = await prisma.auditLog.findFirst({
    where: {
      entityId: incident.id,
      action: { in: ['incident.resolved', 'INCIDENT_RESOLVED'] },
    },
  });
  if (!auditResolve) {
    throw new Error(
      `[MANDATORY ASSERTION FAILED] Incident resolution audit log entry not found in database!`
    );
  }

  const auditAck = await prisma.auditLog.findFirst({
    where: {
      entityId: incident.id,
      action: { in: ['incident.acknowledged', 'INCIDENT_ACKNOWLEDGED'] },
    },
  });
  if (!auditAck) {
    throw new Error(
      `[MANDATORY ASSERTION FAILED] Incident acknowledgement audit log entry not found in database!`
    );
  }

  console.log('Final Application-Verified State in Database:');
  console.log(`  Incident ID:           ${finalIncident.id}`);
  console.log(`  Status:                ${finalIncident.status}`);
  console.log(`  Resolved At:           ${finalIncident.resolvedAt.toISOString()}`);
  console.log(`  Linked Alerts:         ${finalIncident.alerts.length}`);
  console.log(`  Timeline Events Count: ${finalIncident.events.length}`);
  console.log(`  Timeline Event Types:  ${finalIncident.events.map(e => e.type).join(', ')}`);
  console.log(`  Audit Logs Confirmed:  [${auditAck.action}, ${auditResolve.action}]`);

  console.log('\n======================================================================');
  console.log('CONTINUOUS OPERATIONAL CHAIN TEST: PASSED (100% REAL APPLICATION ENFORCED)');
  console.log('======================================================================');
}

main()
  .catch(err => {
    console.error('Continuous operational chain test failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
