import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { evaluateAudit, validateBaseline, validateAuditReport } = createRequire(import.meta.url)(
  '../../scripts/mcp/audit-gate.cjs'
) as typeof import('../../scripts/mcp/audit-gate.cjs');

const vulnerability = (severity: string, ids: string[]) => ({
  severity,
  via: ids.map(id => ({ url: 'https://github.com/advisories/' + id, title: 't' })),
});
const entry = (id: string, extra: Record<string, string> = {}) => ({
  id,
  package: 'zod',
  justification: 'reviewed',
  owner: 'maintainers',
  expires: '2027-01-01',
  ...extra,
});
const now = new Date('2026-10-28');

describe('dependency audit gate', () => {
  it('accepts only reviewed, unexpired baseline advisories', () => {
    const audit = { vulnerabilities: { zod: vulnerability('high', ['GHSA-aaaa-bbbb-cccc']) } };
    expect(evaluateAudit(audit, { advisories: [entry('GHSA-aaaa-bbbb-cccc')] }, now).ok).toBe(true);
    expect(evaluateAudit(audit, { advisories: [] }, now)).toMatchObject({
      ok: false,
      blocking: [{ state: 'NEW' }],
    });
    expect(
      evaluateAudit(
        audit,
        { advisories: [entry('GHSA-aaaa-bbbb-cccc', { expires: '2026-10-01' })] },
        now
      )
    ).toMatchObject({ ok: false, blocking: [{ state: 'BASELINE_EXPIRED' }] });
    expect(
      evaluateAudit(
        audit,
        { advisories: [entry('GHSA-aaaa-bbbb-cccc', { package: 'other' })] },
        now
      )
    ).toMatchObject({ ok: false, blocking: [{ state: 'BASELINE_PACKAGE_MISMATCH' }] });
  });

  it('blocks a new critical advisory next to an accepted one and ignores lower severities', () => {
    const audit = {
      vulnerabilities: {
        zod: vulnerability('high', ['GHSA-aaaa-bbbb-cccc']),
        left: vulnerability('critical', ['GHSA-dddd-eeee-ffff']),
        minor: vulnerability('moderate', ['GHSA-gggg-hhhh-iiii']),
      },
    };
    const result = evaluateAudit(audit, { advisories: [entry('GHSA-aaaa-bbbb-cccc')] }, now);
    expect(result.ok).toBe(false);
    expect(result.blocking).toEqual([
      { id: 'GHSA-dddd-eeee-ffff', package: 'left', state: 'NEW' },
    ]);
  });

  it('reports baseline entries that no longer apply and rejects malformed baselines', () => {
    expect(
      evaluateAudit({ vulnerabilities: {} }, { advisories: [entry('GHSA-aaaa-bbbb-cccc')] }, now)
        .staleBaselineEntries
    ).toEqual(['GHSA-aaaa-bbbb-cccc']);
    expect(() =>
      validateBaseline({ advisories: [{ ...entry('GHSA-aaaa-bbbb-cccc'), owner: '' }] })
    ).toThrow();
    expect(() => validateBaseline({ advisories: [entry('not-an-id')] })).toThrow();
    expect(() =>
      validateBaseline({ advisories: [entry('GHSA-aaaa-bbbb-cccc', { expires: 'soon' })] })
    ).toThrow();
  });

  it('fails closed when npm audit returns an error document or inconsistent counts', () => {
    expect(() => validateAuditReport({ error: { code: 'ENOAUDIT' } })).toThrow(
      'complete JSON audit report'
    );
    expect(() =>
      validateAuditReport({
        vulnerabilities: {},
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
        },
      })
    ).toThrow('counts disagree');
    expect(() =>
      validateAuditReport({
        vulnerabilities: { zod: { severity: 'high', via: [] } },
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
        },
      })
    ).toThrow('malformed vulnerability entry');
  });

  it('accepts a valid clean audit report and traceable transitive advisories', () => {
    const clean = {
      vulnerabilities: {},
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      },
    };
    expect(validateAuditReport(clean)).toBe(clean);
    const report = {
      vulnerabilities: {
        zod: vulnerability('high', ['GHSA-aaaa-bbbb-cccc']),
        wrapper: { severity: 'high', via: ['zod'] },
      },
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 },
      },
    };
    expect(validateAuditReport(report)).toBe(report);
    expect(() =>
      validateAuditReport({
        vulnerabilities: { wrapper: { severity: 'high', via: ['missing-package'] } },
        metadata: {
          vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
        },
      })
    ).toThrow('no verifiable advisory cause');
  });

  it('rejects duplicate baseline advisory IDs rather than silently shadowing the earlier entry', () => {
    expect(() =>
      validateBaseline({
        advisories: [
          entry('GHSA-aaaa-bbbb-cccc'),
          entry('GHSA-aaaa-bbbb-cccc', { expires: '2027-02-01' }),
        ],
      })
    ).toThrow('Duplicate advisory id');
  });
});
