import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY_DEFINITION, INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { publishPolicyVersion, resolveEffectivePolicy } from '@/lib/intelligence/settings/service';
import { seedShadowServicePolicy } from '@/lib/intelligence/settings/service-defaults';
import {
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

describe('SHADOW defaults for new services', () => {
  it('does nothing while the global switch is off', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const service = await createTestService('Checkout');
    expect(await seedShadowServicePolicy(service.id, { actorId: admin.id, source: 'UI' })).toBe(
      false
    );
    expect(await db.intelligencePolicy.count()).toBe(0);
  });

  it('gives a new service one template rule in SHADOW, once, and never downgrades a live global policy', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = { actorId: admin.id, source: 'UI' as const };
    await db.intelligenceSettings.create({
      data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    const service = await createTestService('Checkout');
    expect(await seedShadowServicePolicy(service.id, actor)).toBe(true);
    const policy = await resolveEffectivePolicy(service.id);
    expect(policy).toMatchObject({ source: 'service', mode: 'SHADOW', effectiveMode: 'SHADOW' });
    expect(policy.definition.correlation.rules).toEqual([
      expect.objectContaining({ kind: 'CONTENT_TEMPLATE', enabled: true }),
    ]);
    // Idempotent: an existing override is left alone.
    expect(await seedShadowServicePolicy(service.id, actor)).toBe(false);

    await publishPolicyVersion(
      {},
      { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      actor
    );
    const later = await createTestService('Payments');
    expect(await seedShadowServicePolicy(later.id, actor)).toBe(false);
    expect((await resolveEffectivePolicy(later.id)).source).toBe('global');
  });
});
