import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

const DATABASE_URL = 'postgresql://opsknight:bf5efc57520313b61b4950d1ebf4f355@127.0.0.1:55490/opsknight?sslmode=disable';
const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } }
});

async function main() {
  const fixturesPath = path.resolve('tests/certification/fixtures.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

  console.log('Seeding extended fixtures into DB...');

  // 1. Integration
  const integration = await prisma.integration.create({
    data: {
      name: `Cert Events Integration ${Date.now()}`,
      serviceId: fixtures.services.serviceAId,
      key: `cert-key-${Date.now()}`,
      type: 'EVENTS_API_V2',
      enabled: true
    }
  });

  // 2. Incident Template
  const template = await prisma.incidentTemplate.create({
    data: {
      name: `Cert Template ${Date.now()}`,
      title: 'Database Failover Incident',
      defaultServiceId: fixtures.services.serviceAId,
      createdById: fixtures.users.adminId,
      isPublic: true
    }
  });

  // 3. Runbook Agent Pool & Agent
  const agentPool = await prisma.runbookAgentPool.create({
    data: {
      name: `Cert Agent Pool ${Date.now()}`,
      description: 'Certification runner worker pool',
      createdById: fixtures.users.adminId
    }
  });

  const agent = await prisma.runbookAgent.create({
    data: {
      name: `Cert Agent ${Date.now()}`,
      status: 'ONLINE',
      createdById: fixtures.users.adminId
    }
  });

  const agentPoolMember = await prisma.runbookAgentPoolMember.create({
    data: {
      poolId: agentPool.id,
      agentId: agent.id
    }
  });

  // 4. Runbook Secret & Grant
  const secret = await prisma.runbookSecret.create({
    data: {
      name: `CERT_API_SECRET_${Date.now()}`,
      valueEncrypted: 'enc_cert_secret_value',
      description: 'Encrypted token for runbooks',
      createdById: fixtures.users.adminId
    }
  });

  const secretGrant = await prisma.runbookSecretGrant.create({
    data: {
      secretId: secret.id,
      agentPoolId: agentPool.id
    }
  });

  // 5. Service Objective
  let objective = await prisma.serviceObjective.findFirst({
    where: { serviceId: fixtures.services.serviceAId, metricType: 'AVAILABILITY' }
  });
  if (!objective) {
    objective = await prisma.serviceObjective.create({
      data: {
        lineageId: `cert-lineage-${Date.now()}`,
        serviceId: fixtures.services.serviceAId,
        name: '99.9% Uptime Target',
        metricType: 'AVAILABILITY',
        target: 99.9,
        comparator: 'GREATER_THAN_OR_EQUAL',
        windowType: 'ROLLING_DAYS',
        windowValue: 30
      }
    });
  }

  // 6. Status Page Subscription & Asset
  const subscriber = await prisma.statusPageSubscription.create({
    data: {
      statusPageId: fixtures.statusPages.statusPageId,
      email: `subscriber-${Date.now()}@example.com`,
      token: `cert-sub-token-${Date.now()}`,
      state: 'ACTIVE',
      verified: true
    }
  });

  const asset = await prisma.statusPageAsset.create({
    data: {
      id: `cert-logo-${Date.now()}`,
      statusPageId: fixtures.statusPages.statusPageId,
      contentType: 'image/png',
      data: Buffer.from('mock_png_binary_data')
    }
  });

  // 7. Incident Watcher
  let watcher = await prisma.incidentWatcher.findFirst({
    where: { incidentId: fixtures.incidents.openId, userId: fixtures.users.responderId }
  });
  if (!watcher) {
    watcher = await prisma.incidentWatcher.create({
      data: {
        incidentId: fixtures.incidents.openId,
        userId: fixtures.users.responderId,
        role: 'FOLLOWER'
      }
    });
  }

  // 8. Action Item
  let actionItem = await prisma.actionItem.findFirst({
    where: { postmortemId: fixtures.postmortems.postmortemId }
  });
  if (!actionItem) {
    actionItem = await prisma.actionItem.create({
      data: {
        incidentId: fixtures.incidents.resolvedId,
        postmortemId: fixtures.postmortems.postmortemId,
        title: 'Audit redis max-memory and key TTL policies',
        status: 'OPEN',
        priority: 'HIGH'
      }
    });
  }

  // 9. Schedule Override
  let override = await prisma.onCallOverride.findFirst({
    where: { scheduleId: fixtures.schedules.scheduleAId, userId: fixtures.users.responderId }
  });
  if (!override) {
    override = await prisma.onCallOverride.create({
      data: {
        scheduleId: fixtures.schedules.scheduleAId,
        userId: fixtures.users.responderId,
        start: new Date(Date.now() + 3600000),
        end: new Date(Date.now() + 86400000)
      }
    });
  }

  // 10. Runbook Version and Execution
  const runbookVersion = await prisma.runbookVersion.findFirst({
    where: { runbookId: fixtures.runbooks.runbookId }
  });

  let runbookExecution = await prisma.runbookExecution.findFirst({
    where: { runbookId: fixtures.runbooks.runbookId, incidentId: fixtures.incidents.openId }
  });
  if (!runbookExecution) {
    runbookExecution = await prisma.runbookExecution.create({
      data: {
        runbookId: fixtures.runbooks.runbookId,
        runbookVersionId: runbookVersion!.id,
        incidentId: fixtures.incidents.openId,
        deadlineAt: new Date(Date.now() + 7200000),
        definitionChecksum: 'test-checksum-v1',
        triggeredByUserId: fixtures.users.adminId,
        status: 'QUEUED'
      }
    });
  }

  // 11. Runbook Execution Signing Key
  let signingKey = await prisma.runbookExecutionSigningKey.findFirst({
    where: { state: 'ACTIVE' }
  });
  if (!signingKey) {
    signingKey = await prisma.runbookExecutionSigningKey.create({
      data: {
        id: `cert-sig-key-${Date.now()}`,
        publicKey: 'mock-ed25519-public-key',
        privateKeyEncrypted: 'mock-ed25519-private-key-encrypted',
        state: 'ACTIVE',
        activatedAt: new Date()
      }
    });
  }

  // 12. Query layer and escalation rule
  const layer = await prisma.onCallLayer.findFirst({
    where: { scheduleId: fixtures.schedules.scheduleAId }
  });
  const escalationRule = await prisma.escalationRule.findFirst({
    where: { policyId: fixtures.escalationPolicies.policyAId }
  });

  // 13. Service Automation Rule
  let rule = await prisma.serviceAutomationRule.findFirst({
    where: { serviceId: fixtures.services.serviceAId }
  });
  if (!rule) {
    rule = await prisma.serviceAutomationRule.create({
      data: {
        serviceId: fixtures.services.serviceAId,
        runbookId: fixtures.runbooks.runbookId,
        name: 'Cert Automation Rule',
        enabled: true,
        mode: 'MANUAL',
        versionStrategy: 'LATEST_PUBLISHED'
      }
    });
  }

  // 14. CustomFieldValue & AutomationDecision
  await prisma.customFieldValue.upsert({
    where: {
      incidentId_customFieldId: {
        incidentId: fixtures.incidents.openId,
        customFieldId: fixtures.customFields.envFieldId
      }
    },
    create: {
      incidentId: fixtures.incidents.openId,
      customFieldId: fixtures.customFields.envFieldId,
      value: 'production'
    },
    update: { value: 'production' }
  });

  await prisma.incidentAutomationDecision.upsert({
    where: { incidentId: fixtures.incidents.openId },
    create: {
      incidentId: fixtures.incidents.openId,
      serviceId: fixtures.services.serviceAId,
      mode: 'LIVE',
      routeType: 'ESCALATION_POLICY',
      escalationPolicyId: fixtures.escalationPolicies.policyAId,
      basePriority: 'P1',
      finalPriority: 'P1',
      evaluationAt: new Date(),
      summary: { note: 'Auto routed by cert' }
    },
    update: { mode: 'LIVE' }
  });

  // 15. Web Push Provider
  await prisma.notificationProvider.upsert({
    where: { provider: 'web-push' },
    create: {
      provider: 'web-push',
      enabled: true,
      config: {
        vapidPublicKey: 'BCm0w_mock_vapid_public_key_for_testing_purposes_only_1234567890',
        vapidPrivateKey: 'mock_priv_key_cert',
        vapidSubject: 'mailto:admin@opsknight.local'
      },
      revision: 1
    },
    update: { enabled: true }
  });

  // 16. Runbook Draft Version 2
  let draftVersion = await prisma.runbookVersion.findFirst({
    where: { runbookId: fixtures.runbooks.runbookId, state: 'DRAFT' }
  });
  if (!draftVersion) {
    draftVersion = await prisma.runbookVersion.create({
      data: {
        runbookId: fixtures.runbooks.runbookId,
        version: 2,
        state: 'DRAFT',
        definition: {
          description: 'Production recovery steps',
          steps: [{ key: 'step_drain', name: 'Drain connections', type: 'MANUAL', riskClass: 'READ_ONLY', config: {} }]
        },
        checksum: 'checksum-draft-v2',
        draftRevision: 0,
        createdById: fixtures.users.adminId
      }
    });
  }

  fixtures.integrations = { integrationId: integration.id };
  fixtures.templates = { templateId: template.id };
  fixtures.agentPools = { poolId: agentPool.id, agentId: agent.id, memberId: agentPoolMember.id };
  fixtures.runbookSecrets = { secretId: secret.id, grantId: secretGrant.id };
  fixtures.objectives = { objectiveId: objective.id, lineageId: objective.lineageId };
  fixtures.subscribers = { subscriberId: subscriber.id };
  fixtures.assets = { assetId: asset.id };
  fixtures.watchers = { watcherId: watcher.id };
  fixtures.actionItems = { actionItemId: actionItem.id };
  fixtures.overrides = { overrideId: override.id };
  fixtures.runbookVersions = { versionId: runbookVersion!.id };
  fixtures.runbookExecutions = { executionId: runbookExecution.id };
  fixtures.signingKeys = { keyId: signingKey.id };
  fixtures.scheduleLayers = { layerId: layer!.id };
  fixtures.escalationRules = { ruleId: escalationRule!.id };
  fixtures.serviceRunbookRules = { ruleId: rule.id };
  fixtures.runbookDrafts = { draftVersionId: draftVersion.id };
  fixtures.auditExports = { exportId: 'cmvmdw7fn014kjq5tb3na5pw8' };

  fs.writeFileSync(fixturesPath, JSON.stringify(fixtures, null, 2));
  console.log('Seeded extended fixtures successfully! Updated fixtures.json');
}

main()
  .catch(err => {
    console.error('Failed seeding extended fixtures:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
