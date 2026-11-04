import 'server-only';
import { coerceBooleanClaim, normalizeOidcBoundaryClaims } from '@/lib/oidc/claims';
import { Issuer, custom, generators, errors as openidErrors } from 'openid-client';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { oidcTrustFingerprint } from '@/lib/oidc/trust-fingerprint';
import { encrypt, decrypt } from '@/lib/encryption';
import {
  validateOidcConnection,
  type OidcRuntimeMetadata,
  resetOidcRuntimeMetadataCache,
} from '@/lib/oidc-validation';
import { safeOutboundLookup } from '@/lib/network-security';
import { getOidcProviderPolicy } from '@/lib/oidc/provider-policy';
import {
  evaluateOidcRoleClaims,
  oidcRuleMatches,
  readOidcClaim,
  resolveSignInRole,
} from '@/lib/oidc/role-mapping';
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
import { isAdminTestFailureCode, type AdminTestFailureCode } from './messages';

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

/** A test failure the result page can explain. Diagnostics never contain tokens or secrets. */
export class OidcTestFailure extends Error {
  constructor(
    readonly code: AdminTestFailureCode,
    readonly diagnostics: OidcTestDiagnostics = {}
  ) {
    super(code);
  }
}

export type OidcTestDiagnostics = {
  /** Every claim name the provider sent, so a missing claim is obvious. */
  claimNames?: string[];
  /** Values of the claims OpsKnight uses for access decisions, capped. */
  claims?: Record<string, string | boolean | string[] | null>;
  receivedEmail?: string;
  expectedEmail?: string;
  role?: { result: string; matchedRule?: string | null; effectiveRole?: string };
  providerMessage?: string;
};

const DIAGNOSTIC_CLAIMS = ['email', 'email_verified', 'hd', 'org_id', 'tid', 'groups', 'roles'];
const MAX_DIAGNOSTIC_VALUES = 50;

function diagnosticValue(value: unknown): string | boolean | string[] | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' || typeof value === 'number') return String(value).slice(0, 200);
  if (Array.isArray(value))
    return value
      .filter(item => typeof item === 'string' || typeof item === 'number')
      .slice(0, MAX_DIAGNOSTIC_VALUES)
      .map(item => String(item).slice(0, 200));
  if (value && typeof value === 'object') return '[object]';
  return null;
}

/** Masks an email for display: the domain is useful for diagnosis, the mailbox is not. */
export function maskEmail(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export function claimDiagnostics(
  claims: Record<string, unknown>,
  ruleClaims: string[]
): Pick<OidcTestDiagnostics, 'claimNames' | 'claims'> {
  const names = Object.keys(claims)
    .filter(name => !['at_hash', 'c_hash', 'nonce', 'sid'].includes(name))
    .sort();
  const selected = new Map<string, string | boolean | string[] | null>();
  for (const name of [...DIAGNOSTIC_CLAIMS, ...ruleClaims]) {
    const value = readOidcClaim(claims, name);
    if (value !== undefined)
      selected.set(
        name,
        name === 'email' ? (maskEmail(String(value)) ?? null) : diagnosticValue(value)
      );
  }
  return { claimNames: names.slice(0, 100), claims: Object.fromEntries(selected) };
}

function providerFailureCode(error: string | undefined): AdminTestFailureCode {
  switch (error) {
    case 'access_denied':
    case 'login_required':
    case 'consent_required':
    case 'interaction_required':
      return 'PROVIDER_ACCESS_DENIED';
    case 'invalid_scope':
      return 'PROVIDER_INVALID_SCOPE';
    case 'invalid_client':
    case 'unauthorized_client':
      return 'PROVIDER_CLIENT_REJECTED';
    default:
      return 'PROVIDER_ERROR';
  }
}

function sanitizedProviderMessage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  // Provider text is shown only to the administrator who started the test; strip control
  // characters and cap it so it cannot dominate the page.
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Converts token-exchange and validation errors into a catalogued failure. */
function classifyTestError(error: unknown): OidcTestFailure {
  if (error instanceof OidcTestFailure) return error;
  if (error instanceof openidErrors.OPError)
    return new OidcTestFailure(providerFailureCode(error.error), {
      providerMessage: sanitizedProviderMessage(
        [error.error, error.error_description].filter(Boolean).join(': ')
      ),
    });
  if (error instanceof openidErrors.RPError)
    return new OidcTestFailure('TOKEN_EXCHANGE_FAILED', {
      providerMessage: sanitizedProviderMessage(error.message),
    });
  return new OidcTestFailure('UNKNOWN');
}

async function recordTestFailure(
  flow: { id: string; adminUserId: string; revisionId: string },
  failure: OidcTestFailure
) {
  await prisma.$transaction(async tx => {
    await tx.oidcTestFlow.update({
      where: { id: flow.id },
      data: {
        failureCode: failure.code,
        diagnostics: failure.diagnostics as Prisma.InputJsonValue,
      },
    });
    await securityEvent(
      tx,
      'auth.oidc.test.failed',
      flow.adminUserId,
      { revisionId: flow.revisionId, reason: failure.code },
      'failed'
    );
  });
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
    defaultRole: active.defaultRole,
    unmatchedPolicy: active.unmatchedPolicy,
    rolePrecedence: active.rolePrecedence,
    domainTrustedLinking: active.domainTrustedLinking,
    teamMapping: Array.isArray(active.teamMapping) ? active.teamMapping : [],
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

/**
 * Every setting that can change who signs in, as whom, or with what role, including whether new
 * accounts are created. Left out: session limits, the button label, profile fields and team
 * rules, which never decide admission or role. The secret is compared separately, by ciphertext.
 */
function identityFingerprint(config: ProviderConfiguration) {
  const {
    clientSecret: _secret,
    sessionMaxAgeSeconds: _maxAge,
    sessionIdleTimeoutSeconds: _idle,
    providerLabel: _label,
    profileMapping: _profile,
    teamMapping: _teams,
    ...identity
  } = config;
  return JSON.stringify(identity);
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
  if (config.teamMapping.length) {
    const teamIds = [...new Set(config.teamMapping.map(rule => rule.teamId))];
    const found = await prisma.team.count({ where: { id: { in: teamIds } } });
    if (found !== teamIds.length)
      throw new Error('A team rule points at a team that no longer exists. Choose the team again.');
  }
  if (config.domainTrustedLinking && config.allowedDomains.length === 0)
    throw new Error('Domain-trusted linking needs at least one allowed domain.');
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
    // Changing only settings that cannot affect who signs in or with what role (session
    // limits, button label, profile fields, team rules, JIT) keeps the administrator test.
    const carriedProof =
      sourceRevision &&
      source &&
      sourceRevision.baseConfigVersion === (current?.configVersion ?? 0) &&
      encryptedSecret === source.clientSecret &&
      identityFingerprint(source) === identityFingerprint(config)
        ? await tx.oidcRevisionTest.findFirst({
            where: { revisionId: sourceRevision.id },
            orderBy: { verifiedAt: 'desc' },
          })
        : null;
    if (carriedProof) {
      const { id: _id, revisionId: _revisionId, ...proof } = carriedProof;
      await tx.oidcRevisionTest.create({ data: { ...proof, revisionId: revision.id } });
    }
    await securityEvent(tx, 'auth.oidc.revision.staged', actor.id, {
      carriedAdministratorTest: Boolean(carriedProof),
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
    flow &&
    !flow.consumedAt &&
    flow.expiresAt.getTime() <= Date.now() &&
    flow.browserHash === digest(browserToken)
  ) {
    // Same browser, too slow: record why so the result page can say so.
    const claimedExpired = await prisma.oidcTestFlow.updateMany({
      where: { id: flow.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimedExpired.count === 1)
      await recordTestFailure(flow, new OidcTestFailure('FLOW_EXPIRED'));
  }
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
    await recordTestFailure(flow, new OidcTestFailure('REVISION_DELETED'));
    throw new OidcRevisionTestError(
      'The configuration under test was deleted before sign-in completed. Production configuration is unchanged.',
      flow.id
    );
  }
  let diagnostics: OidcTestDiagnostics = {};
  try {
    const secrets = JSON.parse(await decrypt(flow.secrets)) as {
      nonce: string;
      verifier: string;
      actor: ControlActor;
      origin: string;
    };
    const origin = await authenticationOrigin();
    if (origin !== secrets.origin) throw new OidcTestFailure('ORIGIN_CHANGED');
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
    diagnostics = claimDiagnostics(
      claims,
      config.roleMapping.map(rule => rule.claim)
    );
    const provider = getOidcProviderPolicy(config.issuer, config.providerType);
    const boundary = provider.validateOrganizationBoundary(
      normalizeOidcBoundaryClaims(claims),
      config.allowedDomains,
      config.organizationId
    );
    if (!boundary.ok)
      throw new OidcTestFailure(
        boundary.reason === 'OIDC_DOMAIN_NOT_ALLOWED'
          ? 'DOMAIN_NOT_ALLOWED'
          : boundary.reason === 'OIDC_EMAIL_ASSURANCE_REQUIRED'
            ? 'EMAIL_UNVERIFIED'
            : 'ORGANIZATION_REJECTED',
        diagnostics
      );
    if (!claims.sub) throw new OidcTestFailure('SUBJECT_MISSING', diagnostics);
    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    const emailVerified = coerceBooleanClaim(claims.email_verified);
    if (emailVerified === false) throw new OidcTestFailure('EMAIL_UNVERIFIED', diagnostics);
    const emailOwnershipVerified =
      Boolean(email) && (emailVerified === true || provider.allowsMissingEmailVerified());
    const role = evaluateOidcRoleClaims(claims, config.roleMapping, config);
    if (role.outcome === 'INCOMPLETE')
      throw new OidcTestFailure('GROUP_CLAIMS_INCOMPLETE', {
        ...diagnostics,
        role: { result: 'incomplete group claims (too many groups)' },
      });
    await prisma.$transaction(async tx => {
      await lockControlActor(tx, secrets.actor, false);
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${flow.adminUserId} FOR UPDATE`;
      const active = await tx.oidcConfig.findUnique({ where: { id: 'default' } });
      if ((active?.configVersion ?? 0) !== flow.testedConfigVersion)
        throw new OidcTestFailure('CONFIG_CHANGED', diagnostics);
      const admin = await tx.user.findUniqueOrThrow({ where: { id: flow.adminUserId } });
      if (
        admin.role !== 'ADMIN' ||
        admin.status !== 'ACTIVE' ||
        admin.tokenVersion !== flow.adminTokenVersion
      )
        throw new OidcTestFailure('ADMIN_STATE_CHANGED', diagnostics);
      const identity = await findRevisionIdentity(tx, config.issuer, claims.sub);
      if (identity && identity.userId !== admin.id)
        throw new OidcTestFailure('IDENTITY_OWNED_BY_OTHER_USER', diagnostics);
      if (!identity) {
        const emails = {
          receivedEmail: maskEmail(email),
          expectedEmail: maskEmail(admin.email.toLowerCase()),
        };
        if (!flow.linkApproved) throw new OidcTestFailure('LINK_NOT_ALLOWED', diagnostics);
        if (!email) throw new OidcTestFailure('EMAIL_MISSING', { ...diagnostics, ...emails });
        if (!emailOwnershipVerified)
          throw new OidcTestFailure('EMAIL_UNVERIFIED', { ...diagnostics, ...emails });
        if (email !== admin.email.toLowerCase())
          throw new OidcTestFailure('EMAIL_MISMATCH', { ...diagnostics, ...emails });
      }
      const resolved = resolveSignInRole(
        role,
        { role: admin.role, roleSource: admin.roleSource },
        { firstLink: !identity }
      );
      const denied = role.deny && resolved.roleSource !== 'MANUAL';
      const effectiveRole = denied ? 'DENIED' : resolved.role;
      diagnostics = {
        ...diagnostics,
        role: {
          result:
            role.outcome === 'MATCHED'
              ? `matched ${role.matchedRule?.claim} = ${role.matchedRule?.value}`
              : role.missingClaims.length > 0
                ? `no rule matched; missing claims: ${role.missingClaims.join(', ')}`
                : 'no rule matched',
          effectiveRole:
            resolved.roleSource === 'MANUAL' && !denied
              ? `${effectiveRole} (set manually, kept)`
              : effectiveRole,
        },
      };
      if (effectiveRole !== 'ADMIN')
        throw new OidcTestFailure('ROLE_WOULD_DROP_ADMIN', diagnostics);
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
      await tx.oidcTestFlow.update({
        where: { id: flow.id },
        data: { diagnostics: diagnostics as Prisma.InputJsonValue },
      });
      await securityEvent(tx, 'auth.oidc.test.success', admin.id, {
        revisionId: revision.id,
        preservedUserId: admin.id,
        authorizedBy: flow.authorizedBy,
        effectiveRole,
      });
    });
    return { flowId: flow.id, revisionId: flow.revisionId };
  } catch (error) {
    const failure = classifyTestError(error);
    if (failure.code === 'UNKNOWN')
      logger.error('[OIDC test] Unclassified administrator test failure', {
        component: 'auth-control:oidc-test',
        flowId: flow.id,
        error,
      });
    await recordTestFailure(flow, failure);
    throw new OidcRevisionTestError(
      'SSO administrator test failed. Production configuration is unchanged.',
      flow.id
    );
  }
}

/**
 * The provider ended the test with an OAuth error instead of a code (cancelled, not assigned,
 * bad scope). The flow is still bound to this browser, so record why and show it.
 */
export async function recordOidcRevisionTestProviderError(
  state: string,
  browserToken: string,
  error: string,
  description: string | null
): Promise<string | null> {
  const flow = await prisma.oidcTestFlow.findUnique({ where: { stateHash: digest(state) } });
  if (!flow || flow.browserHash !== digest(browserToken)) return null;
  const claimed = await prisma.oidcTestFlow.updateMany({
    where: { id: flow.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) return flow.id;
  await recordTestFailure(
    flow,
    new OidcTestFailure(providerFailureCode(error), {
      providerMessage: sanitizedProviderMessage([error, description].filter(Boolean).join(': ')),
    })
  );
  return flow.id;
}

export type OidcTestResult =
  | {
      outcome: 'verified';
      revisionId: string;
      verifiedAt: string;
      expiresAt: string;
      diagnostics: OidcTestDiagnostics;
    }
  | {
      outcome: 'failed';
      revisionId: string | null;
      reason: 'deleted' | 'failed';
      code: AdminTestFailureCode;
      diagnostics: OidcTestDiagnostics;
    }
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
  const diagnostics = (flow.diagnostics ?? {}) as OidcTestDiagnostics;
  if (!revision)
    return {
      outcome: 'failed',
      revisionId: null,
      reason: 'deleted',
      code: 'REVISION_DELETED',
      diagnostics,
    };
  const proof = await prisma.oidcRevisionTest.findFirst({
    where: {
      revisionId: flow.revisionId,
      adminUserId: flow.adminUserId,
      verifiedAt: { gte: flow.createdAt },
    },
    orderBy: { verifiedAt: 'desc' },
  });
  if (!proof)
    return {
      outcome: 'failed',
      revisionId: flow.revisionId,
      reason: 'failed',
      code: isAdminTestFailureCode(flow.failureCode) ? flow.failureCode : 'UNKNOWN',
      diagnostics,
    };
  return {
    outcome: 'verified',
    revisionId: flow.revisionId,
    verifiedAt: proof.verifiedAt.toISOString(),
    expiresAt: new Date(proof.verifiedAt.getTime() + PROOF_MAX_AGE_MS).toISOString(),
    diagnostics,
  };
}

/**
 * Who can use single sign-on the moment this configuration is activated, and who still needs
 * an administrator. Mirrors the sign-in rules in oidc-identity-resolution.ts.
 */
async function linkingReadiness(tx: Prisma.TransactionClient, config: ProviderConfiguration) {
  const fingerprint = oidcTrustFingerprint(config.issuer, config.clientId);
  const now = new Date();
  const unlinked: Prisma.UserWhereInput = {
    status: { in: ['ACTIVE', 'INVITED'] },
    oidcIdentities: { none: { issuer: config.issuer } },
  };
  const [approvalsCarriedOver, approvalsRevoked, approvedUsers] = await Promise.all([
    tx.oidcLinkingApproval.count({
      where: {
        consumedAt: null,
        revokedAt: null,
        issuerFingerprint: fingerprint,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    tx.oidcLinkingApproval.count({
      where: {
        consumedAt: null,
        revokedAt: null,
        OR: [{ issuerFingerprint: { not: fingerprint } }, { issuerFingerprint: null }],
      },
    }),
    tx.user.count({
      where: {
        ...unlinked,
        oidcLinkingApproval: {
          consumedAt: null,
          revokedAt: null,
          issuerFingerprint: fingerprint,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
    }),
  ]);
  const domainTrusted =
    config.domainTrustedLinking && config.allowedDomains.length > 0
      ? await tx.user.count({
          where: {
            ...unlinked,
            role: { not: 'ADMIN' },
            OR: config.allowedDomains.map(domain => ({
              email: { endsWith: `@${domain}`, mode: 'insensitive' as const },
            })),
            NOT: {
              oidcLinkingApproval: {
                consumedAt: null,
                revokedAt: null,
                issuerFingerprint: fingerprint,
              },
            },
          },
        })
      : 0;
  const total = await tx.user.count({ where: unlinked });
  return {
    total,
    approved: approvedUsers,
    // Whether these accounts really connect automatically depends on claims the provider sends
    // at sign-in (xms_edov, hd, email_verified), which cannot be known in advance. They stay
    // in needApproval so the count never understates who could be locked out.
    domainTrusted,
    needApproval: Math.max(0, total - approvedUsers),
    approvalsCarriedOver,
    approvalsRevoked,
  };
}

const ROLE_IMPACT_SCAN_LIMIT = 5000;
const ROLE_IMPACT_SAMPLE = 25;

/**
 * Which directory-managed people would get a different role at their next sign-in under these
 * rules, using the mapped claim values remembered from their last sign-in.
 */
async function roleChangeImpact(tx: Prisma.TransactionClient, config: ProviderConfiguration) {
  const identities = await tx.oidcIdentity.findMany({
    where: { issuer: config.issuer, claimSnapshot: { not: Prisma.DbNull } },
    select: {
      claimSnapshot: true,
      user: {
        select: { id: true, name: true, email: true, role: true, roleSource: true, status: true },
      },
    },
    orderBy: { lastLoginAt: 'desc' },
    take: ROLE_IMPACT_SCAN_LIMIT,
  });
  const changes: Array<{ userId: string; name: string; from: string; to: string }> = [];
  let changed = 0;
  let denied = 0;
  for (const identity of identities) {
    const user = identity.user;
    if (user.status === 'DISABLED') continue;
    const evaluation = evaluateOidcRoleClaims(
      snapshotAsClaims(identity.claimSnapshot),
      config.roleMapping,
      config
    );
    const resolved = resolveSignInRole(evaluation, {
      role: user.role,
      roleSource: user.roleSource,
    });
    if (evaluation.deny && resolved.roleSource !== 'MANUAL') {
      denied += 1;
      continue;
    }
    if (resolved.role === user.role) continue;
    changed += 1;
    if (changes.length < ROLE_IMPACT_SAMPLE)
      changes.push({
        userId: user.id,
        name: user.name || user.email,
        from: user.role,
        to: resolved.role,
      });
  }
  const teamChanges = await teamChangeImpact(tx, config, identities);
  return {
    evaluated: identities.length,
    changed,
    denied,
    changes,
    teamAdditions: teamChanges.additions,
    teamRemovals: teamChanges.removals,
    truncated: identities.length === ROLE_IMPACT_SCAN_LIMIT,
  };
}

/** Memberships team rules would add or remove at people's next sign-in, from snapshots. */
async function teamChangeImpact(
  tx: Prisma.TransactionClient,
  config: ProviderConfiguration,
  identities: Array<{ claimSnapshot: Prisma.JsonValue; user: { id: string; status: string } }>
) {
  const active = identities.filter(identity => identity.user.status !== 'DISABLED');
  const userIds = active.map(identity => identity.user.id);
  if (userIds.length === 0) return { additions: 0, removals: 0 };
  const memberships = await tx.teamMember.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, teamId: true, role: true, oidcGrant: { select: { id: true } } },
  });
  const byUser = new Map<string, typeof memberships>();
  for (const member of memberships)
    byUser.set(member.userId, [...(byUser.get(member.userId) ?? []), member]);
  let additions = 0;
  let removals = 0;
  for (const identity of active) {
    const claims = snapshotAsClaims(identity.claimSnapshot);
    const wanted = new Set(
      config.teamMapping.filter(rule => oidcRuleMatches(claims, rule)).map(rule => rule.teamId)
    );
    const current = byUser.get(identity.user.id) ?? [];
    const currentTeams = new Set(current.map(member => member.teamId));
    additions += [...wanted].filter(teamId => !currentTeams.has(teamId)).length;
    removals += current.filter(
      member => member.oidcGrant && member.role === 'MEMBER' && !wanted.has(member.teamId)
    ).length;
  }
  return { additions, removals };
}

/** Snapshots store values by claim path; rebuild an object the rule engine can read. */
export function snapshotAsClaims(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {};
  return Object.fromEntries(
    Object.entries(snapshot as Record<string, unknown>).filter(([, value]) => Array.isArray(value))
  );
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
  const linking = await linkingReadiness(tx, config);
  const usersRequiringLinking = linking.needApproval;
  const roleImpact = await roleChangeImpact(tx, config);
  const staleRevision =
    !isActive && (active?.configVersion ?? 0) !== revision.baseConfigVersion
      ? 'The active provider changed after this configuration was saved. Save and test again.'
      : '';
  // What each mode needs. SSO Optional keeps passwords working, so it never needs emergency
  // identities; SSO Required does.
  const blockersByMode = {
    SSO_OPTIONAL: [
      !adminVerified ? oidcProofLabel(verification.state).detail : '',
      staleRevision,
    ].filter(Boolean),
    SSO_REQUIRED: [
      !adminVerified ? oidcProofLabel(verification.state).detail : '',
      ready.length < 2
        ? 'Create two independent emergency identities and sign in with each once.'
        : '',
      staleRevision,
      replicas ? 'Reconcile conflicting legacy settings on active replicas.' : '',
    ].filter(Boolean),
  };
  const blockers = blockersByMode.SSO_REQUIRED;
  return {
    policyVersion: policy.version,
    revisionId,
    passwordSessionCount,
    usersRequiringLinking,
    linking,
    roleImpact,
    verifiedEmergencyAccounts: ready.length,
    adminVerified,
    verification,
    blockers,
    blockersByMode,
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
      linking: value.linking,
      roleImpact: value.roleImpact,
      verifiedEmergencyAccounts: value.verifiedEmergencyAccounts,
      adminVerified: value.adminVerified,
      verification: value.verification,
      blockers: value.blockers,
      blockersByMode: value.blockersByMode,
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
            emailAtLink: proof.email,
            providerConfigId: 'default',
            // Without the fingerprint, the directory showed the administrator who just turned
            // SSO on as "not linked to the current provider".
            issuerFingerprint: oidcTrustFingerprint(proof.issuer, data.config.clientId),
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
      // Approvals granted for this same issuer and client (including ones prepared before
      // activation) stay valid and move to the new version; approvals for any other
      // provider registration can never be used and are revoked.
      const activatedFingerprint = oidcTrustFingerprint(data.config.issuer, data.config.clientId);
      await tx.oidcLinkingApproval.updateMany({
        where: { consumedAt: null, revokedAt: null, issuerFingerprint: activatedFingerprint },
        data: { configVersion: version },
      });
      await tx.oidcLinkingApproval.updateMany({
        where: {
          consumedAt: null,
          revokedAt: null,
          OR: [{ issuerFingerprint: { not: activatedFingerprint } }, { issuerFingerprint: null }],
        },
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
