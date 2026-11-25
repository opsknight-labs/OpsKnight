import { describe, expect, it } from 'vitest';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { isCheckableHostname, mapDomainDnsResult } from '@/lib/status-pages/domain-dns';

const base = { domain: 'status.acme.com', appHost: 'app.ops.io', appAddresses: ['1.1.1.1'] };

describe('domain DNS mapping', () => {
  it('verifies a CNAME to the app host, ignoring case and trailing dot', () => {
    const r = mapDomainDnsResult({ ...base, cname: ['App.Ops.io.'], addresses: [] });
    expect(r.state).toBe('verified');
  });
  it('verifies overlapping address records for apex domains', () => {
    expect(mapDomainDnsResult({ ...base, cname: [], addresses: ['1.1.1.1'] }).state).toBe(
      'verified'
    );
  });
  it('is pending when nothing resolves', () => {
    expect(mapDomainDnsResult({ ...base, cname: [], addresses: [] }).state).toBe('pending');
  });
  it('is a mismatch for a foreign CNAME or foreign addresses and names the expected record', () => {
    const c = mapDomainDnsResult({ ...base, cname: ['other.net'], addresses: [] });
    expect(c.state).toBe('mismatch');
    expect(c.message).toContain('other.net');
    expect(c.expected).toEqual({ type: 'CNAME', host: 'status.acme.com', value: 'app.ops.io' });
    expect(mapDomainDnsResult({ ...base, cname: [], addresses: ['9.9.9.9'] }).state).toBe(
      'mismatch'
    );
  });
  it('rejects hostnames that must never be looked up', () => {
    for (const bad of ['localhost', '127.0.0.1', 'db.internal', 'a', '::1', 'x.local', 'a b.com'])
      expect(isCheckableHostname(bad), bad).toBe(false);
    expect(isCheckableHostname('status.acme.com')).toBe(true);
  });
});

describe('status page manage gate (domain check, override, IP allow-list writers)', () => {
  const actor = (role: string) =>
    ({ id: 'u1', role, status: 'ACTIVE', teamIds: [] }) as Parameters<typeof authorize>[0]['actor'];
  it('allows admins and denies every other built-in role', () => {
    const can = (role: string) =>
      authorize({ actor: actor(role), action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE }).allowed;
    expect(can('ADMIN')).toBe(true);
    for (const role of ['AUDITOR', 'USER', 'STAKEHOLDER', 'RESPONDER'])
      expect(can(role), role).toBe(false);
  });
});
