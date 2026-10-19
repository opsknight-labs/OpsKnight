import 'server-only';
import { coerceBooleanClaim, normalizeOidcBoundaryClaims } from '@/lib/oidc/claims';
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
import { getEnterpriseSessionPolicy } from '@/lib/local-auth-policy';
import { hasBroadAdministratorRule, providerDefinitions } from './provider-definitions';
import { providerConfigSchema, type ProviderConfiguration } from './provider-config';
import { lockControlActor, type ControlActor } from './actor';
import { authenticationOrigin } from './origin';
import { digest, secret } from './emergency';
import { emergencyReadiness } from './emergency-management';
import { securityEvent } from './security-events';
import { findRevisionIdentity } from './identity';
import { evaluateOidcProof, oidcProofLabel, OIDC_PROOF_MAX_AGE_MS } from './proof-status';

export const OIDC_TEST_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-opsknight-oidc-test' : 'opsknight-oidc-test';
export const OIDC_TEST_RESULT_COOKIE =
  process.env.NODE_ENV === 'production'
    ? '__Host-opsknight-oidc-test-result'
    : 'opsknight-oidc-test-result';
/** Seven-day administrator proof policy; see proof-status.ts. */
export const PROOF_MAX_AGE_MS = OIDC_PROOF_MAX_AGE_MS;
/** The OAuth/OIDC authorization flow itself stays short-lived and single-use. */
export const OIDC_TEST_FLOW_MAX_AGE_MS = 5 * 60 * 1000;

/** Carries the consumed test flow so the callback can bind a result to the initiating browser. */
export class OidcRevisionTestError extends Error {
  constructor(
    message: string,
    readonly flowId: string | null
  ) {
    super(message);
  }
}

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

export function storedProviderConfiguration(
  active: NonNullable<Awaited<ReturnType<typeof prisma.oidcConfig.findUnique>>>
) {
  return {
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
  };
}
export function activeProviderConfiguration(
  active: Parameters<typeof storedProviderConfiguration>[0]
): ProviderConfiguration {
  return providerConfigSchema.parse(storedProviderConfiguration(active));
}
function matchesActive(
  active: Parameters<typeof activeProviderConfiguration>[0] | null,
  config: ProviderConfiguration
) {
  if (!active) return false;
  const parsed = providerConfigSchema.safeParse(storedProviderConfiguration(active));
  return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(config);
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
  acknowledgeBroadAdminRules = false,
  sourceRevisionId?: string,
  expectedConfigVersion?: number
) {
  const parsed = providerConfigSchema.parse(input);
  const config = {
    ...parsed,
    organizationId: providerDefinitions[parsed.providerType].organization
      ? parsed.organizationId
      : null,
  };
  if (
    config.sessionIdleTimeoutSeconds != null &&
    config.sessionIdleTimeoutSeconds > getEnterpriseSessionPolicy(config).maximumAgeSeconds
  )
    throw new Error('Idle timeout cannot exceed the effective maximum session lifetime.');
  if (Buffer.byteLength(config.clientSecret, 'utf8') > 4096)
    throw new Error('Client secret must be at most 4096 UTF-8 bytes.');
  if (hasBroadAdministratorRule(config.roleMapping) && !acknowledgeBroadAdminRules)
    throw new Error(
      'A broadly matching ADMIN rule needs explicit acknowledgment. Prefer a dedicated administrator group.'
    );
  if (!config.enabled)
    throw new Error('Staged providers must be enabled. Use Password Only policy to disable SSO.');
  const current = await prisma.oidcConfig.findUnique({ where: { id: 'default' } });
  if (
    expectedConfigVersion !== undefined &&
    expectedConfigVersion !== (current?.configVersion ?? 0)
  )
    throw new Error(
      'The active provider changed in another session. Reload and review the latest configuration before staging.'
    );
  // A source revision only lends its encrypted secret. If another administrator deleted it,
  // fall back to the active provider rather than failing the whole stage operation.
  const sourceRevision = sourceRevisionId
    ? await prisma.oidcRevision.findUnique({ where: { id: sourceRevisionId } })
    : null;
  const source = sourceRevision ? providerConfigSchema.parse(sourceRevision.configuration) : null;
  let encryptedSecret: string;
  if (config.clientSecret) encryptedSecret = await encrypt(config.clientSecret);
  else if (source && source.issuer === config.issuer && source.clientId === config.clientId)
    encryptedSecret = source.clientSecret;
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
  const revision = await prisma.oidcRevision.findUnique({ where: { id: revisionId } });
  if (!revision)
    throw new Error('This saved configuration was deleted. Select or stage another configuration.');
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
    // Deletion holds the same control lock, so this recheck cannot race a concurrent delete.
    if (!(await tx.oidcRevision.findUnique({ where: { id: revisionId }, select: { id: true } })))
      throw new Error(
        'This saved configuration was deleted. Select or stage another configuration.'
      );
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
        expiresAt: new Date(Date.now() + OIDC_TEST_FLOW_MAX_AGE_MS),
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
export async function completeOidcRevisionTest(
  state: string,
  code: string,
  browserToken: string
): Promise<{ flowId: string; revisionId: string }> {
  const flow = await prisma.oidcTestFlow.findUnique({ where: { stateHash: digest(state) } });
  if (
    !flow ||
    flow.consumedAt ||
    flow.expiresAt.getTime() <= Date.now() ||
    flow.browserHash !== digest(browserToken)
  )
    throw new OidcRevisionTestError(
      'SSO test expired, replayed, or from another browser. Begin a new test.',
      // Only a flow proven to belong to this browser may be referenced by the result page.
      flow && flow.browserHash === digest(browserToken) ? flow.id : null
    );
  // Claim before outbound token exchange: concurrent callbacks cannot reuse a code/flow.
  const claimed = await prisma.oidcTestFlow.updateMany({
    where: { id: flow.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) throw new OidcRevisionTestError('SSO test already used.', flow.id);
  const revisionExists = await prisma.oidcRevision.findUnique({
    where: { id: flow.revisionId },
    select: { id: true },
  });
  if (!revisionExists) {
    await prisma.$transaction(tx =>
      securityEvent(
        tx,
        'auth.oidc.test.failed',
        flow.adminUserId,
        { revisionId: flow.revisionId, reason: 'REVISION_DELETED' },
        'failed'
      )
    );
    throw new OidcRevisionTestError(
      'The configuration under test was deleted before sign-in completed. Production configuration is unchanged.',
      flow.id
    );
  }
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
      !provider.validateOrganizationBoundary(
        normalizeOidcBoundaryClaims(claims),
        config.allowedDomains,
        config.organizationId
      ).ok
    )
      throw new Error('Provider organization boundary rejected the login.');
    if (!claims.sub) throw new Error('A subject claim is required for administrator verification.');
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    const emailVerified = coerceBooleanClaim(claims.email_verified);
    if (emailVerified === false) throw new Error('Provider explicitly reports unverified email.');
    const emailOwnershipVerified =
      Boolean(email) && (emailVerified === true || provider.allowsMissingEmailVerified());
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
      if (
        !identity &&
        (!flow.linkApproved || !emailOwnershipVerified || email !== admin.email.toLowerCase())
      )
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
          // An existing binding proves identity, never permission to recreate a removed link.
          linkApproved: !identity && flow.linkApproved,
        },
      });
      await securityEvent(tx, 'auth.oidc.test.success', admin.id, {
        revisionId: revision.id,
        preservedUserId: admin.id,
        authorizedBy: flow.authorizedBy,
        effectiveRole,
      });
    });
    return { flowId: flow.id, revisionId: flow.revisionId };
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
    throw new OidcRevisionTestError(
      'SSO administrator test failed. Check provider diagnostics, claims, linking approval and role mapping. Production configuration is unchanged.',
      flow.id
    );
  }
}

export type OidcTestResult =
  | { outcome: 'verified'; revisionId: string; verifiedAt: string; expiresAt: string }
  | { outcome: 'failed'; revisionId: string | null; reason: 'deleted' | 'failed' }
  | { outcome: 'unavailable' };

/**
 * Resolves the outcome shown after a test callback from recorded evidence only. The browser
 * presents an opaque reference (flow id + the flow's original browser-binding token); a URL
 * alone can never produce a "verified" page.
 */
export async function readOidcTestResult(reference: string | undefined): Promise<OidcTestResult> {
  const match = /^([a-z0-9]{20,40})\.([A-Za-z0-9_-]{43})$/.exec(reference ?? '');
  if (!match) return { outcome: 'unavailable' };
  const [, flowId, browserToken] = match;
  const flow = await prisma.oidcTestFlow.findUnique({ where: { id: flowId } });
  if (
    !flow ||
    !flow.consumedAt ||
    flow.browserHash !== digest(browserToken) ||
    Date.now() - flow.consumedAt.getTime() > 15 * 60 * 1000
  )
    return { outcome: 'unavailable' };
  const revision = await prisma.oidcRevision.findUnique({
    where: { id: flow.revisionId },
    select: { id: true },
  });
  if (!revision) return { outcome: 'failed', revisionId: null, reason: 'deleted' };
  const proof = await prisma.oidcRevisionTest.findFirst({
    where: {
      revisionId: flow.revisionId,
      adminUserId: flow.adminUserId,
      verifiedAt: { gte: flow.createdAt },
    },
    orderBy: { verifiedAt: 'desc' },
  });
  if (!proof) return { outcome: 'failed', revisionId: flow.revisionId, reason: 'failed' };
  return {
    outcome: 'verified',
    revisionId: flow.revisionId,
    verifiedAt: proof.verifiedAt.toISOString(),
    expiresAt: new Date(proof.verifiedAt.getTime() + PROOF_MAX_AGE_MS).toISOString(),
  };
}

async function preview(tx: Prisma.TransactionClient, revisionId: string) {
  const origin = await authenticationOrigin(tx);
  const revision = await tx.oidcRevision.findUniqueOrThrow({ where: { id: revisionId } });
  const config = providerConfigSchema.parse(revision.configuration);
  // The newest test is authoritative: a later failed-context test is never masked by an older one.
  const latestProof = await tx.oidcRevisionTest.findFirst({
    where: { revisionId },
    orderBy: { verifiedAt: 'desc' },
  });
  const user = latestProof
    ? await tx.user.findUnique({ where: { id: latestProof.adminUserId } })
    : null;
  const ready = await emergencyReadiness(tx);
  const active = await tx.oidcConfig.findUnique({ where: { id: 'default' } });
  const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
  const isActive = policy.activeRevisionId === revisionId && matchesActive(active, config);
  const verification = evaluateOidcProof(latestProof, {
    now: new Date(),
    origin,
    activeConfigVersion: active?.configVersion ?? 0,
    administrator: user,
  });
  const adminVerified = verification.state === 'valid';
  const proof = adminVerified ? latestProof : null;
  const replicas = await tx.authenticationReplicaObservation.count({
    where: { differs: true, lastSeenAt: { gt: new Date(Date.now() - 600000) } },
  });
  const passwordSessionCount = await tx.userDevice.count({
    where: {
      platform: { in: ['session:STANDARD', 'session:TRUSTED_PWA'] },
      OR: [{ sessionExpiresAt: null }, { sessionExpiresAt: { gt: new Date() } }],
    },
  });
  const usersRequiringLinking = await tx.user.count({
    where: {
      status: { in: ['ACTIVE', 'INVITED'] },
      oidcIdentities: { none: { issuer: config.issuer } },
    },
  });
  const blockers = [
    !adminVerified ? oidcProofLabel(verification.state).detail : '',
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
    verification,
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
      verification: value.verification,
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
      if (!(await tx.oidcRevision.findUnique({ where: { id: revisionId }, select: { id: true } })))
        throw new Error(
          'This saved configuration was deleted. Select or stage another configuration.'
        );
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
            configuration: storedProviderConfiguration(data.active) as Prisma.InputJsonObject,
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
          passwordRecoveryUserId: null,
          passwordRecoveryExpiresAt: null,
          recoveryDegradedAt:
            data.verifiedEmergencyAccounts >= 2 ? null : data.policy.recoveryDegradedAt,
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
      return {
        mode: policy.mode,
        version: policy.version,
        providerConfigVersion: policy.oidcConfigVersion,
      };
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

/** Cancels in-flight administrator tests so their callbacks fail with a precise reason. */
async function cancelPendingTestFlows(tx: Prisma.TransactionClient, revisionIds: string[]) {
  if (!revisionIds.length) return 0;
  const cancelled = await tx.oidcTestFlow.updateMany({
    where: { revisionId: { in: revisionIds }, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });
  return cancelled.count;
}

function deletionBlocker(
  revision: { id: string; activatedAt: Date | null } | null,
  activeRevisionId: string | null
) {
  if (!revision) return 'This saved configuration was already deleted in another session.';
  if (revision.id === activeRevisionId) return 'The active configuration cannot be deleted.';
  if (revision.activatedAt)
    return 'Previously activated configurations are kept as rollback history.';
  return null;
}

export async function deleteOidcRevision(actor: ControlActor, revisionId: string) {
  // lockControlActor takes the same advisory lock and policy row lock as activation, so a
  // revision cannot be activated and deleted concurrently.
  return prisma.$transaction(async tx => {
    await lockControlActor(tx, actor, false);
    const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    const revision = await tx.oidcRevision.findUnique({
      where: { id: revisionId },
      select: { id: true, activatedAt: true },
    });
    const blocker = deletionBlocker(revision, policy.activeRevisionId);
    if (blocker) throw new Error(blocker);
    const cancelledTests = await cancelPendingTestFlows(tx, [revisionId]);
    const proofs = await tx.oidcRevisionTest.deleteMany({ where: { revisionId } });
    await tx.oidcRevision.delete({ where: { id: revisionId } });
    await securityEvent(tx, 'auth.oidc.revision.deleted', actor.id, {
      revisionId,
      deletedProofs: proofs.count,
      cancelledTests,
    });
    return { ok: true, deletedRevisionId: revisionId };
  });
}

/**
 * Deletes unused drafts. The client sends the ids it showed in its confirmation; each is
 * rechecked inside the locked transaction, so a stale confirmation can never delete a draft
 * that appeared, was activated or became active after the dialog opened.
 */
export async function cleanupStagedRevisions(actor: ControlActor, expectedRevisionIds: string[]) {
  return prisma.$transaction(async tx => {
    await lockControlActor(tx, actor, false);
    if (!expectedRevisionIds.length) return { ok: true, count: 0, skipped: 0, deletedIds: [] };
    const policy = await tx.authenticationPolicy.findUniqueOrThrow({ where: { id: 'default' } });
    const candidates = await tx.oidcRevision.findMany({
      where: { id: { in: expectedRevisionIds } },
      select: { id: true, activatedAt: true },
    });
    const eligible = candidates
      .filter(candidate => !deletionBlocker(candidate, policy.activeRevisionId))
      .map(candidate => candidate.id);
    if (!eligible.length)
      return { ok: true, count: 0, skipped: expectedRevisionIds.length, deletedIds: [] };
    const cancelledTests = await cancelPendingTestFlows(tx, eligible);
    await tx.oidcRevisionTest.deleteMany({ where: { revisionId: { in: eligible } } });
    const deleted = await tx.oidcRevision.deleteMany({
      where: { id: { in: eligible }, activatedAt: null },
    });
    await securityEvent(tx, 'auth.oidc.revisions.cleaned', actor.id, {
      count: deleted.count,
      revisionIds: eligible,
      cancelledTests,
    });
    return {
      ok: true,
      count: deleted.count,
      skipped: expectedRevisionIds.length - deleted.count,
      deletedIds: eligible,
    };
  });
}
