import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRole } from '@/lib/authorization';
import { DEFAULT_POLICY_DEFINITION, INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  clearServiceOverride,
  listServicePolicyOverview,
  publishPolicyVersion,
  resolveEffectivePolicy,
  rollbackPolicy,
} from '@/lib/intelligence/settings/service';
import { createTestService, createTestTeam, createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

const session = vi.hoisted(() => ({ user: null as { id: string; role: string } | null }));
vi.mock('@/lib/rbac', async () => {
  const authorization = await import('@/lib/authorization');
  return {
    assertCapability: async (capability: string) => {
      const user = session.user;
      if (!user || !authorization.hasCapability(user.role as AppRole, capability as never)) {
        throw new authorization.AuthorizationError('Unauthorized.', capability as never);
      }
      return user;
    },
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { clearServiceOverrideAction, saveServicePolicyAction } from '@/app/(app)/settings/intelligence/services/actions';

const initial = { message: '', ok: false };
const form = (values: Record<string, string | boolean | number>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === true) data.set(key, 'on');
    else if (value !== false) data.set(key, String(value));
  }
  return data;
};

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  await resetDatabase();
  session.user = null;
});

async function world() {
  const admin = await createTestUser({ role: 'ADMIN' });
  const actor = { actorId: admin.id, source: 'UI' as const };
  await db.intelligenceSettings.create({ data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true } });
  await publishPolicyVersion({}, { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, actor);
  const quiet = await createTestService('Quiet');
  const loud = await createTestService('Loud');
  return { admin, actor, quiet, loud };
}

describe('service policy overrides', () => {
  it('overrides the global policy, can be cleared without losing history, and re-activates on publish', async () => {
    const { actor, quiet, loud } = await world();
    expect((await resolveEffectivePolicy(quiet.id)).source).toBe('global');

    await publishPolicyVersion({ serviceId: quiet.id }, { mode: 'OFF', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, actor);
    expect(await resolveEffectivePolicy(quiet.id)).toMatchObject({ source: 'service', effectiveMode: 'OFF', version: 1 });
    expect((await resolveEffectivePolicy(loud.id)).source).toBe('global');

    expect(await clearServiceOverride(quiet.id, actor)).toBe('cleared');
    expect(await resolveEffectivePolicy(quiet.id)).toMatchObject({ source: 'global', effectiveMode: 'SUGGEST' });
    expect(await db.intelligencePolicyVersion.count({ where: { policy: { serviceId: quiet.id } } })).toBe(1);
    expect(await clearServiceOverride(quiet.id, actor)).toBe('none');
    expect(await clearServiceOverride(loud.id, actor)).toBe('none');

    // Publishing again continues the same history and re-activates the override.
    await publishPolicyVersion({ serviceId: quiet.id }, { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 1 }, actor);
    expect(await resolveEffectivePolicy(quiet.id)).toMatchObject({ source: 'service', effectiveMode: 'SHADOW', version: 2 });

    // So does a rollback.
    await clearServiceOverride(quiet.id, actor);
    await rollbackPolicy({ serviceId: quiet.id }, { targetVersion: 1, expectedHeadVersion: 2, reason: 'restore' }, actor);
    expect(await resolveEffectivePolicy(quiet.id)).toMatchObject({ source: 'service', effectiveMode: 'OFF', version: 3 });

    const audit = (await db.auditLog.findMany({ select: { action: true } })).map(row => row.action);
    expect(audit.filter(action => action === 'intelligence.policy.override_cleared')).toHaveLength(2);
  });

  it('keeps a cleared override off when the master switch is off too', async () => {
    const { actor, quiet } = await world();
    await publishPolicyVersion({ serviceId: quiet.id }, { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 }, actor);
    await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: false } });
    expect(await resolveEffectivePolicy(quiet.id)).toMatchObject({ source: 'service', mode: 'SUGGEST', effectiveMode: 'OFF' });
  });

  it('summarises the effective policy of many services at once', async () => {
    const { actor, quiet, loud } = await world();
    for (let i = 0; i < 12; i += 1) await createTestService(`Bulk ${i}`);
    await publishPolicyVersion(
      { serviceId: quiet.id },
      { mode: 'SHADOW', definition: { ...DEFAULT_POLICY_DEFINITION, response: { enabled: false } }, expectedHeadVersion: 0 },
      actor
    );
    const rows = await listServicePolicyOverview({ limit: 100 });

    const byName = new Map(rows.map(row => [row.serviceName, row]));
    expect(byName.get(quiet.name)).toMatchObject({ source: 'service', mode: 'SHADOW', responseEnabled: false, headVersion: 1, version: 1 });
    expect(byName.get(loud.name)).toMatchObject({ source: 'global', mode: 'SUGGEST', responseEnabled: true, headVersion: 0 });
    expect(rows).toHaveLength(14);
    // Ordering is the database's (collation differs between environments), so compare with its own order.
    const dbOrder = await db.service.findMany({ orderBy: { name: 'asc' }, select: { name: true } });
    expect(rows.map(row => row.serviceName)).toEqual(dbOrder.map(row => row.name));

    expect(await listServicePolicyOverview({ search: 'bulk 1' })).toHaveLength(3);
    expect(await listServicePolicyOverview({ search: 'nothing-matches' })).toEqual([]);
    expect(await listServicePolicyOverview({ limit: 3 })).toHaveLength(3);
  });

  it('honours the caller\'s service visibility', async () => {
    await world();
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const mine = await createTestService('Mine', teamA.id);
    await createTestService('Theirs', teamB.id);
    const rows = await listServicePolicyOverview({ serviceWhere: { teamId: { in: [teamA.id] } } });
    expect(rows.map(row => row.serviceId)).toEqual([mine.id]);
  });
});

describe('service policy actions', () => {
  async function signIn(role: AppRole) {
    const user = await createTestUser({ role });
    session.user = { id: user.id, role };
    return user;
  }

  it('lets a manager create, version and clear an override; a responder cannot', async () => {
    const { quiet } = await world();
    await signIn('RESPONDER');
    const denied = await saveServicePolicyAction(initial, form({ serviceId: quiet.id, mode: 'OFF', expectedHeadVersion: 0 }));
    expect(denied.ok).toBe(false);
    expect(await db.intelligencePolicy.count({ where: { serviceId: quiet.id } })).toBe(0);

    await signIn('ADMIN');
    const created = await saveServicePolicyAction(
      initial,
      form({ serviceId: quiet.id, mode: 'SHADOW', similarityEnabled: true, responseEnabled: false, expectedHeadVersion: 0, reason: 'trial' })
    );
    expect(created).toMatchObject({ ok: true });
    expect(await resolveEffectivePolicy(quiet.id)).toMatchObject({ source: 'service', mode: 'SHADOW' });
    expect((await resolveEffectivePolicy(quiet.id)).definition.response.enabled).toBe(false);

    // A stale head is refused with a friendly message.
    const stale = await saveServicePolicyAction(initial, form({ serviceId: quiet.id, mode: 'OFF', expectedHeadVersion: 0 }));
    expect(stale).toEqual({ ok: false, message: expect.stringMatching(/changed since you opened/i) });

    const cleared = await clearServiceOverrideAction(initial, form({ serviceId: quiet.id }));
    expect(cleared).toMatchObject({ ok: true });
    expect((await resolveEffectivePolicy(quiet.id)).source).toBe('global');
  });

  it('validates input and refuses AUTO', async () => {
    const { quiet } = await world();
    await signIn('ADMIN');
    expect((await saveServicePolicyAction(initial, form({ serviceId: quiet.id, mode: 'NOPE', expectedHeadVersion: 0 }))).ok).toBe(false);
    expect((await saveServicePolicyAction(initial, form({ mode: 'OFF', expectedHeadVersion: 0 }))).ok).toBe(false);
    const auto = await saveServicePolicyAction(initial, form({ serviceId: quiet.id, mode: 'AUTO', expectedHeadVersion: 0 }));
    expect(auto.ok).toBe(false);
    expect(await db.intelligencePolicy.count({ where: { serviceId: quiet.id } })).toBe(0);
  });
});
