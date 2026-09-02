import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('SLA history immutability', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('freezes service targets at incident creation even when the service changes later', async () => {
    const service = await createTestService('sla-service', null, {
      targetAckMinutes: 10,
      targetResolveMinutes: 90,
    });
    const incident = await createTestIncident('frozen SLA incident', service.id);

    expect(incident.slaAckTargetMs).toBe(10 * 60_000);
    expect(incident.slaResolveTargetMs).toBe(90 * 60_000);
    expect(incident.slaTargetSource).toBe('SERVICE');
    expect(incident.slaTargetCapturedAt).not.toBeNull();

    await testPrisma.service.update({
      where: { id: service.id },
      data: { targetAckMinutes: 5, targetResolveMinutes: 30 },
    });
    const afterServiceChange = await testPrisma.incident.findUniqueOrThrow({
      where: { id: incident.id },
    });
    expect(afterServiceChange.slaAckTargetMs).toBe(10 * 60_000);
    expect(afterServiceChange.slaResolveTargetMs).toBe(90 * 60_000);
  });

  it('enforces immutable incident SLA targets in the database', async () => {
    const service = await createTestService('immutable-service');
    const incident = await createTestIncident('immutable contract', service.id);

    await expect(
      testPrisma.incident.update({
        where: { id: incident.id },
        data: { slaAckTargetMs: 123 },
      })
    ).rejects.toThrow(/immutable/i);
  });

  it('captures canonical priority SLA before the service target', async () => {
    const service = await createTestService('priority-service', null, {
      targetAckMinutes: 99,
      targetResolveMinutes: 999,
    });
    const incident = await createTestIncident('priority contract', service.id, { priority: 'P2' });
    expect(incident.slaAckTargetMs).toBe(15 * 60_000);
    expect(incident.slaResolveTargetMs).toBe(240 * 60_000);
    expect(incident.slaTargetSource).toBe('PRIORITY');
  });

  it('freezes the definition version and targets used by a daily SLA snapshot', async () => {
    const definition = await testPrisma.sLADefinition.create({
      data: {
        name: 'Snapshot SLA',
        targetAckTime: 10,
        targetResolveTime: 60,
        target: 99.9,
        window: '30d',
        metricType: 'MTTA',
        version: 3,
      },
    });
    const snapshot = await testPrisma.sLASnapshot.create({
      data: {
        slaDefinitionId: definition.id,
        date: new Date('2026-01-01T00:00:00Z'),
        totalIncidents: 1,
        metAckTime: 1,
        metResolveTime: 1,
      },
    });

    expect(snapshot.targetAckMinutes).toBe(10);
    expect(snapshot.targetResolveMinutes).toBe(60);
    expect(snapshot.definitionVersion).toBe(3);
    expect(snapshot.targetSource).toBe('DEFINITION_CAPTURED');

    await testPrisma.sLADefinition.update({
      where: { id: definition.id },
      data: { targetAckTime: 5, targetResolveTime: 30, version: 4 },
    });
    const afterDefinitionChange = await testPrisma.sLASnapshot.findUniqueOrThrow({
      where: { id: snapshot.id },
    });
    expect(afterDefinitionChange.targetAckMinutes).toBe(10);
    expect(afterDefinitionChange.targetResolveMinutes).toBe(60);
    expect(afterDefinitionChange.definitionVersion).toBe(3);

    await expect(
      testPrisma.sLASnapshot.update({
        where: { id: snapshot.id },
        data: { definitionVersion: 99 },
      })
    ).rejects.toThrow(/immutable/i);
  });
});
