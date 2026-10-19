import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { processIntegrationEvent, type EventPayload } from '@/lib/events';
import { saveDraft, publishVersion, changeMode } from '@/lib/automation/versioning';
import type { Snapshot } from '@/lib/automation/contract';
import {
  buildResponseContext,
  parseResponseContext,
  readIncidentResponseContext,
} from '@/lib/automation/response-context';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const snapshot: Snapshot = {
  schemaVersion: 1,
  fields: [
    {
      fieldId: 'env',
      key: 'environment',
      label: 'Environment',
      type: 'ENUM',
      caseSensitive: false,
      allowedValues: ['production', 'staging'],
      aliases: { prd: 'production' },
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.environment' }],
    },
    {
      fieldId: 'tier',
      key: 'tier',
      label: 'Tier',
      type: 'ENUM',
      caseSensitive: false,
      allowedValues: ['gold', 'silver'],
      aliases: {},
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.tier' }],
    },
    {
      fieldId: 'cluster',
      key: 'cluster',
      label: 'Cluster',
      type: 'STRING',
      caseSensitive: true,
      aliases: {},
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.cluster' }],
    },
    {
      fieldId: 'replicas',
      key: 'replicas',
      label: 'Replicas',
      type: 'NUMBER',
      caseSensitive: false,
      aliases: {},
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.replicas' }],
    },
    {
      fieldId: 'canary',
      key: 'canary',
      label: 'Canary',
      type: 'BOOLEAN',
      caseSensitive: false,
      aliases: {},
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.canary' }],
    },
    {
      fieldId: 'zone',
      key: 'zone',
      label: 'Zone',
      type: 'STRING',
      caseSensitive: true,
      aliases: {},
      mappings: [{ source: 'EVENT', path: 'payload.custom_details.zone' }],
    },
  ],
  rules: [
    {
      id: 'prod',
      name: 'Production',
      phase: 'ENRICH',
      enabled: true,
      conditions: [{ fieldKey: 'environment', operator: 'EQ', value: 'production' }],
      actions: [{ type: 'SET_PRIORITY', value: 'P1' }],
    },
  ],
};

async function automatedService(mode: 'LIVE' | 'SHADOW') {
  const service = await db.service.create({ data: { name: `Context ${crypto.randomUUID()}` } });
  const actor = await createTestUser({ role: 'ADMIN' });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: actor.id,
    snapshot,
    expectedRevision: 0,
  });
  const version = await publishVersion({
    serviceId: service.id,
    actorId: actor.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  await changeMode({
    serviceId: service.id,
    actorId: actor.id,
    mode,
    acknowledgeNoShadow: true,
    expectedActiveVersionId: version.id,
  });
  return { service, version };
}

async function ingest(serviceId: string, details: Record<string, unknown>) {
  const event: EventPayload = {
    event_action: 'trigger',
    dedup_key: crypto.randomUUID(),
    payload: {
      summary: 'Database saturation',
      source: 'monitor',
      severity: 'error',
      custom_details: { ...details, api_token: 'raw-secret-token' },
    },
  };
  const result = await processIntegrationEvent({
    serviceId,
    integrationId: 'response-context',
    integrationType: 'EVENTS_API',
    event: structuredClone(event),
    providerPayload: { ...event, headers: { authorization: 'Bearer raw-header-secret' } },
    receivedAt: new Date(),
  });
  return result.incident!.id;
}

describeIfRealDB('incident response context (real PostgreSQL)', () => {
  beforeAll(async () => {
    await resetDatabase();
    await db.systemSettings.upsert({
      where: { id: 'default' },
      create: { automationEnabled: true },
      update: { automationEnabled: true },
    });
  }, 600_000);
  afterAll(async () => db.$disconnect(), 60_000);

  it('stores a verifiable typed context on LIVE decisions', async () => {
    const { service, version } = await automatedService('LIVE');
    const incidentId = await ingest(service.id, {
      environment: 'PRD',
      tier: 'bronze',
      cluster: 'eu-1',
      replicas: 3,
      canary: true,
    });
    const decision = await db.incidentAutomationDecision.findUniqueOrThrow({
      where: { incidentId },
    });
    expect(decision.mode).toBe('LIVE');
    const context = parseResponseContext(decision.responseContext);
    expect(context).toMatchObject({
      schemaVersion: 1,
      versionId: version.id,
      versionNumber: version.versionNumber,
    });
    const fields = Object.fromEntries(context!.fields.map(field => [field.key, field]));
    expect(fields.environment).toEqual({
      fieldId: 'env',
      key: 'environment',
      type: 'ENUM',
      state: 'RECOGNIZED',
      value: 'production',
      source: 'ALERT',
    });
    expect(fields.cluster).toMatchObject({ type: 'STRING', state: 'RECOGNIZED', value: 'eu-1' });
    expect(fields.replicas).toMatchObject({ type: 'NUMBER', state: 'RECOGNIZED', value: 3 });
    expect(fields.canary).toMatchObject({ type: 'BOOLEAN', state: 'RECOGNIZED', value: true });
    expect(fields.tier).toMatchObject({ type: 'ENUM', state: 'UNMAPPED', value: null });
    expect(fields.zone).toMatchObject({ state: 'MISSING', value: null, source: 'NONE' });
    expect(fields.priority).toMatchObject({ value: 'P1', source: 'ENRICHMENT' });
    const serialized = JSON.stringify(decision.responseContext);
    for (const leaked of ['raw-secret-token', 'raw-header-secret', 'api_token', 'bronze'])
      expect(serialized).not.toContain(leaked);
    expect(await readIncidentResponseContext(db, incidentId)).toEqual({
      status: 'AVAILABLE',
      context,
    });
  });

  it('stores no decision context for SHADOW or fallback evaluations', async () => {
    const shadow = await automatedService('SHADOW');
    const shadowIncident = await ingest(shadow.service.id, { environment: 'production' });
    expect(
      await db.incidentAutomationDecision.count({ where: { incidentId: shadowIncident } })
    ).toBe(0);
    expect(await readIncidentResponseContext(db, shadowIncident)).toEqual({
      status: 'UNAVAILABLE',
      reason: 'NO_LIVE_DECISION',
    });

    const live = await automatedService('LIVE');
    const corrupt = await db.automationVersion.create({
      data: {
        serviceId: live.service.id,
        versionNumber: 99,
        snapshot: {},
        compiledSnapshot: {},
        checksum: 'f'.repeat(64),
        publishedBy: 'test',
        lintReport: [],
      },
    });
    await db.serviceAutomationConfig.update({
      where: { serviceId: live.service.id },
      data: { activeVersionId: corrupt.id },
    });
    const fallbackIncident = await ingest(live.service.id, { environment: 'production' });
    const decision = await db.incidentAutomationDecision.findUniqueOrThrow({
      where: { incidentId: fallbackIncident },
    });
    expect(decision.fallbackReason).not.toBeNull();
    expect(decision.responseContext).toBeNull();
    expect(await readIncidentResponseContext(db, fallbackIncident)).toEqual({
      status: 'UNAVAILABLE',
      reason: 'FALLBACK',
    });
  });

  it('reports historical rows as NOT_CAPTURED and tampered contexts as INTEGRITY_FAILED', async () => {
    const { service, version } = await automatedService('LIVE');
    const incident = await db.incident.create({
      data: { title: 'Historical', serviceId: service.id },
    });
    const base = {
      serviceId: service.id,
      versionId: version.id,
      mode: 'LIVE' as const,
      routeType: 'SERVICE_DEFAULT' as const,
      evaluationAt: new Date(),
      summary: {},
    };
    await db.incidentAutomationDecision.create({ data: { ...base, incidentId: incident.id } });
    expect(await readIncidentResponseContext(db, incident.id)).toEqual({
      status: 'UNAVAILABLE',
      reason: 'NOT_CAPTURED',
    });

    const tampered = await db.incident.create({
      data: { title: 'Tampered', serviceId: service.id },
    });
    const context = buildResponseContext({
      versionId: version.id,
      versionNumber: version.versionNumber,
      fields: [{ fieldId: 'cluster', key: 'cluster', type: 'STRING' }],
      inputContext: { cluster: { state: 'RECOGNIZED', value: 'eu-1' } },
      enrichedContext: { cluster: { state: 'RECOGNIZED', value: 'eu-1' } },
    });
    context.fields[0].value = 'us-1';
    await db.incidentAutomationDecision.create({
      data: { ...base, incidentId: tampered.id, responseContext: context },
    });
    expect(await readIncidentResponseContext(db, tampered.id)).toEqual({
      status: 'UNAVAILABLE',
      reason: 'INTEGRITY_FAILED',
    });
  });

  it('rejects a context on SHADOW, fallback or mismatched-version decisions at the database', async () => {
    const { service, version } = await automatedService('LIVE');
    const context = buildResponseContext({
      versionId: version.id,
      versionNumber: version.versionNumber,
      fields: [],
      inputContext: {},
      enrichedContext: {},
    });
    const base = {
      serviceId: service.id,
      versionId: version.id,
      routeType: 'SERVICE_DEFAULT' as const,
      evaluationAt: new Date(),
      summary: {},
      responseContext: context,
    };
    const incident = async () =>
      (await db.incident.create({ data: { title: 'Constraint', serviceId: service.id } })).id;
    const violation = /IncidentAutomationDecision_responseContext_live_check/;
    await expect(
      db.incidentAutomationDecision.create({
        data: { ...base, incidentId: await incident(), mode: 'SHADOW' },
      })
    ).rejects.toThrow(violation);
    await expect(
      db.incidentAutomationDecision.create({
        data: {
          ...base,
          incidentId: await incident(),
          mode: 'LIVE',
          fallbackReason: 'VERSION_INVALID',
        },
      })
    ).rejects.toThrow(violation);
    await expect(
      db.incidentAutomationDecision.create({
        data: { ...base, incidentId: await incident(), mode: 'LIVE', versionId: null },
      })
    ).rejects.toThrow(violation);
  });
});
