import { describe, expect, it } from 'vitest';
import { createFakeBusinessServiceEngine } from '@/lib/business-services/__fixtures__/health';
import { engine as stubEngine } from '@/lib/business-services/health-impl';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const actor: AuthorizationActor = { id: 'u1', role: 'USER', status: 'ACTIVE', teamIds: [] };
const team = { id: 't1', name: 'Payments' };
const services = ['Checkout', 'Billing', 'Search', 'Login'].map((name, index) => ({
  id: `bs${index}`,
  name,
  criticality: index === 0 ? ('TIER_0' as const) : null,
  ownerTeam: index < 2 ? team : null,
  memberCount: index,
  ...(name === 'Checkout' ? { status: 'MAJOR_OUTAGE' as const } : {}),
}));

describe('fake business-service engine', () => {
  it('pages by name with a keyset cursor and filters', async () => {
    const { engine } = createFakeBusinessServiceEngine({ services });
    const first = await engine.listBusinessServices({ limit: 2 }, actor);
    expect(first.items.map(item => item.name)).toEqual(['Billing', 'Checkout']);
    const second = await engine.listBusinessServices({ limit: 2, cursor: first.nextCursor }, actor);
    expect(second.items.map(item => item.name)).toEqual(['Login', 'Search']);
    expect(second.nextCursor).toBeNull();

    const impacted = await engine.listBusinessServices({ filter: { impactedOnly: true } }, actor);
    expect(impacted.items.map(item => item.id)).toEqual(['bs0']);
    const owned = await engine.listBusinessServices(
      { filter: { ownerTeamId: 't1', criticality: ['TIER_0'] } },
      actor
    );
    expect(owned.items.map(item => item.id)).toEqual(['bs0']);
  });

  it('returns health only for known ids, defaulting to operational', async () => {
    const { engine } = createFakeBusinessServiceEngine({ services });
    const health = await engine.getBusinessServiceHealth(['bs0', 'bs2', 'missing'], actor);
    expect([...health.keys()]).toEqual(['bs0', 'bs2']);
    expect(health.get('bs0')?.status).toBe('MAJOR_OUTAGE');
    expect(health.get('bs2')?.status).toBe('OPERATIONAL');
  });

  it('detects support cycles, including self-edges', async () => {
    // a <- b <- c  (c supports b, b supports a)
    const { engine } = createFakeBusinessServiceEngine({
      supports: [
        ['a', 'b'],
        ['b', 'c'],
      ],
    });
    expect(await engine.wouldCreateSupportCycle('a', 'a')).toBe(true);
    expect(await engine.wouldCreateSupportCycle('c', 'a')).toBe(true);
    expect(await engine.wouldCreateSupportCycle('a', 'c')).toBe(false);
    expect(await engine.wouldCreateSupportCycle('d', 'a')).toBe(false);
  });

  it('clips the timeline to the window and records impact marks', async () => {
    const entry = (startedAt: string, endedAt: string | null) => ({
      incidentId: startedAt,
      incidentTitle: 'x',
      urgency: 'HIGH' as const,
      source: 'DIRECT' as const,
      excluded: false,
      startedAt: new Date(startedAt),
      endedAt: endedAt ? new Date(endedAt) : null,
    });
    const { engine, impactCalls } = createFakeBusinessServiceEngine({
      timeline: {
        bs0: [entry('2026-01-01', '2026-01-02'), entry('2026-02-01', null)],
      },
    });
    const window = { from: new Date('2026-01-15'), to: new Date('2026-03-01') };
    const rows = await engine.getImpactTimeline('bs0', window, actor);
    expect(rows.map(row => row.incidentId)).toEqual(['2026-02-01']);
    expect((await engine.getBusinessServiceStats('bs0', window, actor)).uptimePercent).toBe(100);

    await engine.setIncidentImpact(
      { incidentId: 'i1', businessServiceId: 'bs0', impacted: false },
      actor
    );
    expect(impactCalls).toEqual([{ incidentId: 'i1', businessServiceId: 'bs0', impacted: false }]);
  });
});

describe('engine stub', () => {
  it('fails loudly until the real engine lands', async () => {
    await expect(stubEngine.wouldCreateSupportCycle('a', 'b')).rejects.toThrow(/P1b/);
  });
});
