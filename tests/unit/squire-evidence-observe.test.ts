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
