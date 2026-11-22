import { describe, expect, it } from 'vitest';
import {
  computeHealth,
  impactThreshold,
  incidentImpactSources,
  meetsThreshold,
  type HealthBusinessService,
  type HealthIncident,
  type HealthInputs,
} from '@/lib/business-services/health';
import { unionDurationMs, wouldCreateSupportCycle } from '@/lib/business-services/stats';

const NOW = new Date('2026-11-22T12:00:00Z');

function bs(
  id: string,
  members: Array<string | [string, boolean]>,
  extra: Partial<HealthBusinessService> = {}
): HealthBusinessService {
  return {
    id,
    criticality: null,
    impactMinUrgency: null,
    impactMaxPriority: null,
    ownerTeamId: null,
    members: members.map(member =>
      Array.isArray(member)
        ? { serviceId: member[0], critical: member[1], teamId: null }
        : { serviceId: member, critical: true, teamId: null }
    ),
    ...extra,
  };
}

function incident(
  id: string,
  serviceId: string,
  urgency: HealthIncident['urgency'] = 'HIGH',
  priority: string | null = null,
  createdAt = new Date('2026-11-22T11:00:00Z')
): HealthIncident {
  return { id, serviceId, urgency, priority, createdAt };
}

function inputs(partial: Partial<HealthInputs>): HealthInputs {
  return {
    now: NOW,
    businessServices: [],
    supports: [],
    edges: [],
    incidents: [],
    impactRows: [],
    maintenance: new Map(),
    ...partial,
  };
}

const edge = (upstreamServiceId: string, downstreamServiceId: string) => ({
  upstreamServiceId,
  downstreamServiceId,
});

describe('impact thresholds', () => {
  it.each([
    // [tier, urgency, priority, impacts]
    ['TIER_0', 'HIGH', null, true],
    ['TIER_0', 'MEDIUM', 'P2', true],
    ['TIER_0', 'MEDIUM', 'P3', false],
    ['TIER_1', 'LOW', 'P1', true],
    ['TIER_1', 'MEDIUM', null, false],
    ['TIER_2', 'MEDIUM', 'P2', false],
    ['TIER_2', 'MEDIUM', 'P1', true],
    ['TIER_3', 'MEDIUM', 'P1', false],
    ['TIER_3', 'HIGH', null, true],
    [null, 'LOW', null, true],
  ] as const)('%s: %s/%s impacts=%s', (tier, urgency, priority, expected) => {
    const threshold = impactThreshold(bs('x', [], { criticality: tier }));
    expect(meetsThreshold({ urgency, priority }, threshold)).toBe(expected);
  });

  it('per-service overrides win over the tier default, field by field', () => {
    const threshold = impactThreshold(
      bs('x', [], { criticality: 'TIER_3', impactMinUrgency: 'MEDIUM', impactMaxPriority: 'p3' })
    );
    expect(threshold).toEqual({ minUrgency: 'MEDIUM', maxPriority: 3 });
    expect(meetsThreshold({ urgency: 'LOW', priority: 'P3' }, threshold)).toBe(true);
    expect(meetsThreshold({ urgency: 'LOW', priority: 'P4' }, threshold)).toBe(false);
  });
});

describe('computeHealth', () => {
  const cases: Array<{
    name: string;
    input: Partial<HealthInputs>;
    expect: Record<
      string,
      { status: string; reasons?: string[]; open?: number; impacted?: number }
    >;
  }> = [
    {
      name: 'no incidents is operational',
      input: { businessServices: [bs('checkout', ['api'])] },
      expect: { checkout: { status: 'OPERATIONAL', reasons: [], open: 0 } },
    },
    {
      name: 'DIRECT maps urgency to status on a critical member',
      input: {
        businessServices: [bs('checkout', ['api']), bs('search', ['idx'])],
        incidents: [incident('i1', 'api', 'HIGH'), incident('i2', 'idx', 'MEDIUM')],
      },
      expect: {
        checkout: { status: 'MAJOR_OUTAGE', reasons: ['DIRECT'], open: 1, impacted: 1 },
        search: { status: 'PARTIAL_OUTAGE', reasons: ['DIRECT'] },
      },
    },
    {
      name: 'non-critical members cap at DEGRADED',
      input: {
        businessServices: [bs('checkout', [['cdn', false], 'api'])],
        incidents: [incident('i1', 'cdn', 'HIGH')],
      },
      expect: { checkout: { status: 'DEGRADED', reasons: ['DIRECT'] } },
    },
    {
      name: 'tier thresholds ignore incidents below them',
      input: {
        businessServices: [bs('checkout', ['api'], { criticality: 'TIER_2' })],
        incidents: [incident('i1', 'api', 'MEDIUM', 'P2')],
      },
      expect: { checkout: { status: 'OPERATIONAL', reasons: [] } },
    },
    {
      name: 'DEPENDENCY caps at PARTIAL_OUTAGE and stops past depth 3',
      input: {
        businessServices: [bs('near', ['d1']), bs('far', ['d4'])],
        edges: [edge('db', 'd1'), edge('d1', 'd2'), edge('d2', 'd3'), edge('d3', 'd4')],
        incidents: [incident('i1', 'db', 'HIGH')],
      },
      expect: {
        near: { status: 'PARTIAL_OUTAGE', reasons: ['DEPENDENCY'], impacted: 1 },
        far: { status: 'OPERATIONAL' },
      },
    },
    {
      name: 'DEPENDENCY only flows to critical members',
      input: {
        businessServices: [bs('checkout', [['d1', false]])],
        edges: [edge('db', 'd1')],
        incidents: [incident('i1', 'db', 'HIGH')],
      },
      expect: { checkout: { status: 'OPERATIONAL' } },
    },
    {
      name: 'dependency cycles terminate',
      input: {
        businessServices: [bs('checkout', ['b'])],
        edges: [edge('a', 'b'), edge('b', 'a')],
        incidents: [incident('i1', 'a', 'LOW')],
      },
      expect: { checkout: { status: 'DEGRADED', reasons: ['DEPENDENCY'] } },
    },
    {
      name: 'NESTED caps at DEGRADED, depth <= 3, survives support cycles',
      input: {
        businessServices: [
          bs('payments', ['api']),
          bs('checkout', []),
          bs('store', []),
          bs('brand', []),
          bs('group', []),
        ],
        supports: [
          { parentId: 'checkout', childId: 'payments' },
          { parentId: 'store', childId: 'checkout' },
          { parentId: 'brand', childId: 'store' },
          { parentId: 'group', childId: 'brand' },
          { parentId: 'payments', childId: 'group' },
        ],
        incidents: [incident('i1', 'api', 'HIGH')],
      },
      expect: {
        payments: { status: 'MAJOR_OUTAGE' },
        checkout: { status: 'DEGRADED', reasons: ['NESTED'], open: 0 },
        brand: { status: 'DEGRADED', reasons: ['NESTED'] },
        group: { status: 'OPERATIONAL' },
      },
    },
    {
      name: 'MANUAL adds an impact below the threshold; exclusion suppresses DIRECT',
      input: {
        businessServices: [
          bs('checkout', ['api'], { criticality: 'TIER_3' }),
          bs('login', ['auth']),
        ],
        incidents: [incident('i1', 'other', 'MEDIUM'), incident('i2', 'auth', 'HIGH')],
        impactRows: [
          {
            incidentId: 'i1',
            businessServiceId: 'checkout',
            source: 'MANUAL',
            excluded: false,
            createdById: 'u1',
            startedAt: NOW,
          },
          {
            incidentId: 'i2',
            businessServiceId: 'login',
            source: 'DIRECT',
            excluded: true,
            createdById: 'u1',
            startedAt: NOW,
          },
        ],
      },
      expect: {
        checkout: { status: 'PARTIAL_OUTAGE', reasons: ['MANUAL'], open: 1 },
        login: { status: 'OPERATIONAL', reasons: [] },
      },
    },
    {
      name: 'manual rows for closed incidents are ignored',
      input: {
        businessServices: [bs('checkout', ['api'])],
        impactRows: [
          {
            incidentId: 'gone',
            businessServiceId: 'checkout',
            source: 'MANUAL',
            excluded: false,
            createdById: null,
            startedAt: NOW,
          },
        ],
      },
      expect: { checkout: { status: 'OPERATIONAL' } },
    },
    {
      name: 'MAINTENANCE when every critical member is in a window; outages still win',
      input: {
        businessServices: [
          bs('checkout', ['api', ['cdn', false]]),
          bs('login', ['auth', 'sso']),
          bs('search', ['idx']),
        ],
        maintenance: new Map([
          ['api', 'w1'],
          ['auth', 'w2'],
          ['idx', 'w3'],
        ]),
        incidents: [incident('i1', 'idx', 'HIGH')],
      },
      expect: {
        checkout: { status: 'MAINTENANCE', reasons: ['MAINTENANCE'] },
        login: { status: 'OPERATIONAL' },
        search: { status: 'MAJOR_OUTAGE', reasons: ['DIRECT', 'MAINTENANCE'] },
      },
    },
    {
      name: 'counts distinct incidents and members, the worst reason first',
      input: {
        businessServices: [bs('checkout', ['api', 'web', 'd1'])],
        edges: [edge('api', 'd1'), edge('api', 'web')],
        incidents: [
          incident('i1', 'api', 'LOW'),
          incident('i2', 'web', 'HIGH'),
          incident('i3', 'web', 'LOW'),
        ],
      },
      expect: {
        checkout: {
          status: 'MAJOR_OUTAGE',
          reasons: ['DIRECT', 'DIRECT', 'DIRECT'],
          open: 3,
          impacted: 3,
        },
      },
    },
  ];

  it.each(cases)('$name', ({ input, expect: expected }) => {
    const health = computeHealth(inputs(input));
    for (const [id, want] of Object.entries(expected)) {
      const item = health.get(id)!;
      expect(item.status, id).toBe(want.status);
      if (want.reasons)
        expect(
          item.reasons.map(reason => reason.kind),
          id
        ).toEqual(want.reasons);
      if (want.open !== undefined) expect(item.openIncidentCount, id).toBe(want.open);
      if (want.impacted !== undefined) expect(item.impactedMemberCount, id).toBe(want.impacted);
    }
  });

  it('reports since as the earliest incident behind the current status', () => {
    const early = new Date('2026-11-22T09:00:00Z');
    const health = computeHealth(
      inputs({
        businessServices: [bs('checkout', ['api']), bs('store', [])],
        supports: [{ parentId: 'store', childId: 'checkout' }],
        incidents: [
          incident('i1', 'api', 'HIGH', null, early),
          incident('i2', 'api', 'HIGH'),
          incident('i3', 'api', 'LOW', null, new Date('2026-11-22T08:00:00Z')),
        ],
      })
    );
    expect(health.get('checkout')!.since).toEqual(early);
    expect(health.get('store')!.since).toEqual(early);
  });

  it('honours a parent exclusion for nested impact, carrying the incident id', () => {
    const base = inputs({
      businessServices: [bs('payments', ['api']), bs('checkout', [])],
      supports: [{ parentId: 'checkout', childId: 'payments' }],
      incidents: [incident('i1', 'api', 'HIGH'), incident('i2', 'api', 'LOW')],
    });
    const nested = computeHealth(base).get('checkout')!;
    expect(nested.reasons).toEqual([
      expect.objectContaining({
        kind: 'NESTED',
        childBusinessServiceId: 'payments',
        incidentId: 'i1',
      }),
    ]);
    const row = (incidentId: string) => ({
      incidentId,
      businessServiceId: 'checkout',
      source: 'NESTED' as const,
      excluded: true,
      createdById: 'u1',
      startedAt: NOW,
    });
    // Unmarking i1 on the parent falls back to the child's next incident...
    const one = computeHealth({ ...base, impactRows: [row('i1')] }).get('checkout')!;
    expect(one.reasons).toEqual([expect.objectContaining({ kind: 'NESTED', incidentId: 'i2' })]);
    // ...and unmarking both leaves the parent operational, while the child stays down.
    const both = computeHealth({ ...base, impactRows: [row('i1'), row('i2')] });
    expect(both.get('checkout')!.status).toBe('OPERATIONAL');
    expect(both.get('payments')!.status).toBe('MAJOR_OUTAGE');
    expect(
      incidentImpactSources({ ...base, impactRows: [row('i1')] }, incident('i1', 'api')).has(
        'checkout'
      )
    ).toBe(false);
  });

  it('decides marks and exclusions from the latest interval of a pair', () => {
    const older = new Date('2026-11-22T10:00:00Z');
    const health = computeHealth(
      inputs({
        businessServices: [bs('reporting', ['x'], { criticality: 'TIER_3' })],
        incidents: [incident('i1', 'other', 'MEDIUM')],
        impactRows: [
          {
            incidentId: 'i1',
            businessServiceId: 'reporting',
            source: 'MANUAL',
            excluded: true,
            createdById: 'u1',
            startedAt: older,
          },
          {
            incidentId: 'i1',
            businessServiceId: 'reporting',
            source: 'MANUAL',
            excluded: false,
            createdById: 'u2',
            startedAt: NOW,
          },
        ],
      })
    );
    expect(health.get('reporting')!.reasons[0]).toMatchObject({ kind: 'MANUAL', markedById: 'u2' });
  });

  it('gives the sources a single incident contributes', () => {
    const sources = incidentImpactSources(
      inputs({
        businessServices: [bs('checkout', ['api']), bs('store', []), bs('other', ['x'])],
        supports: [{ parentId: 'store', childId: 'checkout' }],
      }),
      incident('i1', 'api')
    );
    expect(Object.fromEntries(sources)).toEqual({ checkout: 'DIRECT', store: 'NESTED' });
  });
});

describe('union uptime', () => {
  it('counts overlapping intervals once and clips to the window', () => {
    const window = { from: 0, to: 100 };
    expect(unionDurationMs([], window)).toBe(0);
    expect(
      unionDurationMs(
        [
          { start: 10, end: 30 },
          { start: 20, end: 40 },
          { start: 40, end: 50 },
          { start: 90, end: 200 },
          { start: -50, end: 5 },
          { start: 60, end: 60 },
        ],
        window
      )
    ).toBe(5 + 40 + 10);
  });
});

describe('support cycle prevention', () => {
  function client(edges: Array<[string, string]>) {
    return {
      businessServiceSupport: {
        findMany: async ({ where }: { where: { parentId: { in: string[] } } }) =>
          edges
            .filter(([parentId]) => where.parentId.in.includes(parentId))
            .map(([, childId]) => ({ childId })),
      },
    } as never;
  }

  it.each([
    ['self edge', 'a', 'a', [], true],
    ['unrelated', 'a', 'b', [['c', 'd']], false],
    ['direct back edge', 'a', 'b', [['b', 'a']], true],
    [
      'transitive back edge',
      'a',
      'b',
      [
        ['b', 'c'],
        ['c', 'a'],
      ],
      true,
    ],
    [
      'diamond without cycle',
      'a',
      'b',
      [
        ['b', 'c'],
        ['b', 'd'],
        ['d', 'c'],
      ],
      false,
    ],
    [
      'existing cycle elsewhere terminates',
      'a',
      'b',
      [
        ['b', 'c'],
        ['c', 'b'],
      ],
      false,
    ],
  ] as const)('%s', async (_name, parent, child, edges, expected) => {
    await expect(
      wouldCreateSupportCycle(parent, child, client(edges as unknown as Array<[string, string]>))
    ).resolves.toBe(expected);
  });
});

describe('computeHealth performance', () => {
  it('handles 1k business services, 10k services, 20k members, 5k edges, 500 incidents < 50 ms', () => {
    // mulberry32: a plain LCG's low bits repeat and would pile every member onto a few hub services.
    let seed = 42;
    const random = (max: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % max;
    };
    const service = (index: number) => `s${index}`;
    const businessServices = Array.from({ length: 1000 }, (_, index) =>
      bs(
        `bs${index}`,
        Array.from(
          { length: 20 },
          () => [service(random(10_000)), random(5) > 0] as [string, boolean]
        ),
        { criticality: (['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3', null] as const)[index % 5] }
      )
    );
    const edges = Array.from({ length: 5000 }, () =>
      edge(service(random(10_000)), service(random(10_000)))
    );
    const supports = Array.from({ length: 500 }, (_, index) => ({
      parentId: `bs${index}`,
      childId: `bs${random(1000)}`,
    }));
    const incidents = Array.from({ length: 500 }, (_, index) =>
      incident(
        `i${index}`,
        service(random(10_000)),
        (['LOW', 'MEDIUM', 'HIGH'] as const)[index % 3],
        `P${(index % 5) + 1}`
      )
    );
    const input = inputs({ businessServices, edges, supports, incidents });
    computeHealth(input); // warm up the JIT
    const runs = 5;
    const started = performance.now();
    for (let run = 0; run < runs; run += 1) computeHealth(input);
    const perRun = (performance.now() - started) / runs;
    expect(perRun).toBeLessThan(50);
  });
});
