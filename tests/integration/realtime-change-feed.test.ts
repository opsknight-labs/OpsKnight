import { beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, resetDatabase, createTestService } from '../helpers/test-db';

describe('realtime change feed', () => {
  beforeEach(resetDatabase);

  async function newestGeneration(): Promise<bigint> {
    const row = await testPrisma.realtimeChange.findFirst({ orderBy: { id: 'desc' } });
    if (!row) throw new Error('Expected a realtime change generation');
    return row.id;
  }

  it('advances after committed service and incident mutations', async () => {
    const service = await createTestService('Realtime service');
    const afterService = await newestGeneration();

    const incident = await testPrisma.incident.create({
      data: { title: 'Realtime incident', serviceId: service.id },
    });
    const afterIncident = await newestGeneration();
    await testPrisma.incident.update({
      where: { id: incident.id },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    });

    expect(afterIncident).toBeGreaterThan(afterService);
    expect(await newestGeneration()).toBeGreaterThan(afterIncident);
  });

  it('does not expose generations from rolled-back mutations', async () => {
    const service = await createTestService('Rollback service');
    const before = await newestGeneration();

    await expect(
      testPrisma.$transaction(async tx => {
        await tx.service.update({ where: { id: service.id }, data: { name: 'Never committed' } });
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');

    expect(await newestGeneration()).toBe(before);
  });

  it('demonstrates that concurrent commits can become visible out of sequence', async () => {
    const first = await createTestService('Slow transaction');
    const second = await createTestService('Fast transaction');
    let releaseSlow!: () => void;
    const holdSlow = new Promise<void>(resolve => {
      releaseSlow = resolve;
    });
    let reportSlowGeneration!: (generation: bigint) => void;
    const slowGeneration = new Promise<bigint>(resolve => {
      reportSlowGeneration = resolve;
    });

    const slowTransaction = testPrisma.$transaction(async tx => {
      await tx.service.update({ where: { id: first.id }, data: { name: 'Slow committed' } });
      const ownChange = await tx.realtimeChange.findFirst({ orderBy: { id: 'desc' } });
      if (!ownChange) throw new Error('Expected slow transaction generation');
      reportSlowGeneration(ownChange.id);
      await holdSlow;
    });

    const lowerGeneration = await slowGeneration;
    await testPrisma.service.update({ where: { id: second.id }, data: { name: 'Fast committed' } });
    const visibleAfterFastCommit = await newestGeneration();
    expect(visibleAfterFastCommit).toBeGreaterThan(lowerGeneration);

    releaseSlow();
    await slowTransaction;
    expect(await newestGeneration()).toBe(visibleAfterFastCommit);
  });
});
