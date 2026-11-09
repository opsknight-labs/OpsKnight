import { describe, expect, it } from 'vitest';
import { sanitizeContext } from '@/lib/logger';
import { policyAuditDetails } from '@/app/(app)/settings/integrations/mcp/policy-audit';

describe('log context sanitizing', () => {
  it('does not call a list that two members share circular, but still catches a real cycle', () => {
    const scopes = ['incidents:read', 'services:read'];
    expect(sanitizeContext({ dcrScopes: scopes, cimdScopes: scopes })).toEqual({
      dcrScopes: ['incidents:read', 'services:read'],
      cimdScopes: ['incidents:read', 'services:read'],
    });
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    expect(sanitizeContext(loop)).toEqual({ name: 'loop', self: '[CIRCULAR]' });
  });
});

describe('the policy audit entry', () => {
  it('keeps the idle days (recorded as idleDays) and a copy of each list', () => {
    const scopes = ['incidents:read'];
    const details = policyAuditDetails({
      sessionIdleDays: 30,
      dcrScopes: scopes,
      cimdScopes: scopes,
    });
    expect(details).toEqual({
      idleDays: 30,
      dcrScopes: ['incidents:read'],
      cimdScopes: ['incidents:read'],
    });
    expect(details.dcrScopes).not.toBe(details.cimdScopes);
    expect(sanitizeContext(details)).toMatchObject({ idleDays: 30 });
  });
});
