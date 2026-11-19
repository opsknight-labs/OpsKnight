import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
  intelligenceSettingsInputSchema,
} from '@/lib/intelligence/contract';
import {
  publishPolicyVersion,
  updateIntelligenceSettings,
} from '@/lib/intelligence/settings/service';
import { replaceFindings } from '@/lib/intelligence/similarity/findings';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const switches = (pageContextEnabled: boolean) =>
  db.intelligenceSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, pageContextEnabled },
    update: { pageContextEnabled },
  });

async function policy(
  mode: 'SHADOW' | 'SUGGEST' | 'OFF',
  scope: { serviceId?: string } = {},
  features: { similarity?: boolean; response?: boolean } = {}
) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const head = await db.intelligencePolicy.findUnique({
    where: { scopeKey: scope.serviceId ? `service:${scope.serviceId}` : 'global' },
    select: { headVersion: true },
  });
  const definition = {
    ...DEFAULT_POLICY_DEFINITION,
    similarity: {
      ...DEFAULT_POLICY_DEFINITION.similarity,
      enabled: features.similarity ?? DEFAULT_POLICY_DEFINITION.similarity.enabled,
    },
    response: {
      ...DEFAULT_POLICY_DEFINITION.response,
      enabled: features.response ?? DEFAULT_POLICY_DEFINITION.response.enabled,
    },
  };
  await publishPolicyVersion(
    scope,
    { mode, definition, expectedHeadVersion: head?.headVersion ?? 0 },
    { actorId: admin.id, source: 'UI' }
  );
  return admin;
}

const row = (subjectRef: string, confidence: number) => ({
  confidence,
  subjectRef,
  evidence: { type: 'test' },
});

async function write(
  incidentId: string,
  kind: 'SIMILAR_INCIDENT' | 'CHANGE_CORRELATION' | 'RUNBOOK_RECOMMENDATION' | 'PROBABLE_CAUSE',
  generation: number,
  rows: ReturnType<typeof row>[]
) {
  return db.$transaction(tx =>
    replaceFindings(tx, { incidentId, kind, generation, policyVersion: null, rows })
  );
}

const stored = async (id: string) =>
  await db.incident.findUniqueOrThrow({
    where: { id },
    select: { pageContext: true, updatedAt: true },
  });

describe('page context precomputed from findings', () => {
  it('keeps the rank-1 lead of each page kind on the incident row, without moving updatedAt', async () => {
    await switches(true);
    await policy('SUGGEST');
    const service = await createTestService('Api');
    const incident = await createTestIncident('api down', service.id);
    const before = (await stored(incident.id)).updatedAt;

    await write(incident.id, 'SIMILAR_INCIDENT', 1, [row('inc_a', 0.9), row('inc_b', 0.5)]);
    await write(incident.id, 'CHANGE_CORRELATION', 1, [row('chg_1', 0.7)]);
    await write(incident.id, 'RUNBOOK_RECOMMENDATION', 1, [row('rb_1', 0.6)]);
    await write(incident.id, 'PROBABLE_CAUSE', 1, [row('inc_up', 0.8)]);

    const after = await stored(incident.id);
    expect(after.pageContext).toEqual({
      similarIncidentId: 'inc_a',
      changeId: 'chg_1',
      runbookId: 'rb_1',
    });
    expect(after.updatedAt).toEqual(before);

    // A newer run that finds no change drops that lead; an empty set clears the column.
    await write(incident.id, 'CHANGE_CORRELATION', 2, []);
    expect((await stored(incident.id)).pageContext).toEqual({
      similarIncidentId: 'inc_a',
      runbookId: 'rb_1',
    });
    await write(incident.id, 'SIMILAR_INCIDENT', 2, []);
    await write(incident.id, 'RUNBOOK_RECOMMENDATION', 2, []);
    expect((await stored(incident.id)).pageContext).toBeNull();
  });

  it('writes nothing while the switch is off and clears a stale context on the next write', async () => {
    await switches(false);
    const service = await createTestService('Api');
    const incident = await createTestIncident('api down', service.id, {
      pageContext: { changeId: 'chg_old' },
    });

    await write(incident.id, 'CHANGE_CORRELATION', 1, [row('chg_1', 0.7)]);

    expect((await stored(incident.id)).pageContext).toBeNull();
  });

  it('writes nothing for a service whose policy is SHADOW, and only the kinds its policy enables', async () => {
    await switches(true);
    await policy('SUGGEST');
    const shadow = await createTestService('Shadow');
    await policy('SHADOW', { serviceId: shadow.id });
    const hidden = await createTestIncident('shadow down', shadow.id);
    await write(hidden.id, 'SIMILAR_INCIDENT', 1, [row('inc_a', 0.9)]);
    await write(hidden.id, 'CHANGE_CORRELATION', 1, [row('chg_1', 0.7)]);
    expect((await stored(hidden.id)).pageContext).toBeNull();

    const partial = await createTestService('Partial');
    await policy('SUGGEST', { serviceId: partial.id }, { similarity: false });
    const incident = await createTestIncident('partial down', partial.id);
    await write(incident.id, 'SIMILAR_INCIDENT', 1, [row('inc_a', 0.9)]);
    await write(incident.id, 'CHANGE_CORRELATION', 1, [row('chg_1', 0.7)]);
    expect((await stored(incident.id)).pageContext).toEqual({ changeId: 'chg_1' });
  });

  it('clears stored leads when the switch, the engine or the policy turns them off', async () => {
    await switches(true);
    const admin = await policy('SUGGEST');
    const service = await createTestService('Api');
    const other = await createTestService('Other');
    const a = await createTestIncident('a', service.id, {
      pageContext: { similarIncidentId: 'inc_a', changeId: 'chg_1' },
    });
    const b = await createTestIncident('b', other.id, { pageContext: { changeId: 'chg_2' } });

    // A service policy without similarity drops only that lead, only on that service.
    await policy('SUGGEST', { serviceId: service.id }, { similarity: false });
    expect((await stored(a.id)).pageContext).toEqual({ changeId: 'chg_1' });
    expect((await stored(b.id)).pageContext).toEqual({ changeId: 'chg_2' });

    // The global policy going SHADOW clears services that follow it, not overridden ones.
    await policy('SHADOW');
    expect((await stored(b.id)).pageContext).toBeNull();
    expect((await stored(a.id)).pageContext).toEqual({ changeId: 'chg_1' });

    // Turning the page-context switch off clears everything.
    const settings = await db.intelligenceSettings.findUniqueOrThrow({ where: { id: 'default' } });
    const keys = Object.keys(intelligenceSettingsInputSchema.shape);
    const input = Object.fromEntries(
      keys.filter(k => k in settings).map(k => [k, settings[k as keyof typeof settings]])
    );
    await updateIntelligenceSettings(
      { ...input, expectedRevision: settings.revision, pageContextEnabled: false },
      { actorId: admin.id, source: 'UI' }
    );
    expect((await stored(a.id)).pageContext).toBeNull();
  });
});
