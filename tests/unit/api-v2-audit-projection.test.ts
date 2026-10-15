/* eslint-disable @typescript-eslint/no-explicit-any -- arbitrary JSON documents / erased generic route plumbing */
import { describe, expect, it } from 'vitest';
import { projectAuditDetails } from '@/lib/api-v2/audit-projection';

describe('projectAuditDetails', () => {
  it('redacts credential-like keys and secret-shaped strings', () => {
    const out = projectAuditDetails({
      name: 'Primary',
      password: 'hunter2',
      webhookUrl: 'https://example.com/hook',
      note: `rotated ok_live_${'a'.repeat(43)} for ops@example.com`,
      nested: { clientSecret: 's3cr3t', ok: 1 },
    }) as Record<string, any>;
    expect(out.name).toBe('Primary');
    expect(out.password).toBe('[REDACTED]');
    expect(out.webhookUrl).toBe('[REDACTED]');
    expect(out.note).not.toContain('ok_live_');
    expect(out.note).not.toContain('ops@example.com');
    expect(out.nested.clientSecret).toBe('[REDACTED]');
    expect(out.nested.ok).toBe(1);
  });

  it('keeps non-secret identifiers that merely contain "key" or "token"', () => {
    const out = projectAuditDetails({
      apiKeyId: 'key_1',
      tokenName: 'ci',
      scopes: ['incidents:read'],
      apiGateway: 'api_v2',
    }) as Record<string, any>;
    expect(out.apiKeyId).toBe('key_1');
    expect(out.tokenName).toBe('ci');
    expect(out.scopes).toEqual(['incidents:read']);
  });

  it('bounds depth, width and string length', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'x' } } } } } };
    expect(JSON.stringify(projectAuditDetails(deep))).toContain('[TRUNCATED]');
    const wide = projectAuditDetails({ list: Array.from({ length: 500 }, (_, i) => i) }) as any;
    expect(wide.list).toHaveLength(50);
    const long = projectAuditDetails({ text: 'y'.repeat(5000) }) as any;
    expect(long.text.length).toBeLessThanOrEqual(501);
  });

  it('handles null and non-object details', () => {
    expect(projectAuditDetails(null)).toBeNull();
    expect(projectAuditDetails('plain')).toBe('plain');
  });
});
