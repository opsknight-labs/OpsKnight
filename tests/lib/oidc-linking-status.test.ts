// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { oidcTrustFingerprint } from '@/lib/oidc/trust-fingerprint';
import { resolveOidcLinkingStatuses } from '@/lib/oidc-linking-status';

const issuer = 'https://login.microsoftonline.com/tenant-1/v2.0';
const appB = { id: 'default', issuer, clientId: 'app-b', configVersion: 3 };
const fingerprintA = oidcTrustFingerprint(issuer, 'app-a');
const fingerprintB = oidcTrustFingerprint(issuer, 'app-b');

type Identity = { userId: string; issuer: string; issuerFingerprint: string | null };
type Approval = {
  userId: string;
  revokedAt: Date | null;
  consumedAt: Date | null;
  expiresAt: Date | null;
  providerConfigId: string | null;
  issuerFingerprint: string | null;
  configVersion: number | null;
};

/** Minimal in-memory database that honours the filters the resolver sends. */
function database(identities: Identity[], approvals: Approval[] = []) {
  const findMany = vi.fn(
    async ({
      where,
    }: {
      where: {
        userId: { in: string[] };
        issuer?: { in: string[] };
        issuerFingerprint?: string | null;
      };
    }) => {
      const matches = identities.filter(
        identity =>
          where.userId.in.includes(identity.userId) &&
          (!where.issuer || where.issuer.in.includes(identity.issuer)) &&
          (where.issuerFingerprint === undefined ||
            identity.issuerFingerprint === where.issuerFingerprint)
      );
      return [...new Set(matches.map(identity => identity.userId))].map(userId => ({ userId }));
    }
  );
  const db = {
    oidcIdentity: { findMany },
    oidcLinkingApproval: {
      findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
        approvals.filter(approval => where.userId.in.includes(approval.userId))
      ),
    },
  };
  return db as never as Parameters<typeof resolveOidcLinkingStatuses>[0] & {
    oidcIdentity: { findMany: typeof findMany };
  };
}

const approval = (overrides: Partial<Approval> = {}): Approval => ({
  userId: 'alice',
  revokedAt: null,
  consumedAt: null,
  expiresAt: new Date(Date.now() + 86_400_000),
  providerConfigId: 'default',
  issuerFingerprint: fingerprintB,
  configVersion: 3,
  ...overrides,
});

describe('provider-aware account linking status', () => {
  it('does not report an Entra app A identity as linked to app B', async () => {
    const db = database([{ userId: 'alice', issuer, issuerFingerprint: fingerprintA }]);
    const statuses = await resolveOidcLinkingStatuses(db, ['alice'], appB);
    expect(statuses.get('alice')?.state).toBe('provider-changed');
  });

  it('reports linked only for an identity under the active issuer and client registration', async () => {
    const db = database([{ userId: 'alice', issuer, issuerFingerprint: fingerprintB }]);
    expect((await resolveOidcLinkingStatuses(db, ['alice'], appB)).get('alice')?.state).toBe(
      'linked'
    );
  });

  it('accepts legacy issuer spellings for the active trust boundary', async () => {
    const db = database([
      { userId: 'alice', issuer: `${issuer}/`, issuerFingerprint: fingerprintB },
    ]);
    expect((await resolveOidcLinkingStatuses(db, ['alice'], appB)).get('alice')?.state).toBe(
      'linked'
    );
  });

  it('does not assume a pre-fingerprint legacy identity belongs to the current registration', async () => {
    const db = database([{ userId: 'alice', issuer, issuerFingerprint: null }]);
    expect((await resolveOidcLinkingStatuses(db, ['alice'], appB)).get('alice')?.state).toBe(
      'provider-changed'
    );
  });

  it.each([
    ['approved', approval(), 'approved'],
    ['expired', approval({ expiresAt: new Date(Date.now() - 1) }), 'expired'],
    ['revoked', approval({ revokedAt: new Date() }), 'revoked'],
    ['issued for another provider', approval({ issuerFingerprint: fingerprintA }), 'stale'],
  ])('reports a %s first-link approval', async (_label, record, expected) => {
    const db = database([], [record]);
    expect((await resolveOidcLinkingStatuses(db, ['alice'], appB)).get('alice')?.state).toBe(
      expected
    );
  });

  it('returns the expiry of an approved first-link approval', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    const db = database([], [approval({ expiresAt })]);
    expect((await resolveOidcLinkingStatuses(db, ['alice'], appB)).get('alice')).toEqual({
      state: 'approved',
      approvalExpiresAt: expiresAt.toISOString(),
    });
  });

  it('treats a consumed approval without a current identity as not approved', async () => {
    const db = database([], [approval({ consumedAt: new Date() })]);
    expect((await resolveOidcLinkingStatuses(db, ['alice'], appB)).get('alice')?.state).toBe(
      'not-approved'
    );
  });

  it('resolves a full page with a fixed number of queries', async () => {
    const users = Array.from({ length: 25 }, (_, index) => `user-${index}`);
    const db = database(users.map(userId => ({ userId, issuer, issuerFingerprint: fingerprintA })));
    const statuses = await resolveOidcLinkingStatuses(db, users, appB);
    expect(statuses.size).toBe(25);
    expect(db.oidcIdentity.findMany).toHaveBeenCalledTimes(2);
  });

  it('falls back to any identity when no provider is active', async () => {
    const db = database([{ userId: 'alice', issuer, issuerFingerprint: fingerprintA }]);
    const statuses = await resolveOidcLinkingStatuses(db, ['alice', 'bob'], null);
    expect(statuses.get('alice')?.state).toBe('linked');
    expect(statuses.get('bob')?.state).toBe('not-approved');
  });
});
