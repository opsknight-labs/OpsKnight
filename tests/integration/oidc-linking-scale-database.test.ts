// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { approveBulkLinking, previewBulkLinking } from '@/lib/oidc-linking-bulk';
import { recordOidcLinkingRequest } from '@/lib/oidc-linking-requests';
import { resolveOidcIdentityForSignIn } from '@/lib/oidc-identity-resolution';
import { oidcTrustFingerprint } from '@/lib/oidc/trust-fingerprint';

const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
const run = randomUUID().slice(0, 8);
const issuer = 'https://idp.linking.example.test';
const entraIssuer = 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0';
const clientId = 'linking-client';
const domain = `acme-${run}.example.test`;
const email = (name: string, at = domain) => `${name}-${run}@${at}`;

async function user(name: string, overrides: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { name, email: email(name), role: 'USER', roleSource: 'MANUAL', ...overrides },
  });
}

function resolve(input: Record<string, unknown>) {
  return resolveOidcIdentityForSignIn({
    issuer,
    subject: randomUUID(),
    email: null,
    displayName: null,
    providerType: 'custom',
    emailVerifiedClaim: true,
    requireEmailVerifiedClaim: true,
    autoProvision: false,
    allowedDomains: [domain],
    clientId,
    configVersion: 3,
    providerConfigId: 'default',
    ...input,
  } as Parameters<typeof resolveOidcIdentityForSignIn>[0]);
}

suite('linking existing accounts at scale', () => {
  let configOwner = '';
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_sso_test'))
      throw new Error('Isolated enterprise_sso_test DB required.');
    configOwner = (await user('config-owner', { role: 'ADMIN' })).id;
  });
  beforeEach(async () => {
    await prisma.oidcConfig.deleteMany();
    await prisma.oidcConfig.create({
      data: {
        id: 'default',
        issuer,
        clientId,
        clientSecret: 'encrypted',
        configVersion: 3,
        allowedDomains: [domain],
        updatedBy: configOwner,
      },
    });
  });
  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { contains: run } },
      select: { id: true },
    });
    const ids = users.map(row => row.id);
    await prisma.oidcConfig.deleteMany();
    await prisma.inAppNotification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.oidcLinkingApproval.deleteMany({ where: { userId: { in: ids } } });
    await prisma.oidcIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('approves everyone in a domain except administrators, bound to the provider and their email', async () => {
    const a = await user('bulk-a');
    const b = await user('bulk-b');
    const admin = await user('bulk-admin', { role: 'ADMIN' });
    await prisma.user.create({ data: { name: 'Elsewhere', email: email('other', 'other.test') } });

    const preview = await previewBulkLinking({ scope: 'domain', domains: [domain] });
    expect(preview.count).toBe(2);
    expect(preview.sample.map(row => row.id).sort()).toEqual([a.id, b.id].sort());

    const result = await approveBulkLinking(
      { scope: 'domain', domains: [domain], expiryDays: 14 },
      admin.id
    );
    expect(result).toMatchObject({ approved: 2, remaining: 0 });
    const approvals = await prisma.oidcLinkingApproval.findMany({
      where: { userId: { in: [a.id, b.id, admin.id] } },
    });
    expect(approvals).toHaveLength(2);
    for (const approval of approvals) {
      expect(approval.issuerFingerprint).toBe(oidcTrustFingerprint(issuer, clientId));
      expect(approval.configVersion).toBe(3);
      expect(approval.expiresAt!.getTime() - Date.now()).toBeGreaterThan(13 * 24 * 3600 * 1000);
    }
    // Running it again approves nobody new.
    expect((await previewBulkLinking({ scope: 'domain', domains: [domain] })).count).toBe(0);

    // An approved person links on their first sign-in.
    const linked = await resolve({ email: email('bulk-a') });
    expect(linked).toMatchObject({ ok: true, identityCreated: true, linkMethod: 'APPROVAL' });
  });

  it('includes an administrator only when selected explicitly', async () => {
    const admin = await user('explicit-admin', { role: 'ADMIN' });
    expect((await previewBulkLinking({ scope: 'all' })).sample.map(row => row.id)).not.toContain(
      admin.id
    );
    expect((await previewBulkLinking({ scope: 'selected', userIds: [admin.id] })).count).toBe(1);
  });

  it('links domain-trusted accounts without approval, but never administrators', async () => {
    await user('trusted');
    await user('trusted-admin', { role: 'ADMIN' });
    expect(await resolve({ email: email('trusted'), domainTrustedLinking: true })).toMatchObject({
      ok: true,
      linkMethod: 'DOMAIN_TRUSTED',
      approvalConsumed: false,
    });
    expect(await resolve({ email: email('trusted-admin'), domainTrustedLinking: true })).toEqual({
      ok: false,
      reason: 'OIDC_LINK_NOT_APPROVED',
    });
  });

  it('requires Entra to prove the email domain with xms_edov', async () => {
    await user('entra-plain');
    await user('entra-proven');
    // Entra may omit email_verified; production does not require it there.
    const entra = {
      issuer: entraIssuer,
      providerType: 'azure',
      emailVerifiedClaim: undefined,
      requireEmailVerifiedClaim: false,
    };
    expect(
      await resolve({ ...entra, email: email('entra-plain'), domainTrustedLinking: true })
    ).toEqual({ ok: false, reason: 'OIDC_LINK_NOT_APPROVED' });
    expect(
      await resolve({
        ...entra,
        email: email('entra-proven'),
        domainTrustedLinking: true,
        claims: { xms_edov: true },
      })
    ).toMatchObject({ ok: true, linkMethod: 'DOMAIN_TRUSTED' });
  });

  it('finds an account whose stored email differs only in letter case', async () => {
    const mixed = await prisma.user.create({
      data: { name: 'Mixed', email: `Mixed.Case-${run}@${domain}`, role: 'USER' },
    });
    const result = await resolve({
      email: `mixed.case-${run}@${domain}`,
      domainTrustedLinking: true,
    });
    expect(result).toMatchObject({ ok: true, user: { id: mixed.id } });
  });

  it('turns a blocked first sign-in into one request and one notification per day', async () => {
    const requester = await user('requester');
    const admin = await user('request-admin', { role: 'ADMIN', status: 'ACTIVE' });
    expect(await recordOidcLinkingRequest(email('requester'), 'OIDC_LINK_NOT_APPROVED')).toBe(true);
    expect(await recordOidcLinkingRequest(email('requester'), 'OIDC_LINK_NOT_APPROVED')).toBe(true);
    const request = await prisma.oidcLinkingRequest.findUniqueOrThrow({
      where: { userId: requester.id },
    });
    expect(request.attempts).toBe(2);
    const notifications = await prisma.inAppNotification.findMany({
      where: { userId: admin.id, entityType: 'SSO_LINK_REQUEST', entityId: requester.id },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toContain('needs your approval');

    await approveBulkLinking({ scope: 'selected', userIds: [requester.id] }, admin.id);
    expect(await prisma.oidcLinkingRequest.count({ where: { userId: requester.id } })).toBe(0);
    // Unknown people never create requests.
    expect(await recordOidcLinkingRequest(email('nobody'), 'OIDC_LINK_NOT_APPROVED')).toBe(false);
  });
});
