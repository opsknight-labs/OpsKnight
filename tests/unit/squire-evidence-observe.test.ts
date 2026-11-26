import { describe, expect, it, vi } from 'vitest';

// Every source is visible: these tests are about what observe() records, not about access checks.
vi.mock('@/lib/intelligence/squire/evidence-access', () => ({
  sourceKey: (source: { kind: string; id: string }) => `${source.kind}:${source.id}`,
  readSourceStates: async (_actor: unknown, sources: Array<{ kind: string; id: string }>) =>
    new Map(sources.map(source => [`${source.kind}:${source.id}`, {}])),
}));

import { SquireEvidenceRegistry } from '@/lib/intelligence/squire/evidence';

const registry = () =>
  new SquireEvidenceRegistry({ id: 'u1', status: 'ACTIVE' } as never, 'INTERNAL');
type Observed = {
  data: unknown;
  evidence: Array<Record<string, unknown>>;
  truncated?: boolean;
  error?: string;
};

describe('SquireEvidenceRegistry.observe', () => {
  it.each(['listIncidents', 'listActionItems'])(
    'trims a large generic read (%s) whose rows sit under data instead of failing verification',
    async operationId => {
      const items = Array.from({ length: 60 }, (_, i) => ({
        id: `row-${i}`,
        title: 'x'.repeat(200),
      }));
      const out = (await registry().observe(
        'read_operation',
        { operationId },
        { data: { items, total: 60 } }
      )) as { data: { data: { items: unknown[]; total: number } }; error?: string };
      expect(out.error).toBeUndefined();
      expect(out.data.data.items.length).toBeGreaterThan(0);
      expect(out.data.data.items.length).toBeLessThan(60);
      expect(out.data.data.total).toBe(60);
    }
  );

  it.each([
    'get_repo_activity',
    'get_azure_pipeline_runs',
    'get_deployment_status',
    'get_apm_kpis',
    'get_service_topology',
  ])('cites the queried connection for %s', async tool => {
    const evidence = registry();
    const out = (await evidence.observe(
      tool,
      {},
      {
        connectionId: 'conn-1',
        connectionName: 'Delivery',
        kind: 'x',
      }
    )) as Observed;
    expect(out.error).toBeUndefined();
    expect(out.evidence.map(e => [e.kind, e.id])).toEqual([['observability', 'conn-1']]);
    expect(evidence.verified).toBe(true);
  });

  it('verifies an automation decision as evidence for the incident and its service', async () => {
    const evidence = registry();
    const out = (await evidence.observe(
      'get_automation_decision',
      { incidentId: 'inc-1' },
      { decision: { mode: 'LIVE' }, explanation: 'No route rule matched.', serviceId: 'svc-1' }
    )) as Observed;
    expect(out.error).toBeUndefined();
    expect(out.evidence.map(e => e.kind).sort()).toEqual(['incident', 'service']);
    expect(evidence.verified).toBe(true);
  });

  it('verifies an empty automation decision against the incident alone', async () => {
    const evidence = registry();
    const out = (await evidence.observe(
      'get_automation_decision',
      { incidentId: 'inc-1' },
      { decision: null, note: 'Automation made no decision for this incident.' }
    )) as Observed;
    expect(out.evidence.map(e => e.kind)).toEqual(['incident']);
    expect(evidence.verified).toBe(true);
  });

  it('verifies an automation rule explanation as evidence for its service', async () => {
    const evidence = registry();
    const out = (await evidence.observe(
      'explain_automation_rule',
      { serviceId: 'svc-1', ruleName: 'Critical to P1' },
      { rule: null, rules: [], note: 'No rule with that id or name in the live version.' }
    )) as Observed;
    expect(out.evidence).toEqual([expect.objectContaining({ kind: 'service', id: 'svc-1' })]);
    expect(evidence.verified).toBe(true);
  });

  it('trims an oversized list by rows and marks it truncated instead of discarding it', async () => {
    const evidence = registry();
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `inc-${i}`,
      title: `Incident ${i} ${'x'.repeat(3_000)}`,
    }));
    const out = (await evidence.observe('search_incidents', { query: 'x' }, rows)) as Observed;
    expect(out.truncated).toBe(true);
    const kept = out.data as typeof rows;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(rows.length);
    expect(kept[0]).toEqual(rows[0]);
    expect(Buffer.byteLength(JSON.stringify(kept))).toBeLessThanOrEqual(32_768);
    expect(out.evidence).toHaveLength(kept.length);
    expect(evidence.notices().join(' ')).toMatch(/trimmed/i);
  });

  it('trims an oversized list inside an object result', async () => {
    const evidence = registry();
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `inc-${i}`,
      title: 'y'.repeat(3_000),
    }));
    const out = (await evidence.observe(
      'semantic_search_incidents',
      { query: 'y' },
      { items, coverage: { mode: 'EXACT' } }
    )) as Observed;
    expect(out.truncated).toBe(true);
    expect((out.data as { items: unknown[] }).items.length).toBeLessThan(items.length);
  });

  it('still refuses one oversized record that has no rows to trim', async () => {
    const evidence = registry();
    const out = (await evidence.observe(
      'get_incident',
      { id: 'inc-1' },
      { id: 'inc-1', description: 'z'.repeat(40_000) }
    )) as Observed;
    expect(out.error).toMatch(/could not be verified/);
  });

  it('shows the model short handles and keeps uuid, digest and read time on the server', async () => {
    const evidence = registry();
    const out = (await evidence.observe(
      'get_incident',
      { id: 'inc-1' },
      { id: 'inc-1', title: 'Checkout down' }
    )) as Observed;
    const again = (await evidence.observe(
      'get_runbook',
      { id: 'rb-1' },
      { id: 'rb-1', name: 'Reset pool' }
    )) as Observed;
    expect(out.evidence).toEqual([{ handle: 'E1', kind: 'incident', id: 'inc-1' }]);
    expect(again.evidence).toEqual([{ handle: 'E2', kind: 'runbook', id: 'rb-1' }]);
    const [source] = evidence.sources();
    expect(source.handle).toMatch(/^[0-9a-f-]{36}$/);
    expect(source.version).toMatch(/^[a-f0-9]{64}$/);
    // A short handle cites the source with its full server-side provenance.
    const [citation] = evidence.citations('Pool exhaustion [evidence:E1].');
    expect(citation).toMatchObject({ kind: 'incident', id: 'inc-1', handle: source.handle });
    expect(evidence.citations('Unrelated [evidence:E9].')).toEqual([]);
    // E1 must not also match E10+.
    expect(evidence.citations('see [evidence:E12]')).toEqual([]);
  });
});

describe('evidence cap and result shape', () => {
  const incidents = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `inc-${from + index}`,
      title: `Incident ${from + index}`,
    }));

  it('past the source cap returns the data without new citations, says so once, never "unavailable"', async () => {
    const evidence = registry();
    const first = (await evidence.observe('search_incidents', {}, incidents(0, 30))) as Observed;
    expect(first.evidence).toHaveLength(30);
    const over = (await evidence.observe('search_incidents', {}, incidents(25, 10))) as Observed;
    expect(over.error).toBeUndefined();
    expect(over.data).toHaveLength(10);
    // Only the five already-held sources keep their handles.
    expect(over.evidence.map(e => e.id)).toEqual([
      'inc-25',
      'inc-26',
      'inc-27',
      'inc-28',
      'inc-29',
    ]);
    await evidence.observe('search_incidents', {}, incidents(40, 3));
    expect(evidence.notices().filter(text => text.includes('without citations'))).toHaveLength(1);
    expect(evidence.verified).toBe(false);
    expect(evidence.sources()).toHaveLength(30);
  });

  it('puts the evidence handles before the data and trims to what the model receives', async () => {
    const evidence = registry();
    const big = Array.from({ length: 30 }, (_, index) => ({
      id: `inc-${index}`,
      title: 'x'.repeat(300),
    }));
    const out = (await evidence.observe('search_incidents', {}, big)) as Observed;
    expect(Object.keys(out)).toEqual(['evidence', 'truncated', 'data']);
    expect(JSON.stringify(out.data).length).toBeLessThanOrEqual(6_000);
    // Evidence is minted only for the rows that were kept.
    expect(out.evidence).toHaveLength((out.data as unknown[]).length);
    const narrow = (await registry().observe('search_incidents', {}, big, 1_800)) as Observed;
    expect(JSON.stringify(narrow.data).length).toBeLessThanOrEqual(1_800);
  });

  it('remembers which read tool returned each source', async () => {
    const evidence = registry();
    await evidence.observe('get_service', { id: 's1' }, { id: 's1', name: 'Checkout' });
    expect(evidence.entries().find(entry => entry.id === 's1')?.tools).toEqual(['get_service']);
  });
});
