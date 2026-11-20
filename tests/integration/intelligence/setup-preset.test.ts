import { beforeEach, describe, expect, it } from 'vitest';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { getNoiseControlPolicy, saveNoiseControlPolicy } from '@/lib/intelligence/noise-controls';
import { OPS_INSIGHT_SWITCHES } from '@/lib/intelligence/ops-insights/contract';
import {
  getIntelligenceSettings,
  resolveEffectivePolicy,
} from '@/lib/intelligence/settings/service';
import { applyRecommendedPreset, getSetupState } from '@/lib/intelligence/settings/setup';
import { setupChecklist, setupRevisions } from '@/lib/intelligence/settings/setup-contract';
import { createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

async function setup() {
  const admin = await createTestUser({ role: 'ADMIN' });
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS },
  });
  return { actorId: admin.id, source: 'UI' as const };
}

describe('Recommended intelligence preset', () => {
  it('turns on the safe set with audit, never AUTO, noise ON or AI, and is idempotent', async () => {
    const actor = await setup();
    const before = await getSetupState();
    const changed = await applyRecommendedPreset(setupRevisions(before), actor);
    expect(changed).toEqual(
      expect.arrayContaining(['enabled', 'triageSuggestions', 'noiseShadow'])
    );

    const settings = await getIntelligenceSettings();
    expect(settings.enabled).toBe(true);
    // eslint-disable-next-line security/detect-object-injection -- keys come from the fixed OPS_INSIGHT_SWITCHES list
    for (const key of OPS_INSIGHT_SWITCHES) expect(settings[key]).toBe(true);
    const policy = await resolveEffectivePolicy(null);
    expect(policy.mode).toBe('SUGGEST');
    expect(policy.definition.triage.enabled).toBe(true);
    expect((await getNoiseControlPolicy(null)).mode).toBe('SHADOW');

    const after = await getSetupState();
    expect(
      setupChecklist(after)
        .filter(item => !item.on)
        .map(item => item.id)
    ).toEqual(['assistant']);
    const audits = await db.auditLog.count({ where: { actorId: actor.actorId } });
    expect(audits).toBeGreaterThanOrEqual(3);

    expect(await applyRecommendedPreset(setupRevisions(after), actor)).toEqual([]);
  });

  it('refuses a stale page and never lowers noise ON to SHADOW', async () => {
    const actor = await setup();
    const stale = setupRevisions(await getSetupState());
    const noise = await getNoiseControlPolicy(null);
    await saveNoiseControlPolicy(
      {
        serviceId: null,
        mode: 'ON',
        definition: noise.definition,
        expectedRevision: noise.revision,
        acknowledgeReadiness: true,
      },
      actor
    );
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { revision: { increment: 1 } },
    });
    await expect(applyRecommendedPreset(stale, actor)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect((await getIntelligenceSettings()).enabled).toBe(false);

    const changed = await applyRecommendedPreset(setupRevisions(await getSetupState()), actor);
    expect(changed).not.toContain('noiseShadow');
    expect((await getNoiseControlPolicy(null)).mode).toBe('ON');
  });

  it('changes nothing when only the noise policy moved since the page loaded', async () => {
    const actor = await setup();
    const stale = setupRevisions(await getSetupState());
    const noise = await getNoiseControlPolicy(null);
    await saveNoiseControlPolicy(
      {
        serviceId: null,
        mode: 'OFF',
        definition: noise.definition,
        expectedRevision: noise.revision,
      },
      actor
    );
    await expect(applyRecommendedPreset(stale, actor)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect((await getIntelligenceSettings()).enabled).toBe(false);
    expect((await resolveEffectivePolicy(null)).mode).not.toBe('SUGGEST');
  });
});
