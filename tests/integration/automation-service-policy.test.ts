import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { updateService } from '@/app/(app)/services/actions';
import { saveDraft, publishVersion, changeMode } from '@/lib/automation/versioning';
import { emptySnapshot } from '@/lib/automation/contract';
import { lockAutomationService } from '@/lib/automation/locking';

const auth = vi.hoisted(() => ({ actorId: '' }));
vi.mock('@/lib/rbac', () => ({
  assertCanModifyService: async () => ({ id: auth.actorId, role: 'ADMIN' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/audit', async original => ({
  ...(await original<typeof import('@/lib/audit')>()),
  logAudit: vi.fn(),
}));
beforeEach(resetDatabase);
afterAll(() => db.$disconnect());
async function fixture() {
  auth.actorId = (await createTestUser({ role: 'ADMIN' })).id;
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
  const safe = await db.escalationPolicy.create({ data: { name: 'Safe default' } });
  const unsafe = await db.escalationPolicy.create({ data: { name: 'Legacy unsafe default' } });
  await db.escalationRule.createMany({
    data: Array.from({ length: 51 }, (_, stepOrder) => ({
      policyId: unsafe.id,
      stepOrder,
      delayMinutes: 0,
      targetType: 'USER' as const,
      targetUserId: auth.actorId,
      notificationChannels: [],
    })),
  });
  const service = await db.service.create({
    data: { name: 'Policy assignment service', escalationPolicyId: safe.id },
  });
  const draft = await saveDraft({
    serviceId: service.id,
    actorId: auth.actorId,
    snapshot: emptySnapshot,
    expectedRevision: 0,
  });
  const version = await publishVersion({
    serviceId: service.id,
    actorId: auth.actorId,
    expectedRevision: draft.revision,
    expectedActiveVersionId: null,
  });
  const activate = () =>
    changeMode({
      serviceId: service.id,
      actorId: auth.actorId,
      mode: 'LIVE',
      expectedActiveVersionId: version.id,
      acknowledgeNoShadow: true,
    });
  const assign = (policyId: string | null) => {
    const form = new FormData();
    form.set('name', service.name);
    form.set('escalationPolicyId', policyId ?? '');
    return updateService(service.id, form);
  };
  return { safe, unsafe, service, activate, assign };
}
it('rejects unsafe post-LIVE assignment atomically while permitting safe and null defaults', async () => {
  const f = await fixture();
  await f.activate();
  await expect(f.assign(f.unsafe.id)).rejects.toThrow('maximum step limit');
  expect(
    (await db.service.findUniqueOrThrow({ where: { id: f.service.id } })).escalationPolicyId
  ).toBe(f.safe.id);
  const another = await db.escalationPolicy.create({ data: { name: 'Another safe default' } });
  await f.assign(another.id);
  await f.assign(null);
  expect(
    (await db.service.findUniqueOrThrow({ where: { id: f.service.id } })).escalationPolicyId
  ).toBeNull();
});
it('retains legacy assignment support while DISABLED and rejects subsequent LIVE activation', async () => {
  const f = await fixture();
  await f.assign(f.unsafe.id);
  await expect(f.activate()).rejects.toThrow('unsafe for LIVE');
});
it.each([false, true])(
  'serializes racing LIVE activation and unsafe assignment (reverse=%s)',
  async reverse => {
    const f = await fixture();
    let unlock!: () => void;
    const held = new Promise<void>(resolve => {
      unlock = resolve;
    });
    let acquired!: () => void;
    const ready = new Promise<void>(resolve => {
      acquired = resolve;
    });
    const blocker = db.$transaction(
      async tx => {
        await lockAutomationService(tx, f.service.id);
        acquired();
        await held;
      },
      { timeout: 10000 }
    );
    await ready;
    const calls = reverse
      ? [f.assign(f.unsafe.id), f.activate()]
      : [f.activate(), f.assign(f.unsafe.id)];
    const settled = Promise.allSettled(calls);
    try {
      let waiting = 0;
      for (let attempt = 0; attempt < 100 && waiting < 2; attempt++) {
        const rows = await db.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'`;
        waiting = Number(rows[0].count);
        if (waiting < 2) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
    } finally {
      unlock();
      await blocker;
    }
    const results = await settled;
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const service = await db.service.findUniqueOrThrow({
      where: { id: f.service.id },
      include: { automationConfig: true },
    });
    expect(
      service.automationConfig?.mode === 'LIVE' && service.escalationPolicyId === f.unsafe.id
    ).toBe(false);
  }
);
