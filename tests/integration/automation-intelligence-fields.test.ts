import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processIntegrationEvent, type EventPayload } from '@/lib/events';
import { saveDraft, publishVersion, changeMode } from '@/lib/automation/versioning';
import { loadReplayIntelligence } from '@/lib/automation/replay-run';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { primePrePagingSnapshot, resetPrePagingSnapshot } from '@/lib/intelligence/noise-controls';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/** J1.4: intelligence fields as automation conditions, from the snapshot, behind their own switch. */

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  resetPrePagingSnapshot();
  await resetDatabase();
});

async function setup(switchOn: boolean) {
  const admin = await createTestUser({ role: 'ADMIN' });
  await db.intelligenceSettings.create({
    data: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      enabled: true,
      automationIntelligenceFieldsEnabled: switchOn,
    },
  });
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
  const service = await db.service.create({ data: { name: `Checkout ${crypto.randomUUID()}` } });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: admin.id,
    snapshot: {
      schemaVersion: 1,
      fields: [],
      rules: [
        {
          id: 'maintenance-p5',
          name: 'Quiet during maintenance',
          phase: 'ENRICH',
          enabled: true,
          conditions: [{ fieldKey: 'inMaintenance', operator: 'EQ', value: true }],
          actions: [{ type: 'SET_PRIORITY', value: 'P5' }],
        },
        {
          id: 'risky-tag',
          name: 'Tag after a risky change',
          phase: 'ENRICH',
          enabled: true,
          conditions: [{ fieldKey: 'recentRiskyChange', operator: 'EQ', value: true }],
          actions: [{ type: 'ADD_TAG', value: 'after-risky-change' }],
        },
      ],
    },
    expectedRevision: 0,
  });
  const version = await publishVersion({
    serviceId: service.id,
    actorId: admin.id,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  await changeMode({
    serviceId: service.id,
    actorId: admin.id,
    mode: 'LIVE',
    acknowledgeNoShadow: true,
    expectedActiveVersionId: version.id,
  });
  const now = Date.now();
  await db.noiseMaintenanceWindow.create({
    data: {
      name: 'Patching',
      scope: 'SERVICE',
      serviceId: service.id,
      startsAt: new Date(now - 60_000),
      endsAt: new Date(now + 3_600_000),
      effect: 'SUPPRESS',
    },
  });
  await db.changeEvent.create({
    data: {
      serviceId: service.id,
      source: 'github',
      kind: 'DEPLOY',
      summary: 'Deploy v2',
      occurredAt: new Date(now - 10 * 60_000),
      riskScore: 0.9,
    },
  });
  return service;
}

async function ingest(serviceId: string) {
  const event: EventPayload = {
    event_action: 'trigger',
    dedup_key: crypto.randomUUID(),
    payload: { summary: 'Checkout errors', source: 'prometheus', severity: 'error' },
  };
  const result = await processIntegrationEvent({
    serviceId,
    integrationId: 'intel-fields-it',
    integrationType: 'EVENTS_API',
    event: structuredClone(event),
    providerPayload: event,
    receivedAt: new Date(),
  });
  return db.incident.findUniqueOrThrow({
    where: { id: result.incident!.id },
    include: { tags: { include: { tag: true } } },
  });
}

describe('intelligence fields in automation', () => {
  it('switch off: the fields read as unknown and no rule matches on them', async () => {
    const service = await setup(false);
    await primePrePagingSnapshot();
    const incident = await ingest(service.id);
    expect(incident.priority).not.toBe('P5');
    expect(incident.tags).toHaveLength(0);
  });

  it('switch on and warm: maintenance and a recent risky change drive the rules', async () => {
    const service = await setup(true);
    await primePrePagingSnapshot();
    const incident = await ingest(service.id);
    expect(incident.priority).toBe('P5');
    expect(incident.tags.map(t => t.tag.name)).toEqual(['after-risky-change']);
  });

  it('replay rebuilds the fields at each event time from stored evidence', async () => {
    const service = await setup(true);
    const now = new Date();
    const intelligence = await db.$transaction(tx =>
      loadReplayIntelligence(tx, service.id, new Date(now.getTime() - 86_400_000), now)
    );
    expect(intelligence).toBeDefined();
    expect(intelligence!(now)).toMatchObject({
      inMaintenance: { state: 'RECOGNIZED', value: true },
      recentRiskyChange: { state: 'RECOGNIZED', value: true },
      sloBurning: { state: 'MISSING' },
    });
    expect(intelligence!(new Date(now.getTime() - 3 * 3_600_000))).toMatchObject({
      inMaintenance: { state: 'RECOGNIZED', value: false },
      recentRiskyChange: { state: 'RECOGNIZED', value: false },
    });
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { automationIntelligenceFieldsEnabled: false },
    });
    expect(
      await db.$transaction(tx => loadReplayIntelligence(tx, service.id, now, now))
    ).toBeUndefined();
  });
});
