// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  computeSignature,
  extendedWindowEnd,
  isCriticalIncident,
  scopeHash,
  windowFor,
  type CorrelationFingerprint,
} from '@/lib/intelligence/correlation/rules';
import type { CorrelationRule } from '@/lib/intelligence/contract';

const fp = (overrides: Partial<CorrelationFingerprint> = {}): CorrelationFingerprint => ({
  serviceId: 'svc-1',
  template: 'database connection errors on db-primary-<num>',
  labels: { env: 'prod', region: 'eu-west-1' },
  ...overrides,
});

const rule = (overrides: Partial<CorrelationRule> = {}): CorrelationRule => ({
  id: 'r1',
  kind: 'CONTENT_TEMPLATE',
  enabled: true,
  keys: [],
  windowSeconds: 300,
  maxWindowSeconds: 900,
  minScore: 0.8,
  ...overrides,
});

describe('signatures', () => {
  it('matches incidents that share a masked template and separates different problems', () => {
    const a = computeSignature(rule(), fp());
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(computeSignature(rule(), fp({ serviceId: 'svc-2' }))).toBe(a); // template rules ignore service
    expect(computeSignature(rule(), fp({ template: 'disk space low on node-<num>' }))).not.toBe(a);
  });

  it('is deterministic and independent of key and label order', () => {
    const r1 = rule({ kind: 'LABEL_SET', keys: ['region', 'env'] });
    const r2 = rule({ kind: 'LABEL_SET', keys: ['env', 'region'] });
    expect(computeSignature(r1, fp())).toBe(computeSignature(r2, fp({ labels: { region: 'eu-west-1', env: 'prod' } })));
  });

  it('does not apply when a required field or label is missing', () => {
    expect(computeSignature(rule({ kind: 'LABEL_SET', keys: ['cluster'] }), fp())).toBeNull();
    expect(computeSignature(rule({ kind: 'LABEL_SET', keys: ['env', 'cluster'] }), fp())).toBeNull();
    expect(computeSignature(rule(), fp({ template: '' }))).toBeNull();
    expect(computeSignature(rule({ kind: 'EXACT_FIELD', keys: ['env'] }), fp({ labels: { env: '' } }))).toBeNull();
  });

  it('lets exact-field rules key on the built-in service and template fields', () => {
    const byService = rule({ kind: 'EXACT_FIELD', keys: ['service', 'env'] });
    expect(computeSignature(byService, fp())).toBe(computeSignature(byService, fp({ template: 'something else' })));
    expect(computeSignature(byService, fp())).not.toBe(computeSignature(byService, fp({ serviceId: 'svc-9' })));
  });

  it('keeps label-set rules to labels only', () => {
    expect(computeSignature(rule({ kind: 'LABEL_SET', keys: ['service'] }), fp())).toBeNull();
  });

  it('separates rule kinds so identical keys under different kinds cannot collide', () => {
    const exact = computeSignature(rule({ kind: 'EXACT_FIELD', keys: ['env'] }), fp());
    const labels = computeSignature(rule({ kind: 'LABEL_SET', keys: ['env'] }), fp());
    expect(exact).not.toBe(labels);
  });

  it('is unambiguous when values contain delimiters', () => {
    const r = rule({ kind: 'EXACT_FIELD', keys: ['a', 'b'] });
    const one = computeSignature(r, fp({ labels: { a: 'x=y', b: 'z' } }));
    const two = computeSignature(r, fp({ labels: { a: 'x', b: 'y=z' } }));
    expect(one).not.toBe(two);
  });

  it('never throws on hostile input', () => {
    const hostile = fp({ template: 'x'.repeat(100_000), labels: { '': 'v', 'a\u001fb': 'c\u001fd' } });
    expect(() => computeSignature(rule(), hostile)).not.toThrow();
    expect(() => computeSignature(rule({ kind: 'LABEL_SET', keys: ['a\u001fb'] }), hostile)).not.toThrow();
  });
});

describe('scope hash', () => {
  it('is order-insensitive and distinguishes service sets', () => {
    expect(scopeHash(['b', 'a'])).toBe(scopeHash(['a', 'b', 'a']));
    expect(scopeHash(['a'])).not.toBe(scopeHash(['a', 'b']));
  });
});

describe('windows', () => {
  const r = { windowSeconds: 300, maxWindowSeconds: 900 };

  it('places an instant in a fixed bucket derived from the instant itself', () => {
    const at = new Date('2026-10-27T10:07:42Z');
    const w = windowFor(at, r);
    expect(w.windowStart.toISOString()).toBe('2026-10-27T10:05:00.000Z');
    expect(w.windowEnd.toISOString()).toBe('2026-10-27T10:10:00.000Z');
    expect(w.maxWindowEnd.toISOString()).toBe('2026-10-27T10:20:00.000Z');
    expect(windowFor(new Date('2026-10-27T10:05:00Z'), r).windowStart).toEqual(w.windowStart);
    expect(windowFor(new Date('2026-10-27T10:10:00Z'), r).windowStart).not.toEqual(w.windowStart);
  });

  it('extends a window as incidents keep arriving but never past the ceiling', () => {
    const base = windowFor(new Date('2026-10-27T10:05:00Z'), r);
    const extended = extendedWindowEnd(base, new Date('2026-10-27T10:09:00Z'), 300);
    expect(extended.toISOString()).toBe('2026-10-27T10:14:00.000Z');
    expect(extendedWindowEnd(base, new Date('2026-10-27T10:19:00Z'), 300).toISOString()).toBe('2026-10-27T10:20:00.000Z');
  });

  it('never shrinks a window', () => {
    const base = windowFor(new Date('2026-10-27T10:05:00Z'), r);
    expect(extendedWindowEnd(base, new Date('2026-10-27T10:00:00Z'), 30)).toEqual(base.windowEnd);
  });
});

describe('critical bypass', () => {
  it('treats highest urgency as never groupable', () => {
    expect(isCriticalIncident({ urgency: 'HIGH' })).toBe(true);
    expect(isCriticalIncident({ urgency: 'MEDIUM' })).toBe(false);
    expect(isCriticalIncident({ urgency: 'LOW' })).toBe(false);
  });
});
