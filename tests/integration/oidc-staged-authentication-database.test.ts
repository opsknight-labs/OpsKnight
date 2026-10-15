// @vitest-environment node
/* eslint-disable security/detect-non-literal-fs-filename -- Certificate paths are generated exclusively inside an isolated mkdtemp directory. */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignJWT, exportJWK } from 'jose';
import { custom } from 'openid-client';
import prisma from '@/lib/prisma';
import {
  stageOidcRevision,
  beginOidcRevisionTest,
  completeOidcRevisionTest,
  activateOidcRevision,
  enforcementPreview,
  deleteOidcRevision,
  cleanupStagedRevisions,
} from '@/lib/auth-control/oidc-revisions';
import { authenticationOrigin } from '@/lib/auth-control/origin';
import { restorePasswordAccess } from '@/lib/auth-control/recovery';
import { evaluateAuthenticationPolicy } from '@/lib/authentication-policy-evaluator';
import { searchAuthenticationUsers, identityClaimsPreview } from '@/lib/auth-control/dashboard';
import { digest, secret } from '@/lib/auth-control/emergency';
import { inviteSsoUser } from '@/lib/auth-control/sso-onboarding';
import type { ControlActor } from '@/lib/auth-control/actor';

const entraIssuer = 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0';
const runtime = vi.hoisted(() => ({ issuer: '' }));
vi.mock('@/lib/auth-control/actor', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/auth-control/actor')>();
  return { ...actual, getControlActor: vi.fn(() => actor) };
});
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(), resetAuthOptionsCache: vi.fn() }));
vi.mock('@/lib/auth-control/origin', () => ({
  authenticationOrigin: vi.fn().mockResolvedValue('https://recovery.example.test'),
  recoveryOrigin: vi.fn().mockResolvedValue('https://recovery.example.test'),
}));
// Discovery shape is covered by the provider matrix suite. This suite exercises real
// HTTPS token exchange, RS256/JWKS, nonce, PKCE, identity binding and activation.
vi.mock('@/lib/oidc-validation', () => ({
  resetOidcRuntimeMetadataCache: vi.fn(),
  validateOidcConnection: vi.fn(async (issuer: string) => ({
    isValid: true,
    metadata: {
      issuer,
      authorizationEndpoint: `${runtime.issuer}/authorize`,
      tokenEndpoint: `${runtime.issuer}/token`,
      jwksUri: `${runtime.issuer}/jwks`,
    },
  })),
}));
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
const actor: ControlActor = {
  kind: 'admin',
  id: 'staged-oidc-certifier',
  tokenVersion: 0,
  authenticatedAt: Date.now(),
  method: 'credentials',
  issuedUnderPolicyVersion: 900,
};
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const codes = new Map<string, { nonce: string; challenge: string; variant: string }>();
let recoveryActor: ControlActor;
const readyIds: string[] = [];
let server: Server;
let directory: string;
let revisionId: string;
const callbackState = (url: string) => new URL(url).searchParams.get('state')!;
function issueCode(url: string, variant = 'valid') {
  const params = new URL(url).searchParams;
  const code = randomBytes(32).toString('hex');
  codes.set(code, {
    nonce: params.get('nonce')!,
    challenge: params.get('code_challenge')!,
    variant,
  });
  return code;
}

suite('staged OIDC authentication with HTTPS and signed ID tokens', () => {
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_sso_test'))
      throw new Error('Isolated enterprise_sso_test DB required.');
    vi.stubEnv('OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS', 'localhost');
    vi.stubEnv('ENCRYPTION_KEY', randomBytes(32).toString('hex'));
    directory = mkdtempSync(join(tmpdir(), 'opsknight-oidc-cert-'));
    const cert = join(directory, 'cert.pem');
    const key = join(directory, 'key.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost',
      ],
      { stdio: 'ignore' }
    );
    custom.setHttpOptionsDefaults({ ca: readFileSync(cert) });
    const jwk = await exportJWK(keys.publicKey);
    server = createServer(
      { key: readFileSync(key), cert: readFileSync(cert) },
      (request, response) => {
        const handle = async () => {
          response.setHeader('Content-Type', 'application/json');
          if (request.url === '/jwks') {
            response.end(
              JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', use: 'sig', alg: 'RS256' }] })
            );
            return;
          }
          if (request.url !== '/token') {
            response.writeHead(404).end();
            return;
          }
          let body = '';
          for await (const chunk of request) body += chunk;
          const params = new URLSearchParams(body);
          const code = params.get('code')!;
          const details = codes.get(code);
          codes.delete(code);
          const verifier = params.get('code_verifier') || '';
          if (
            !details ||
            createHash('sha256').update(verifier).digest('base64url') !== details.challenge ||
            request.headers.authorization !==
              `Basic ${Buffer.from('test-client:test-secret').toString('base64')}` ||
            params.get('redirect_uri') !==
              'https://recovery.example.test/api/auth/oidc/test/callback'
          ) {
            response.writeHead(400).end(JSON.stringify({ error: 'invalid_grant' }));
            return;
          }
          const idToken = await new SignJWT({
            hasgroups: details.variant === 'overage' ? true : undefined,
            groups: details.variant === 'groups-valid' ? ['administrators'] : undefined,
            email:
              details.variant === 'entra-no-email'
                ? undefined
                : details.variant === 'email'
                  ? 'foreign@example.test'
                  : 'staged-certifier@example.test',
            email_verified:
              details.variant === 'true-string'
                ? ' TRUE '
                : details.variant === 'true-number'
                  ? 1
                  : details.variant === 'false-string'
                    ? ' false '
                    : details.variant === 'false-number'
                      ? 0
                      : details.variant === 'missing-verification'
                        ? undefined
                        : details.variant.startsWith('entra-')
                          ? undefined
                          : details.variant !== 'unverified',
            nonce: details.variant === 'nonce' ? 'foreign-nonce' : details.nonce,
          })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
            .setIssuer(details.variant.startsWith('entra-') ? entraIssuer : runtime.issuer)
            .setAudience(details.variant === 'audience' ? 'wrong-client' : 'test-client')
            .setSubject('existing-admin-subject')
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(keys.privateKey);
          response.end(
            JSON.stringify({
              access_token: 'test-access-token',
              token_type: 'Bearer',
              expires_in: 300,
              id_token: idToken,
            })
          );
        };
        void handle().catch(() => {
          response.writeHead(500).end();
        });
      }
    );
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server address unavailable');
    runtime.issuer = `https://localhost:${address.port}`;
    await prisma.user.upsert({
      where: { id: actor.id },
      create: {
        id: actor.id,
        name: 'Staged OIDC Certifier',
        email: 'staged-certifier@example.test',
        role: 'ADMIN',
        status: 'ACTIVE',
        roleSource: 'MANUAL',
      },
      update: { role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0, roleSource: 'MANUAL' },
    });
    await prisma.oidcIdentity.deleteMany({ where: { userId: actor.id } });
    await prisma.oidcConfig.deleteMany();
    await prisma.authenticationPolicy.upsert({
      where: { id: 'default' },
      create: { id: 'default', mode: 'PASSWORD_ONLY', version: 900, legacySnapshot: {} },
      update: {
        passwordRecoveryUserId: null,
        passwordRecoveryExpiresAt: null,
        recoveryDegradedAt: null,
        mode: 'PASSWORD_ONLY',
        version: 900,
        passwordSessionMinVersion: 0,
        oidcSessionMinVersion: 0,
        activeRevisionId: null,
      },
    });
  });
  afterAll(async () => {
    await prisma.emergencySession.deleteMany({ where: { emergencyAccountId: { in: readyIds } } });
    await prisma.emergencyCredential.deleteMany({
      where: { emergencyAccountId: { in: readyIds } },
    });
    await prisma.emergencyAccount.deleteMany({ where: { id: { in: readyIds } } });
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (directory) rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });
  it('stages encrypted configuration without changing production or creating an ordinary session', async () => {
    const staged = await stageOidcRevision(actor, {
      issuer: runtime.issuer,
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });
    revisionId = staged.revisionId;
    expect(await prisma.oidcConfig.count()).toBe(0);
    expect(
      JSON.stringify(
        (await prisma.oidcRevision.findUniqueOrThrow({ where: { id: revisionId } })).configuration
      )
    ).not.toContain('test-secret');
    expect((await enforcementPreview(revisionId)).adminVerified).toBe(false);
  });
  it.each(['nonce', 'audience', 'email', 'unverified'])(
    'rejects signed but invalid %s proof without altering production',
    async variant => {
      const flow = await beginOidcRevisionTest(actor, revisionId, actor.id, true);
      const code = issueCode(flow.url, variant);
      await expect(
        completeOidcRevisionTest(callbackState(flow.url), code, flow.browserToken)
      ).rejects.toThrow('test failed');
      expect(await prisma.oidcConfig.count()).toBe(0);
      expect(await prisma.oidcRevisionTest.count({ where: { revisionId } })).toBe(0);
    }
  );
  it('rejects foreign-browser state and requires explicit first-link ownership approval', async () => {
    const flow = await beginOidcRevisionTest(actor, revisionId, actor.id, false);
    const code = issueCode(flow.url);
    await expect(
      completeOidcRevisionTest(callbackState(flow.url), code, 'foreign-browser')
    ).rejects.toThrow('another browser');
    await expect(
      completeOidcRevisionTest(callbackState(flow.url), code, flow.browserToken)
    ).rejects.toThrow('test failed');
  });
  it('rejects first-link takeover of an identity owned under a legacy issuer alias', async () => {
    const other = await prisma.user.create({
      data: { name: 'Legacy identity owner', email: 'legacy-owner@example.test', role: 'USER' },
    });
    try {
      await prisma.oidcIdentity.create({
        data: { userId: other.id, issuer: `${runtime.issuer}/`, subject: 'existing-admin-subject' },
      });
      const flow = await beginOidcRevisionTest(actor, revisionId, actor.id, true);
      await expect(
        completeOidcRevisionTest(callbackState(flow.url), issueCode(flow.url), flow.browserToken)
      ).rejects.toThrow('test failed');
      expect(await prisma.oidcRevisionTest.count({ where: { revisionId } })).toBe(0);
      expect(await prisma.oidcIdentity.count({ where: { userId: actor.id } })).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });
  it.each([
    'true-string',
    'true-number',
    'valid',
    'false-string',
    'false-number',
    'unverified',
    'missing-verification',
  ])('generic allowed-domain parity with signed claims: %s', async variant => {
    const staged = await stageOidcRevision(actor, {
      issuer: runtime.issuer,
      providerType: 'custom',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      allowedDomains: ['example.test'],
    });
    const verified =
      variant === 'true-string'
        ? ' TRUE '
        : variant === 'true-number'
          ? 1
          : variant === 'valid'
            ? true
            : variant === 'false-string'
              ? 'false'
              : variant === 'false-number'
                ? 0
                : variant === 'unverified'
                  ? false
                  : undefined;
    const accepted = ['true-string', 'true-number', 'valid'].includes(variant);
    try {
      const preview = await identityClaimsPreview(staged.revisionId, {
        iss: runtime.issuer,
        sub: 'existing-admin-subject',
        email: ' STAGED-CERTIFIER@EXAMPLE.TEST ',
        email_verified: verified,
      });
      expect(preview.outcome).toBe(accepted ? 'LINK_APPROVAL_REQUIRED' : 'REJECT');
      const flow = await beginOidcRevisionTest(actor, staged.revisionId, actor.id, true);
      const result = completeOidcRevisionTest(
        callbackState(flow.url),
        issueCode(flow.url, variant),
        flow.browserToken
      );
      if (accepted) await expect(result).resolves.toBe(staged.revisionId);
      else await expect(result).rejects.toThrow('test failed');
    } finally {
      await prisma.oidcRevision.delete({ where: { id: staged.revisionId } });
    }
  });
  it.each(['overage', 'groups-valid'])(
    'keeps identity recognition separate from signed administrator readiness: %s',
    async variant => {
      const staged = await stageOidcRevision(actor, {
        issuer: runtime.issuer,
        providerType: 'custom',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        roleMapping: [{ claim: 'groups', value: 'administrators', role: 'ADMIN' }],
      });
      await prisma.oidcIdentity.create({
        data: { issuer: runtime.issuer, subject: 'existing-admin-subject', userId: actor.id },
      });
      try {
        const preview = await identityClaimsPreview(staged.revisionId, {
          iss: runtime.issuer,
          sub: 'existing-admin-subject',
          email: 'staged-certifier@example.test',
          email_verified: true,
          ...(variant === 'overage' ? { hasgroups: true } : { groups: ['administrators'] }),
        });
        expect(preview.outcome).toBe('EXISTING_IDENTITY');
        expect('identityRecognized' in preview && preview.identityRecognized).toBe(true);
        expect(preview.administratorVerification?.ready).toBe(variant !== 'overage');
        if (variant === 'overage')
          expect(preview.administratorVerification?.reason).toContain(
            'blocked by incomplete group claims'
          );
        const flow = await beginOidcRevisionTest(actor, staged.revisionId, actor.id, false);
        const result = completeOidcRevisionTest(
          callbackState(flow.url),
          issueCode(flow.url, variant),
          flow.browserToken
        );
        if (variant === 'overage') await expect(result).rejects.toThrow('test failed');
        else await expect(result).resolves.toBe(staged.revisionId);
      } finally {
        await prisma.oidcIdentity.deleteMany({ where: { issuer: runtime.issuer } });
        await prisma.oidcRevision.delete({ where: { id: staged.revisionId } });
      }
    }
  );
  it.each(['unverified', 'false-string', 'false-number', 'missing-verification'])(
    'linked staged identity uses production claim normalization: %s',
    async variant => {
      await prisma.oidcIdentity.create({
        data: {
          issuer: runtime.issuer,
          subject: 'existing-admin-subject',
          userId: actor.id,
        },
      });
      try {
        const value =
          variant === 'unverified'
            ? false
            : variant === 'false-string'
              ? ' false '
              : variant === 'false-number'
                ? 0
                : undefined;
        const preview = await identityClaimsPreview(revisionId, {
          iss: runtime.issuer,
          sub: 'existing-admin-subject',
          email_verified: value,
        });
        expect(preview.outcome).toBe(
          variant === 'missing-verification' ? 'EXISTING_IDENTITY' : 'REJECT'
        );
        const flow = await beginOidcRevisionTest(actor, revisionId, actor.id, false);
        const result = completeOidcRevisionTest(
          callbackState(flow.url),
          issueCode(flow.url, variant),
          flow.browserToken
        );
        if (variant === 'missing-verification') await expect(result).resolves.toBe(revisionId);
        else await expect(result).rejects.toThrow('test failed');
      } finally {
        await prisma.oidcIdentity.deleteMany({ where: { issuer: runtime.issuer } });
        await prisma.oidcRevisionTest.deleteMany({ where: { revisionId } });
      }
    }
  );
  it.each([
    { linked: true, email: false, approved: false, succeeds: true },
    { linked: true, email: true, approved: false, succeeds: true },
    { linked: false, email: false, approved: true, succeeds: false },
    { linked: false, email: true, approved: false, succeeds: false },
    { linked: false, email: true, approved: true, succeeds: true },
  ])('Entra staged ownership: %j', async ({ linked, email, approved, succeeds }) => {
    const staged = await stageOidcRevision(actor, {
      issuer: entraIssuer,
      providerType: 'azure',
      clientId: 'test-client',
      clientSecret: 'test-secret',
    });
    try {
      if (linked)
        await prisma.oidcIdentity.create({
          data: { issuer: entraIssuer, subject: 'existing-admin-subject', userId: actor.id },
        });
      const preview = await identityClaimsPreview(staged.revisionId, {
        iss: entraIssuer,
        sub: 'existing-admin-subject',
        ...(email ? { email: 'staged-certifier@example.test' } : {}),
      });
      expect(preview.outcome).toBe(
        linked ? 'EXISTING_IDENTITY' : email ? 'LINK_APPROVAL_REQUIRED' : 'REJECT'
      );
      const flow = await beginOidcRevisionTest(actor, staged.revisionId, actor.id, approved);
      const result = completeOidcRevisionTest(
        callbackState(flow.url),
        issueCode(flow.url, email ? 'entra-email' : 'entra-no-email'),
        flow.browserToken
      );
      if (succeeds) {
        await expect(result).resolves.toBe(staged.revisionId);
        const proof = await prisma.oidcRevisionTest.findFirstOrThrow({
          where: { revisionId: staged.revisionId },
        });
        expect(proof.adminUserId).toBe(actor.id);
        expect(proof.linkApproved).toBe(!linked && approved);
        expect(proof.email).toBe(email ? 'staged-certifier@example.test' : '');
        if (linked) {
          await prisma.oidcIdentity.deleteMany({ where: { issuer: entraIssuer } });
          await expect(
            activateOidcRevision(
              actor,
              staged.revisionId,
              900,
              'SSO_OPTIONAL',
              'ACTIVATE VERIFIED SSO'
            )
          ).rejects.toThrow('linking readiness changed');
        }
      } else await expect(result).rejects.toThrow('test failed');
      expect(await prisma.oidcConfig.count()).toBe(0);
    } finally {
      await prisma.oidcIdentity.deleteMany({ where: { issuer: entraIssuer } });
      await prisma.oidcRevision.delete({ where: { id: staged.revisionId } });
    }
  });
  it('records a real code/PKCE/nonce/JWKS verified administrator proof only once', async () => {
    const flow = await beginOidcRevisionTest(actor, revisionId, actor.id, true);
    const code = issueCode(flow.url);
    await completeOidcRevisionTest(callbackState(flow.url), code, flow.browserToken);
    await expect(
      completeOidcRevisionTest(callbackState(flow.url), code, flow.browserToken)
    ).rejects.toThrow('replayed');
    expect((await enforcementPreview(revisionId)).adminVerified).toBe(true);
    vi.mocked(authenticationOrigin).mockResolvedValueOnce('https://moved.example.test');
    expect((await enforcementPreview(revisionId)).adminVerified).toBe(false);
    expect(await prisma.oidcIdentity.count({ where: { userId: actor.id } })).toBe(0);
    expect(await prisma.userDevice.count({ where: { userId: actor.id } })).toBe(0);
  });
  it('refuses Required without independent recovery, then activates Optional preserving the original User ID', async () => {
    await expect(
      activateOidcRevision(actor, revisionId, 900, 'SSO_REQUIRED', 'ACTIVATE VERIFIED SSO')
    ).rejects.toThrow('two independent');
    expect(await prisma.oidcConfig.count()).toBe(0);
    const activated = await activateOidcRevision(
      actor,
      revisionId,
      900,
      'SSO_OPTIONAL',
      'ACTIVATE VERIFIED SSO'
    );
    expect(activated.mode).toBe('SSO_OPTIONAL');
    expect(
      (
        await prisma.oidcIdentity.findUniqueOrThrow({
          where: { issuer_subject: { issuer: runtime.issuer, subject: 'existing-admin-subject' } },
        })
      ).userId
    ).toBe(actor.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).role).toBe('ADMIN');
    expect((await enforcementPreview(revisionId)).adminVerified).toBe(false); // proof tied to old production version
  });
  it('enforces the tested active revision with two current independent recovery drills', async () => {
    for (let index = 0; index < 2; index++) {
      const account = await prisma.emergencyAccount.create({
        data: {
          displayName: `Activation readiness fixture ${index}`,
          status: 'ACTIVE',
          verifiedAt: new Date(),
          credentialVersion: 1,
          verifiedCredentialVersion: 1,
          verifiedOrigin: 'https://recovery.example.test',
          independenceConfirmedAt: new Date(),
          credentials: {
            create: {
              credentialId: secret(),
              publicKey: Buffer.from([1]),
              deviceType: 'singleDevice',
              backedUp: false,
              displayName: 'Readiness fixture',
            },
          },
        },
      });
      readyIds.push(account.id);
    }
    const session = await prisma.emergencySession.create({
      data: {
        emergencyAccountId: readyIds[0],
        tokenHash: digest(secret()),
        credentialVersion: 1,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    recoveryActor = {
      kind: 'emergency',
      id: readyIds[0],
      sessionId: session.id,
      sessionTokenHash: session.tokenHash,
      credentialVersion: 1,
      authenticatedAt: Date.now(),
    };
    const flow = await beginOidcRevisionTest(actor, revisionId, actor.id, false);
    await completeOidcRevisionTest(callbackState(flow.url), issueCode(flow.url), flow.browserToken);
    const preview = await enforcementPreview(revisionId);
    expect(preview.blockers).toEqual([]);
    await activateOidcRevision(actor, revisionId, 901, 'SSO_REQUIRED', 'ACTIVATE VERIFIED SSO');
    expect(
      (await prisma.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } }))
        .passwordSessionMinVersion
    ).toBe(902);
    await expect(
      stageOidcRevision(actor, {
        issuer: runtime.issuer,
        clientId: 'test-client',
        clientSecret: 'test-secret',
      })
    ).rejects.toThrow('sign-in method was revoked');
  });
  it('creates a password-free SSO invitation bound to the exact Required configuration', async () => {
    const { getControlActor } = await import('@/lib/auth-control/actor');
    vi.mocked(getControlActor).mockReturnValueOnce(
      Promise.resolve({ ...actor, method: 'oidc', issuedUnderPolicyVersion: 902 })
    );
    const email = `sso-invite-${randomBytes(8).toString('hex')}@example.test`;
    const result = await inviteSsoUser({ name: 'SSO invited user', email, role: 'USER' });
    expect(result.ssoOnly).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull();
    expect(user.status).toBe('INVITED');
    expect(await prisma.userToken.count({ where: { userId: user.id } })).toBe(0);
    const approval = await prisma.oidcLinkingApproval.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(approval.configVersion).toBe(1);
    expect(approval.issuerFingerprint).toBeTruthy();
    expect(approval.expiresAt).not.toBeNull();
    await prisma.user.delete({ where: { id: user.id } });
  });
  it('repairs provider configuration through emergency access without relaxing Required', async () => {
    const staged = await stageOidcRevision(recoveryActor, {
      issuer: runtime.issuer,
      clientId: 'test-client',
      clientSecret: 'test-secret',
      providerLabel: 'Repaired connection',
    });
    const flow = await beginOidcRevisionTest(recoveryActor, staged.revisionId, actor.id, false);
    await completeOidcRevisionTest(callbackState(flow.url), issueCode(flow.url), flow.browserToken);
    await expect(
      activateOidcRevision(
        recoveryActor,
        staged.revisionId,
        902,
        'SSO_OPTIONAL',
        'ACTIVATE VERIFIED SSO'
      )
    ).rejects.toThrow('preserve SSO Required');
    await activateOidcRevision(
      recoveryActor,
      staged.revisionId,
      902,
      'SSO_REQUIRED',
      'ACTIVATE VERIFIED SSO'
    );
    expect(
      (await prisma.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } })).mode
    ).toBe('SSO_REQUIRED');
    expect(
      (await prisma.oidcConfig.findUniqueOrThrow({ where: { id: 'default' } })).providerLabel
    ).toBe('Repaired connection');
  });
  it('counts 10,000 registered sessions without loading their metadata into activation memory', async () => {
    const prefix = `preview-scale-${Date.now()}`;
    const rows = Array.from({ length: 10000 }, (_, index) => ({
      userId: actor.id,
      deviceId: `${prefix}-${index}`,
      token: 'legacy malformed metadata',
      platform: 'session:STANDARD',
      sessionExpiresAt: index < 5000 ? new Date(Date.now() + 3600000) : new Date(0),
    }));
    const before = (await enforcementPreview(revisionId)).passwordSessionCount;
    try {
      for (let start = 0; start < rows.length; start += 1000)
        await prisma.userDevice.createMany({ data: rows.slice(start, start + 1000) });
      const started = performance.now();
      expect((await enforcementPreview(revisionId)).passwordSessionCount - before).toBe(5000);
      console.log('10,000-session preview milliseconds:', Math.round(performance.now() - started));
    } finally {
      await prisma.userDevice.deleteMany({ where: { deviceId: { startsWith: prefix } } });
    }
  });
  it('finds administrators beyond the initial directory page using bounded search', async () => {
    const prefix = `directory-scale-${Date.now()}`;
    try {
      await prisma.user.createMany({
        data: Array.from({ length: 80 }, (_, index) => ({
          id: `${prefix}-${String(index).padStart(3, '0')}`,
          name: 'Search fixture',
          email: `${prefix}-${index}@example.test`,
          role: 'ADMIN' as const,
          status: 'ACTIVE' as const,
        })),
      });
      const first = await searchAuthenticationUsers(recoveryActor, prefix);
      expect(first.users).toHaveLength(25);
      expect(first.nextCursor).toBeTruthy();
      const second = await searchAuthenticationUsers(recoveryActor, prefix, first.nextCursor!);
      expect(second.users).toHaveLength(25);
      expect(second.users[0].id).not.toBe(first.users[0].id);
      const searched = await searchAuthenticationUsers(recoveryActor, `${prefix}-79@`);
      expect(searched.users[0].email).toBe(`${prefix}-79@example.test`);
    } finally {
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    }
  });
  it('restores only one administrator for an hour while preserving Required and existing OIDC sessions', async () => {
    await restorePasswordAccess(
      recoveryActor,
      actor.id,
      'Private scoped restoration phrase October2026!',
      903,
      'RESTORE PASSWORD ACCESS'
    );
    const policy = await prisma.authenticationPolicy.findUniqueOrThrow({
      where: { id: 'default' },
    });
    expect(policy.mode).toBe('SSO_REQUIRED');
    expect(policy.passwordRecoveryUserId).toBe(actor.id);
    expect(policy.oidcSessionMinVersion).toBeLessThan(904);
    expect(evaluateAuthenticationPolicy(policy, 'PASSWORD_LOGIN', { id: actor.id }).allowed).toBe(
      true
    );
    expect(
      evaluateAuthenticationPolicy(policy, 'PASSWORD_LOGIN', { id: 'another-user' }).allowed
    ).toBe(false);
    expect(
      evaluateAuthenticationPolicy(
        policy,
        'SESSION',
        { id: actor.id },
        { method: 'credentials', policyVersion: 904 }
      ).allowed
    ).toBe(true);
    expect(
      evaluateAuthenticationPolicy(
        { ...policy, passwordRecoveryExpiresAt: new Date(0) },
        'SESSION',
        { id: actor.id },
        { method: 'credentials', policyVersion: 904 }
      ).allowed
    ).toBe(false);
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: {
        version: 903,
        passwordRecoveryUserId: null,
        passwordRecoveryExpiresAt: null,
        passwordSessionMinVersion: 903,
      },
    });
    await prisma.user.update({ where: { id: actor.id }, data: { tokenVersion: 0 } });
  });
  it('explicit password recovery preserves the administrator and advances both session cutoffs', async () => {
    await expect(
      restorePasswordAccess(
        recoveryActor,
        actor.id,
        'Private recovery phrase October 2026!',
        903,
        'yes'
      )
    ).rejects.toThrow('Confirm');
    await restorePasswordAccess(
      recoveryActor,
      actor.id,
      'Private recovery phrase October 2026!',
      903,
      'RESTORE INSTANCE PASSWORD ACCESS',
      'INSTANCE'
    );
    const policy = await prisma.authenticationPolicy.findUniqueOrThrow({
      where: { id: 'default' },
    });
    expect(policy.mode).toBe('PASSWORD_ONLY');
    expect(policy.passwordSessionMinVersion).toBe(904);
    expect(policy.oidcSessionMinVersion).toBe(904);
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(admin.id).toBe(actor.id);
    expect(admin.passwordHash).toBeTruthy();
    expect(admin.tokenVersion).toBe(1);
  });

  it('allows deleting an unactivated staged candidate revision and its tests, but rejects deleting active revision', async () => {
    const staged1 = await stageOidcRevision(actor, {
      issuer: runtime.issuer,
      clientId: 'test-delete-1',
      clientSecret: 'test-secret',
    });
    const staged2 = await stageOidcRevision(actor, {
      issuer: runtime.issuer,
      clientId: 'test-delete-2',
      clientSecret: 'test-secret',
    });

    // Delete single staged revision
    const deleteResult = await deleteOidcRevision(actor, staged1.revisionId);
    expect(deleteResult.ok).toBe(true);
    expect(await prisma.oidcRevision.findUnique({ where: { id: staged1.revisionId } })).toBeNull();

    // Staged 2 still exists
    expect(await prisma.oidcRevision.findUnique({ where: { id: staged2.revisionId } })).toBeTruthy();

    // Bulk cleanup deletes remaining unactivated staged revisions
    const cleanupResult = await cleanupStagedRevisions(actor);
    expect(cleanupResult.ok).toBe(true);
    expect(cleanupResult.count).toBeGreaterThanOrEqual(1);
    expect(await prisma.oidcRevision.findUnique({ where: { id: staged2.revisionId } })).toBeNull();
  });
});
