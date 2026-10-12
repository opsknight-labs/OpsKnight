import 'server-only';
import { Issuer, custom, generators } from 'openid-client';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/encryption';
import {
  validateOidcConnection,
  type OidcRuntimeMetadata,
  resetOidcRuntimeMetadataCache,
} from '@/lib/oidc-validation';
import { safeOutboundLookup } from '@/lib/network-security';
import { getOidcProviderPolicy } from '@/lib/oidc/provider-policy';
import { evaluateOidcRoleClaims } from '@/lib/oidc/role-mapping';
import { validateOidcCustomScopes } from '@/lib/oidc/scopes';
import { resetAuthOptionsCache } from '@/lib/auth';
import { normalizeOidcProviderType } from '@/lib/oidc-provider';
import { resetOidcConfigCache } from '@/lib/oidc-config';
import { providerConfigSchema, type ProviderConfiguration } from './provider-config';
import { lockControlActor, type ControlActor } from './actor';
import { authenticationOrigin } from './origin';
import { digest, secret } from './emergency';
import { emergencyReadiness } from './emergency-management';
import { securityEvent } from './security-events';
import { findRevisionIdentity } from './identity';

export const OIDC_TEST_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-opsknight-oidc-test' : 'opsknight-oidc-test';
const PROOF_MAX_AGE_MS = 15 * 60000;

export function oidcTestClient(config: ProviderConfiguration, metadata: OidcRuntimeMetadata) {
  const issuer = new Issuer({
    issuer: metadata.issuer,
    authorization_endpoint: metadata.authorizationEndpoint,
    token_endpoint: metadata.tokenEndpoint,
    jwks_uri: metadata.jwksUri,
  });
  issuer[custom.http_options] = () => ({ lookup: safeOutboundLookup, timeout: 5000 });
  const client = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    id_token_signed_response_alg: 'RS256',
    token_endpoint_auth_method: config.tokenEndpointAuthMethod,
  });
  client[custom.http_options] = () => ({ lookup: safeOutboundLookup, timeout: 5000 });
  return client;
}

export function activeProviderConfiguration(
  active: NonNullable<Awaited<ReturnType<typeof prisma.oidcConfig.findUnique>>>
): ProviderConfiguration {
  return providerConfigSchema.parse({
    issuer: active.issuer,
    clientId: active.clientId,
    clientSecret: active.clientSecret,
    enabled: active.enabled,
    autoProvision: active.autoProvision,
    allowedDomains: active.allowedDomains,
    roleMapping: Array.isArray(active.roleMapping) ? active.roleMapping : [],
    customScopes: active.customScopes,
    providerType: normalizeOidcProviderType(active.providerType, active.issuer),
    providerLabel: active.providerLabel,
    organizationId: active.organizationId,
    tokenEndpointAuthMethod: active.tokenEndpointAuthMethod ?? 'client_secret_basic',
    profileMapping:
      active.profileMapping && typeof active.profileMapping === 'object'
        ? active.profileMapping
        : {},
    sessionMaxAgeSeconds: active.sessionMaxAgeSeconds,
    sessionIdleTimeoutSeconds: active.sessionIdleTimeoutSeconds,
  });
}
function matchesActive(
  active: Parameters<typeof activeProviderConfiguration>[0] | null,
  config: ProviderConfiguration
) {
  return Boolean(
    active && JSON.stringify(activeProviderConfiguration(active)) === JSON.stringify(config)
  );
}

async function validate(config: ProviderConfiguration) {
  const issuer = new URL(config.issuer);
  const policy = getOidcProviderPolicy(config.issuer, config.providerType);
  if (
    issuer.protocol !== 'https:' ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    !policy.validateIssuer(issuer)
  )
    throw new Error(
      'Use an exact supported HTTPS issuer; Entra requires a tenant-specific authority.'
    );
  const scopes = validateOidcCustomScopes(config.customScopes, config.providerType);
  if (!scopes.ok) throw new Error(scopes.error);
  config.customScopes = scopes.scopes;
  const result = await validateOidcConnection(config.issuer, {
    tokenEndpointAuthMethod: config.tokenEndpointAuthMethod,
  });
  if (!result.isValid || !result.metadata)
    throw new Error(result.error ?? 'Provider discovery validation failed.');
  return result.metadata;
}

export async function stageOidcRevision(
  actor: ControlActor,
  input: unknown,
  acknowledgeBroadAdminRules = false
) {
  const config = providerConfigSchema.parse(input);
  if (Buffer.byteLength(config.clientSecret, 'utf8') > 4096)
    throw new Error('Client secret must be at most 4096 UTF-8 bytes.');
  if (
    config.roleMapping.some(
      rule =>
        rule.role === 'ADMIN' &&
        (!/^(groups?|roles?)$/i.test(rule.claim) ||
          /^(all|everyone|employees|users|members|authenticated|\*)$/i.test(rule.value))
    ) &&
    !acknowledgeBroadAdminRules
  )
    throw new Error(
      'A broadly matching ADMIN rule needs explicit acknowledgment. Prefer a dedicated administrator group.'
    );
  if (!config.enabled)
    throw new Error('Staged providers must be enabled. Use Password Only policy to disable SSO.');
  const current = await prisma.oidcConfig.findUnique({ where: { id: 'default' } });
  let encryptedSecret: string;
  if (config.clientSecret) encryptedSecret = await encrypt(config.clientSecret);
  else if (
    current &&
    current.issuer.replace(/\/$/, '') === config.issuer.replace(/\/$/, '') &&
    current.clientId === config.clientId
  )
    encryptedSecret = current.clientSecret;
  else throw new Error('Enter the new provider client secret.');
  await validate(config);
  return prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    const latest = await tx.oidcConfig.findUnique({ where: { id: 'default' } });
    if ((latest?.configVersion ?? 0) !== (current?.configVersion ?? 0))
      throw new Error('Active provider changed. Reload before staging.');
    const revision = await tx.oidcRevision.create({
      data: {
        configuration: { ...config, clientSecret: encryptedSecret } as Prisma.InputJsonObject,
        baseConfigVersion: current?.configVersion ?? 0,
        createdBy: `${actor.kind}:${actor.id}`,
        discoveryVerifiedAt: new Date(),
      },
    });
    await securityEvent(tx, 'auth.oidc.revision.staged', actor.id, {
      revisionId: revision.id,
      issuer: config.issuer,
      clientId: config.clientId,
    });
    return {
      revisionId: revision.id,
      callbackUrl: `${await authenticationOrigin()}/api/auth/oidc/test/callback`,
    };
  });
}

export async function beginOidcRevisionTest(
  actor: ControlActor,
  revisionId: string,
  adminUserId: string,
  linkApproved: boolean
) {
  if (actor.kind === 'admin' && actor.id !== adminUserId)
    throw new Error(
      'Test your own administrator identity. Emergency recovery may test a selected existing administrator.'
    );
  const revision = await prisma.oidcRevision.findUniqueOrThrow({ where: { id: revisionId } });
  const config = providerConfigSchema.parse(revision.configuration);
  config.clientSecret = await decrypt(config.clientSecret);
  const metadata = await validate(config);
  const origin = await authenticationOrigin();
  const state = secret();
  const browserToken = secret();
  const nonce = secret();
  const verifier = generators.codeVerifier();
  await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    const admin = await tx.user.findUnique({ where: { id: adminUserId } });
    if (!admin || admin.role !== 'ADMIN' || admin.status !== 'ACTIVE')
      throw new Error('Select an active existing administrator.');
    const active = await tx.oidcConfig.findUnique({ where: { id: 'default' } });
    const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    const isActive =
      policy.activeRevisionId === revisionId &&
      matchesActive(active, providerConfigSchema.parse(revision.configuration));
    if (!isActive && (active?.configVersion ?? 0) !== revision.baseConfigVersion)
      throw new Error('Revision is stale; stage a new revision.');
    await tx.oidcTestFlow.create({
      data: {
        testedConfigVersion: active?.configVersion ?? 0,
        stateHash: digest(state),
        browserHash: digest(browserToken),
        revisionId,
        adminUserId,
        adminTokenVersion: admin.tokenVersion,
        authorizedBy: `${actor.kind}:${actor.id}`,
        linkApproved,
        secrets: await encrypt(JSON.stringify({ nonce, verifier, actor, origin })),
        expiresAt: new Date(Date.now() + 300000),
      },
    });
  });
  const client = oidcTestClient(config, metadata);
  const url = client.authorizationUrl({
    redirect_uri: `${origin}/api/auth/oidc/test/callback`,
    response_type: 'code',
    scope: `openid email profile ${config.customScopes ?? ''}`.trim(),
    state,
    nonce,
    prompt: 'login',
    code_challenge: generators.codeChallenge(verifier),
    code_challenge_method: 'S256',
    ...(config.organizationId ? { organization: config.organizationId } : {}),
  });
  return { url, browserToken };
}

/** Real code exchange/JWKS/nonce/PKCE verification. Staged tests never issue production sessions. */
export async function completeOidcRevisionTest(state: string, code: string, browserToken: string) {
  const flow = await prisma.oidcTestFlow.findUnique({ where: { stateHash: digest(state) } });
  if (
    !flow ||
    flow.consumedAt ||
    flow.expiresAt.getTime() <= Date.now() ||
    flow.browserHash !== digest(browserToken)
  )
    throw new Error('SSO test expired, replayed, or from another browser. Begin a new test.');
  // Claim before outbound token exchange: concurrent callbacks cannot reuse a code/flow.
  const claimed = await prisma.oidcTestFlow.updateMany({
    where: { id: flow.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) throw new Error('SSO test already used.');
  try {
    const secrets = JSON.parse(await decrypt(flow.secrets)) as {
      nonce: string;
      verifier: string;
      actor: ControlActor;
      origin: string;
    };
    const origin = await authenticationOrigin();
    if (origin !== secrets.origin) throw new Error('Application origin changed. Begin a new test.');
    const revision = await prisma.oidcRevision.findUniqueOrThrow({
      where: { id: flow.revisionId },
    });
    const config = providerConfigSchema.parse(revision.configuration);
    config.clientSecret = await decrypt(config.clientSecret);
    const metadata = await validate(config);
    const client = oidcTestClient(config, metadata);
    const tokens = await client.callback(
      `${origin}/api/auth/oidc/test/callback`,
      { code, state },
      { state, nonce: secrets.nonce, code_verifier: secrets.verifier }
    );
    const claims = tokens.claims();
    const provider = getOidcProviderPolicy(config.issuer, config.providerType);
    if (
      claims.email_verified === false ||
      (!provider.allowsMissingEmailVerified() && claims.email_verified !== true)
    )
      throw new Error('Verified email is required.');
    if (
      !provider.validateOrganizationBoundary(claims, config.allowedDomains, config.organizationId)
        .ok
    )
      throw new Error('Provider organization boundary rejected the login.');
    if (!claims.sub || typeof claims.email !== 'string')
      throw new Error('Subject and email claims are required for administrator verification.');
    const email = claims.email.trim().toLowerCase();
    const role = evaluateOidcRoleClaims(claims, config.roleMapping);
    if (!role.ok || role.groupsOverage)
      throw new Error('Resolve missing/group-overage role claims before activation.');
    await prisma.$transaction(async tx => {
      await lockControlActor(tx, secrets.actor, false);
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${flow.adminUserId} FOR UPDATE`;
      const active = await tx.oidcConfig.findUnique({ where: { id: 'default' } });
      if ((active?.configVersion ?? 0) !== flow.testedConfigVersion)
        throw new Error('Production configuration changed during the test.');
      const admin = await tx.user.findUniqueOrThrow({ where: { id: flow.adminUserId } });
      if (
        admin.role !== 'ADMIN' ||
        admin.status !== 'ACTIVE' ||
        admin.tokenVersion !== flow.adminTokenVersion
      )
        throw new Error('Administrator security state changed during the test.');
      const identity = await findRevisionIdentity(tx, config.issuer, claims.sub);
      if (identity && identity.userId !== admin.id)
        throw new Error('This external identity belongs to another OpsKnight user.');
      if (!identity && (!flow.linkApproved || email !== admin.email.toLowerCase()))
        throw new Error(
          'Explicit same-account linking approval and matching verified email are required.'
        );
      const effectiveRole = role.matched || admin.roleSource === 'OIDC' ? role.role : admin.role;
      if (effectiveRole !== 'ADMIN')
        throw new Error('These role mappings would remove administrator access.');
      await tx.oidcRevisionTest.create({
        data: {
          revisionId: revision.id,
          adminUserId: admin.id,
          adminTokenVersion: admin.tokenVersion,
          testedConfigVersion: flow.testedConfigVersion,
          verifiedOrigin: origin,
          issuer: config.issuer,
          subject: claims.sub,
          email,
          effectiveRole,
          linkApproved: flow.linkApproved,
        },
      });
      await securityEvent(tx, 'auth.oidc.test.success', admin.id, {
        revisionId: revision.id,
        preservedUserId: admin.id,
        authorizedBy: flow.authorizedBy,
        effectiveRole,
      });
    });
    return flow.revisionId;
  } catch {
    await prisma.$transaction(tx =>
      securityEvent(
        tx,
        'auth.oidc.test.failed',
        flow.adminUserId,
        { revisionId: flow.revisionId, reason: 'PROVIDER_OR_IDENTITY_VERIFICATION_FAILED' },
        'failed'
      )
    );
    throw new Error(
      'SSO administrator test failed. Check provider diagnostics, claims, linking approval and role mapping. Production configuration is unchanged.'
    );
  }
}

async function preview(tx: Prisma.TransactionClient, revisionId: string) {
  const origin = await authenticationOrigin();
  const revision = await tx.oidcRevision.findUniqueOrThrow({ where: { id: revisionId } });
  const config = providerConfigSchema.parse(revision.configuration);
  const proof = await tx.oidcRevisionTest.findFirst({
    where: {
      revisionId,
      verifiedOrigin: origin,
      verifiedAt: { gte: new Date(Date.now() - PROOF_MAX_AGE_MS) },
      effectiveRole: 'ADMIN',
    },
    orderBy: { verifiedAt: 'desc' },
  });
  const user = proof ? await tx.user.findUnique({ where: { id: proof.adminUserId } }) : null;
  let adminVerified = Boolean(
    proof &&
    user &&
    user.status === 'ACTIVE' &&
    user.role === 'ADMIN' &&
    user.tokenVersion === proof.adminTokenVersion
  );
  const ready = await emergencyReadiness(tx);
  const active = await tx.oidcConfig.findUnique({ where: { id: 'default' } });
  const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
  const isActive = policy.activeRevisionId === revisionId && matchesActive(active, config);
  adminVerified = adminVerified && proof?.testedConfigVersion === (active?.configVersion ?? 0);
  const replicas = await tx.authenticationReplicaObservation.count({
    where: { differs: true, lastSeenAt: { gt: new Date(Date.now() - 600000) } },
  });
  const passwordSessions = await tx.userDevice.findMany({
    where: { platform: { in: ['session:STANDARD', 'session:TRUSTED_PWA'] } },
    select: { token: true },
  });
  const passwordSessionCount = passwordSessions.filter(session => {
    try {
      const metadata = JSON.parse(session.token) as { expiresAt?: string };
      return !metadata.expiresAt || new Date(metadata.expiresAt).getTime() > Date.now();
    } catch {
      return true;
    }
  }).length;
  const usersRequiringLinking = await tx.user.count({
    where: {
      status: { in: ['ACTIVE', 'INVITED'] },
      oidcIdentities: { none: { issuer: config.issuer } },
    },
  });
  const blockers = [
    !adminVerified ? 'Complete a real SSO administrator login test within 15 minutes.' : '',
    ready.length < 2 ? 'Enroll and sign in with two independent emergency identities.' : '',
    !isActive && (active?.configVersion ?? 0) !== revision.baseConfigVersion
      ? 'Active provider changed; create and test a new revision.'
      : '',
    replicas ? 'Reconcile conflicting legacy settings on active replicas.' : '',
  ].filter(Boolean);
  return {
    policyVersion: policy.version,
    revisionId,
    passwordSessionCount,
    usersRequiringLinking,
    verifiedEmergencyAccounts: ready.length,
    adminVerified,
    blockers,
    proof,
    config,
    revision,
    active,
    policy,
    isActive,
  };
}

export async function enforcementPreview(revisionId: string) {
  return prisma.$transaction(async tx => {
    const value = await preview(tx, revisionId);
    return {
      policyVersion: value.policyVersion,
      revisionId,
      passwordSessionCount: value.passwordSessionCount,
      usersRequiringLinking: value.usersRequiringLinking,
      verifiedEmergencyAccounts: value.verifiedEmergencyAccounts,
      adminVerified: value.adminVerified,
      blockers: value.blockers,
    };
  });
}

export async function activateOidcRevision(
  actor: ControlActor,
  revisionId: string,
  expectedVersion: number,
  mode: 'SSO_OPTIONAL' | 'SSO_REQUIRED',
  confirmation: string
) {
  if (confirmation !== 'ACTIVATE VERIFIED SSO')
    throw new Error('Explicit activation confirmation is required.');
  const result = await prisma.$transaction(
    async tx => {
      await lockControlActor(tx, actor);
      const data = await preview(tx, revisionId);
      if (data.policy.version !== expectedVersion)
        throw new Error('Authentication policy changed. Reload the impact preview.');
      if (!data.adminVerified || !data.proof)
        throw new Error('A verified working SSO administrator is required.');
      if (!data.isActive && (data.active?.configVersion ?? 0) !== data.revision.baseConfigVersion)
        throw new Error('Provider revision is stale. Stage and test again.');
      if (data.policy.mode === 'SSO_REQUIRED' && mode !== 'SSO_REQUIRED')
        throw new Error(
          'Recovery repair must preserve SSO Required. Use the separate policy transition to deliberately relax it.'
        );
      if (mode === 'SSO_REQUIRED' && data.blockers.length) throw new Error(data.blockers.join(' '));
      const proof = data.proof;
      if (actor.kind === 'admin' && proof.adminUserId !== actor.id)
        throw new Error(
          'Complete the administrator test with your own identity before activation.'
        );
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${proof.adminUserId} FOR UPDATE`;
      const admin = await tx.user.findUniqueOrThrow({ where: { id: proof.adminUserId } });
      if (
        admin.role !== 'ADMIN' ||
        admin.status !== 'ACTIVE' ||
        admin.tokenVersion !== proof.adminTokenVersion
      )
        throw new Error('Verified administrator permissions changed. Test again.');
      const identity = await findRevisionIdentity(tx, proof.issuer, proof.subject);
      if (identity && identity.userId !== admin.id)
        throw new Error('Verified identity was linked elsewhere.');
      if (!identity) {
        if (!proof.linkApproved || proof.email !== admin.email.toLowerCase())
          throw new Error('Administrator linking readiness changed.');
        await tx.oidcIdentity.create({
          data: {
            userId: admin.id,
            issuer: proof.issuer,
            subject: proof.subject,
            email: proof.email,
          },
        });
      }
      // Capture existing production configuration for explicit, testable rollback.
      let previousRevisionId = data.policy.activeRevisionId;
      if (data.active && !previousRevisionId) {
        const previous = await tx.oidcRevision.create({
          data: {
            configuration: activeProviderConfiguration(data.active) as Prisma.InputJsonObject,
            baseConfigVersion: data.active.configVersion,
            createdBy: 'MIGRATION',
            activatedAt: new Date(),
          },
        });
        previousRevisionId = previous.id;
      }
      const version = data.isActive
        ? data.active!.configVersion
        : (data.active?.configVersion ?? 0) + 1;
      const configuration = { ...data.config, configVersion: version, updatedBy: admin.id };
      if (!data.isActive)
        await tx.oidcConfig.upsert({
          where: { id: 'default' },
          create: { id: 'default', ...configuration },
          update: configuration,
        });
      if (!data.isActive)
        await tx.oidcRevision.update({
          where: { id: revisionId },
          data: { activatedAt: new Date(), previousRevisionId },
        });
      await tx.oidcLinkingApproval.updateMany({
        where: { consumedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const policy = await tx.authenticationPolicy.update({
        where: { id: 'default' },
        data: {
          mode,
          version: { increment: 1 },
          activeRevisionId: revisionId,
          oidcConfigVersion: version,
          lastVerifiedAt: proof.verifiedAt,
          enforcedAt: mode === 'SSO_REQUIRED' ? new Date() : null,
          ...(mode === 'SSO_REQUIRED'
            ? { passwordSessionMinVersion: data.policy.version + 1 }
            : {}),
          ...(!data.isActive ? { oidcSessionMinVersion: data.policy.version + 1 } : {}),
          updatedBy: actor.kind === 'admin' ? actor.id : null,
        },
      });
      await securityEvent(tx, 'auth.policy.changed', actor.id, {
        revisionId,
        previousRevisionId,
        oldMode: data.policy.mode,
        mode,
        version: policy.version,
        revokedPasswordSessions: mode === 'SSO_REQUIRED' ? data.passwordSessionCount : 0,
        recoveryOnly: actor.kind !== 'admin',
        administratorUserIdPreserved: admin.id,
      });
      return { mode: policy.mode, version: policy.version };
    },
    { timeout: 15000 }
  );
  resetOidcConfigCache();
  resetOidcRuntimeMetadataCache();
  resetAuthOptionsCache();
  return result;
}

export async function stageRollback(actor: ControlActor, revisionId: string) {
  const revision = await prisma.oidcRevision.findUniqueOrThrow({ where: { id: revisionId } });
  const config = providerConfigSchema.parse(revision.configuration);
  config.clientSecret = await decrypt(config.clientSecret);
  config.enabled = true;
  return stageOidcRevision(actor, config); // A rollback gets a new revision and real login test.
}
