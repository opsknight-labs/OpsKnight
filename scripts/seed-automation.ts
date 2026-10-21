import { PrismaClient } from '@prisma/client';
import { compileAutomation } from '../src/lib/automation/compiler';
import { checksum } from '../src/lib/automation/cache';
import type { Snapshot } from '../src/lib/automation/contract';

const p = new PrismaClient();

async function seed() {
  const serviceId = 'cmt1xsf3c0005t37uchelbgbp';
  const user = await p.user.findFirst({ where: { role: 'ADMIN' } });
  if (!user) throw new Error('No admin user found');
  const policy = await p.escalationPolicy.findFirst();
  if (!policy) throw new Error('No escalation policy found');

  const snapshot: Snapshot = {
    schemaVersion: 1,
    fields: [
      {
        fieldId: 'fld_env',
        key: 'environment',
        label: 'Deployment Environment',
        type: 'ENUM',
        caseSensitive: false,
        allowedValues: ['production', 'staging', 'development'],
        aliases: { prod: 'production', prd: 'production', stage: 'staging', dev: 'development' },
        mappings: [
          { source: 'EVENT', path: 'payload.custom_details.env' },
          { source: 'PROVIDER', path: 'labels.environment' },
        ],
      },
      {
        fieldId: 'fld_tier',
        key: 'service_tier',
        label: 'Service Criticality Tier',
        type: 'ENUM',
        caseSensitive: false,
        allowedValues: ['tier_0', 'tier_1', 'tier_2', 'tier_3'],
        aliases: { t0: 'tier_0', t1: 'tier_1', critical: 'tier_0' },
        mappings: [{ source: 'EVENT', path: 'payload.custom_details.tier' }],
      },
      {
        fieldId: 'fld_customer_impact',
        key: 'customer_impact',
        label: 'Customer Facing Impact',
        type: 'BOOLEAN',
        caseSensitive: false,
        aliases: {},
        mappings: [
          { source: 'EVENT', path: 'payload.custom_details.customer_impact' },
          { source: 'PROVIDER', path: 'annotations.customer_facing' },
        ],
      },
      {
        fieldId: 'fld_error_rate',
        key: 'error_rate',
        label: 'HTTP Error Rate (%)',
        type: 'NUMBER',
        caseSensitive: false,
        aliases: {},
        mappings: [{ source: 'EVENT', path: 'payload.custom_details.error_rate_pct' }],
      },
      {
        fieldId: 'fld_region',
        key: 'region',
        label: 'Cloud Region',
        type: 'ENUM',
        caseSensitive: false,
        allowedValues: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'],
        aliases: { useast: 'us-east-1', uswest: 'us-west-2', eu: 'eu-west-1', ap: 'ap-south-1' },
        mappings: [{ source: 'EVENT', path: 'payload.custom_details.region' }],
      },
      {
        fieldId: 'fld_cluster',
        key: 'cluster_name',
        label: 'Kubernetes Cluster',
        type: 'STRING',
        caseSensitive: false,
        aliases: {},
        mappings: [
          { source: 'EVENT', path: 'payload.custom_details.cluster' },
          { source: 'PROVIDER', path: 'labels.k8s_cluster' },
        ],
      },
    ],
    rules: [
      {
        id: 'rule_prod_crit',
        name: 'Tag Production Critical Infrastructure',
        phase: 'ENRICH',
        enabled: true,
        conditions: [
          { fieldKey: 'environment', operator: 'EQ', value: 'production' },
          { fieldKey: 'customer_impact', operator: 'EQ', value: true },
        ],
        actions: [
          { type: 'SET_PRIORITY', value: 'P1' },
          { type: 'ADD_TAG', value: 'critical-production' },
          { type: 'ADD_TAG', value: 'high-blast-radius' },
        ],
      },
      {
        id: 'rule_high_error',
        name: 'Elevate High Error Rate Anomalies',
        phase: 'ENRICH',
        enabled: true,
        conditions: [{ fieldKey: 'error_rate', operator: 'GTE', value: 5 }],
        actions: [
          { type: 'SET_PRIORITY', value: 'P1' },
          { type: 'ADD_TAG', value: 'sla-breach-risk' },
        ],
      },
      {
        id: 'rule_nonprod_demote',
        name: 'Stage & Dev Environment Demotion',
        phase: 'ENRICH',
        enabled: true,
        conditions: [
          { fieldKey: 'environment', operator: 'IN', value: ['staging', 'development'] },
        ],
        actions: [
          { type: 'SET_PRIORITY', value: 'P4' },
          { type: 'ADD_TAG', value: 'non-production' },
        ],
      },
      {
        id: 'rule_route_prod',
        name: 'Route Critical Incidents to Primary On-Call',
        phase: 'ROUTE',
        enabled: true,
        conditions: [
          { fieldKey: 'environment', operator: 'EQ', value: 'production' },
          { fieldKey: 'customer_impact', operator: 'EQ', value: true },
        ],
        actions: [{ type: 'USE_ESCALATION_POLICY', policyId: policy.id }],
      },
      {
        id: 'rule_route_nonprod',
        name: 'Suppress Non-Production Escalations',
        phase: 'ROUTE',
        enabled: true,
        conditions: [
          { fieldKey: 'environment', operator: 'IN', value: ['staging', 'development'] },
        ],
        actions: [{ type: 'NO_ESCALATION' }],
      },
      {
        id: 'rule_route_default',
        name: 'Default Service Routing Fallback',
        phase: 'ROUTE',
        enabled: true,
        conditions: [{ fieldKey: 'environment', operator: 'IS_SET' }],
        actions: [{ type: 'USE_SERVICE_DEFAULT' }],
      },
    ],
  };

  const compiled = compileAutomation(snapshot);
  const hash = checksum(snapshot);

  console.log('Compiled snapshot successfully. Issue count:', compiled.issues.length);

  // Clean old dependent data (shadow aggregates, draft, config)
  await p.automationTrace.deleteMany({ where: { serviceId } });
  await p.automationShadowAggregate.deleteMany({ where: { serviceId } });
  await p.incidentAutomationDecision.deleteMany({ where: { serviceId } });
  await p.serviceAutomationConfig.deleteMany({ where: { serviceId } });
  await p.automationDraft.deleteMany({ where: { serviceId } });

  // Find or create versions
  let v2 = await p.automationVersion.findFirst({
    where: { serviceId, versionNumber: 2 },
  });

  if (!v2) {
    let v1 = await p.automationVersion.findFirst({ where: { serviceId, versionNumber: 1 } });
    if (!v1) {
      v1 = await p.automationVersion.create({
        data: {
          serviceId,
          versionNumber: 1,
          schemaVersion: 1,
          snapshot: snapshot as any,
          compiledSnapshot: compiled.compiled as any,
          checksum: hash,
          publishedBy: user.id,
          publishedAt: new Date(Date.now() - 48 * 3600 * 1000),
          lintReport: compiled.issues as any,
          policyRefs: {
            create: [
              {
                escalationPolicyId: policy.id,
                policyNameSnapshot: policy.name,
                ruleReferences: ['rule_route_prod'],
              },
            ],
          },
        },
      });
    }

    v2 = await p.automationVersion.create({
      data: {
        serviceId,
        versionNumber: 2,
        schemaVersion: 1,
        snapshot: snapshot as any,
        compiledSnapshot: compiled.compiled as any,
        checksum: hash,
        publishedBy: user.id,
        publishedAt: new Date(Date.now() - 2 * 3600 * 1000),
        lintReport: compiled.issues as any,
        policyRefs: {
          create: [
            {
              escalationPolicyId: policy.id,
              policyNameSnapshot: policy.name,
              ruleReferences: ['rule_route_prod'],
            },
          ],
        },
      },
    });
  }

  // Create Draft
  const draft = await p.automationDraft.create({
    data: {
      serviceId,
      schemaVersion: 1,
      snapshot: snapshot as any,
      revision: 4,
      updatedBy: user.id,
      updatedAt: new Date(),
    },
  });

  // Update System Settings to ensure Global Automation switch is ON
  await p.systemSettings.upsert({
    where: { id: 'default' },
    update: { automationEnabled: true },
    create: { id: 'default', automationEnabled: true },
  });

  // Create ServiceAutomationConfig with LIVE mode
  await p.serviceAutomationConfig.create({
    data: {
      serviceId,
      mode: 'LIVE',
      activeVersionId: v2.id,
      draftId: draft.id,
      revision: 4,
      updatedBy: user.id,
    },
  });

  // Seed shadow aggregates for 7 days
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() - i * 86400 * 1000);
    const bucketDate = new Date(d.toISOString().slice(0, 10));
    await p.automationShadowAggregate.create({
      data: {
        serviceId,
        versionId: v2.id,
        bucketDate,
        evaluated: 320 + Math.floor(Math.random() * 80),
        same: 300 + Math.floor(Math.random() * 70),
        routeDifferent: 12 + Math.floor(Math.random() * 8),
        priorityDifferent: 8 + Math.floor(Math.random() * 4),
        noEscalationDifferent: 2,
        fallbacks: 0,
        errors: 0,
      },
    });
  }

  await p.automationContextObservation.deleteMany({ where: { serviceId } });
  const crypto = await import('crypto');

  const obs = [
    {
      fieldKey: 'environment',
      path: 'payload.custom_details.env',
      integrationType: 'EVENTS_API',
      source: 'EVENT',
      sampleValue: 'production',
      seenCount: 1420,
      fieldType: 'ENUM',
    },
    {
      fieldKey: 'environment',
      path: 'labels.environment',
      integrationType: 'PROMETHEUS',
      source: 'PROVIDER',
      sampleValue: 'prod',
      seenCount: 980,
      fieldType: 'ENUM',
    },
    {
      fieldKey: 'service_tier',
      path: 'payload.custom_details.tier',
      integrationType: 'EVENTS_API',
      source: 'EVENT',
      sampleValue: 'tier_0',
      seenCount: 1100,
      fieldType: 'ENUM',
    },
    {
      fieldKey: 'customer_impact',
      path: 'payload.custom_details.customer_impact',
      integrationType: 'EVENTS_API',
      source: 'EVENT',
      sampleValue: 'true',
      seenCount: 840,
      fieldType: 'BOOLEAN',
    },
    {
      fieldKey: 'error_rate',
      path: 'payload.custom_details.error_rate_pct',
      integrationType: 'EVENTS_API',
      source: 'EVENT',
      sampleValue: '6.8',
      seenCount: 520,
      fieldType: 'NUMBER',
    },
    {
      fieldKey: 'region',
      path: 'payload.custom_details.region',
      integrationType: 'EVENTS_API',
      source: 'EVENT',
      sampleValue: 'us-east-1',
      seenCount: 1420,
      fieldType: 'ENUM',
    },
    {
      fieldKey: 'cluster_name',
      path: 'payload.custom_details.cluster',
      integrationType: 'EVENTS_API',
      source: 'EVENT',
      sampleValue: 'k8s-prod-us-east-01',
      seenCount: 1420,
      fieldType: 'STRING',
    },
    {
      fieldKey: 'cluster_name',
      path: 'labels.k8s_cluster',
      integrationType: 'PROMETHEUS',
      source: 'PROVIDER',
      sampleValue: 'k8s-prod-us-east-01',
      seenCount: 980,
      fieldType: 'STRING',
    },
    {
      fieldKey: 'alert_name',
      path: 'labels.alertname',
      integrationType: 'PROMETHEUS',
      source: 'PROVIDER',
      sampleValue: 'HighErrorRateDetected',
      seenCount: 750,
      fieldType: 'STRING',
    },
    {
      fieldKey: 'summary',
      path: 'payload.summary',
      integrationType: 'EVENTS_API',
      source: 'EVENT',
      sampleValue: 'High latency on payment gateway checkout',
      seenCount: 1420,
      fieldType: 'STRING',
    },
  ];

  for (const o of obs) {
    const hash = crypto.createHash('sha256').update(o.sampleValue).digest('hex');
    await p.automationContextObservation.create({
      data: {
        serviceId,
        integrationId: 'default',
        integrationType: o.integrationType,
        source: o.source,
        fieldKey: o.fieldKey,
        sourcePath: o.path,
        fieldType: o.fieldType,
        normalizedRawValueHash: hash,
        rawValuePreview: o.sampleValue,
        unmapped: false,
        count: o.seenCount,
        lastSeenAt: new Date(),
      },
    });
  }

  console.log('SEEDING COMPLETED SUCCESSFULLY for service:', serviceId);
}

seed()
  .catch(err => {
    console.error('SEEDING FAILED:', err);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
