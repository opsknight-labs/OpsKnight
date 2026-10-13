import 'server-only';
import { coerceBooleanClaim } from '@/lib/oidc/claims';
import prisma from '@/lib/prisma';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import { providerConfigSchema } from './provider-config';
import { storedProviderConfiguration } from './oidc-revisions';
import { evaluateOidcRoleClaims } from '@/lib/oidc/role-mapping';
import { normalizeOidcIssuer } from '@/lib/oidc/issuer-migration';
import { getOidcProviderPolicy } from '@/lib/oidc/provider-policy';
import type { ControlActor } from './actor';
import { emergencyReadiness } from './emergency-management';
import { findRevisionIdentity } from './identity';
import { authenticationOrigin, recoveryOrigin } from './origin';
import { evaluateAuthenticationPolicy } from '@/lib/authentication-policy-evaluator';

export type AuthenticationSection =
  | 'overview'
  | 'connection'
  | 'access'
  | 'policy'
  | 'emergency'
  | 'diagnostics';
export async function authenticationDashboard(
  actor: ControlActor,
  section: AuthenticationSection = 'overview'
) {
  const [
    policy,
    active,
    revisions,
    accounts,
    events,
    users,
    ready,
    replicas,
    pendingAlerts,
    sessions,
  ] = await Promise.all([
    getAuthenticationPolicy(),
    prisma.oidcConfig.findUnique({ where: { id: 'default' } }),
    prisma.oidcRevision.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { tests: { orderBy: { verifiedAt: 'desc' }, take: 1 } },
    }),
    prisma.emergencyAccount.findMany({
      where: { status: { not: 'DISABLED' } },
      orderBy: { enrolledAt: 'desc' },
      take: 50,
      include: {
        credentials: {
          orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
          take: 50,
          select: { id: true, displayName: true, createdAt: true, revokedAt: true },
        },
      },
    }),
    section === 'diagnostics'
      ? prisma.emergencyAccessEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
      : Promise.resolve([]),
    prisma.user.findMany({
      where: {
        status: { in: ['ACTIVE', 'INVITED'] },
        ...{ role: 'ADMIN' as const, ...(actor.kind === 'admin' ? { id: actor.id } : {}) },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roleSource: true,
        status: true,
        oidcIdentities: { select: { issuer: true } },
      },
      take: 25,
      orderBy: { email: 'asc' },
    }),
    emergencyReadiness(prisma).catch(error => {
      if (error instanceof Error && error.message.includes('conflicting canonical')) return [];
      throw error;
    }),
    section === 'diagnostics'
      ? prisma.authenticationReplicaObservation.findMany({
          where: { lastSeenAt: { gt: new Date(Date.now() - 600000) } },
          take: 100,
        })
      : Promise.resolve([]),
    prisma.authenticationAlert.count({ where: { deliveredAt: null, cancelledAt: null } }),
    section === 'diagnostics'
      ? prisma.userDevice.findMany({
          where: { deviceId: { startsWith: 'session:' } },
          orderBy: { lastUsed: 'desc' },
          take: 100,
          select: {
            id: true,
            userId: true,
            platform: true,
            token: true,
            lastUsed: true,
            user: { select: { email: true } },
          },
        })
      : Promise.resolve([]),
  ]);
  const [canonical, pinnedOrigin] = await Promise.all([
    authenticationOrigin()
      .then(origin => ({ origin, conflict: false }))
      .catch(() => ({ origin: null, conflict: true })),
    recoveryOrigin().catch(error => {
      if (actor.kind === 'admin') return null;
      throw error;
    }),
  ]);
  const redact = (config: ReturnType<typeof providerConfigSchema.parse>) => {
    const { clientSecret, ...publicConfig } = config;
    return { ...publicConfig, clientSecret: '', hasClientSecret: Boolean(clientSecret) };
  };
  const activeParsed = active
    ? providerConfigSchema.safeParse(storedProviderConfiguration(active))
    : null;
  const editableRevisions = revisions.filter(
    revision => providerConfigSchema.safeParse(revision.configuration).success
  );
  const providerCompatibilityWarning = Boolean(
    (activeParsed && !activeParsed.success) || editableRevisions.length !== revisions.length
  );
  const registeredSessions = sessions.map(session => {
    let metadata: { expiresAt?: string; issuedUnderPolicyVersion?: number } = {};
    try {
      metadata = JSON.parse(session.token);
    } catch {
      /* Invalid metadata fails authentication closed. */
    }
    const method = session.platform.includes('OIDC') ? 'oidc' : 'credentials';
    const revoked = session.platform.startsWith('session:REVOKED:');
    const expired =
      !metadata.expiresAt ||
      !Number.isFinite(new Date(metadata.expiresAt).getTime()) ||
      new Date(metadata.expiresAt).getTime() <= Date.now();
    const disallowed = !evaluateAuthenticationPolicy(
      policy,
      'SESSION',
      { id: session.userId, email: session.user.email },
      { method, policyVersion: metadata.issuedUnderPolicyVersion }
    ).allowed;
    return {
      id: session.id,
      email: session.user.email,
      method,
      state: revoked || disallowed ? 'REVOKED' : expired ? 'EXPIRED' : 'ACTIVE',
      expiresAt: metadata.expiresAt ?? null,
      issuedUnderPolicyVersion: metadata.issuedUnderPolicyVersion ?? null,
      lastActive: session.lastUsed.toISOString(),
    };
  });
  return {
    section,
    originConflict: canonical.conflict,
    recoveryOrigin: pinnedOrigin,
    recoveryOriginPinned: Boolean(process.env.AUTH_RECOVERY_ORIGIN),
    recoveryDegradedAt: policy.recoveryDegradedAt?.toISOString() ?? null,
    passwordRecoveryUserId: policy.passwordRecoveryUserId,
    passwordRecoveryExpiresAt: policy.passwordRecoveryExpiresAt?.toISOString() ?? null,
    registeredSessions,
    actor: { kind: actor.kind, id: actor.id },
    mode: policy.mode,
    policyVersion: policy.version,
    activeRevisionId: policy.activeRevisionId,
    legacyEmergencyConfigured: Boolean(policy.legacyEmergencyEmail),
    activeProvider: activeParsed?.success ? redact(activeParsed.data) : null,
    providerCompatibilityWarning,
    providerConfigVersion: active?.configVersion ?? 0,
    revisions: editableRevisions.map(revision => ({
      id: revision.id,
      baseConfigVersion: revision.baseConfigVersion,
      configuration: redact(providerConfigSchema.parse(revision.configuration)),
      createdAt: revision.createdAt.toISOString(),
      discoveryVerifiedAt: revision.discoveryVerifiedAt?.toISOString() ?? null,
      activatedAt: revision.activatedAt?.toISOString() ?? null,
      previousRevisionId: revision.previousRevisionId,
      testedAt: revision.tests[0]?.verifiedAt.toISOString() ?? null,
      testedAdminId: revision.tests[0]?.adminUserId ?? null,
    })),
    emergencyAccounts: accounts.map(account => ({
      id: account.id,
      displayName: account.displayName,
      status: account.status,
      verifiedAt: account.verifiedAt?.toISOString() ?? null,
      lastUsedAt: account.lastUsedAt?.toISOString() ?? null,
      ready: ready.some(value => value.id === account.id),
      credentials: account.credentials.map(credential => ({
        id: credential.id,
        displayName: credential.displayName,
        createdAt: credential.createdAt.toISOString(),
        revokedAt: credential.revokedAt?.toISOString() ?? null,
      })),
    })),
    verifiedEmergencyAccounts: ready.length,
    usersHasMore: users.length === 25,
    events: events.map(event => ({
      id: event.id,
      eventType: event.eventType,
      outcome: event.outcome,
      createdAt: event.createdAt.toISOString(),
      accountId: event.emergencyAccountId,
    })),
    users: users.map(user => ({
      ...user,
      issuers: user.oidcIdentities.map(identity => identity.issuer),
      oidcIdentities: undefined,
    })),
    replicas: replicas.map(replica => ({
      id: replica.id,
      differs: replica.differs,
      lastSeenAt: replica.lastSeenAt.toISOString(),
    })),
    pendingEmailAlerts: pendingAlerts,
  };
}

/** Keyset pagination avoids loading a workspace directory for a recovery picker. */
export async function searchAuthenticationUsers(
  actor: ControlActor,
  query: string,
  after?: string,
  administratorsOnly = true
) {
  if (!administratorsOnly && actor.kind !== 'admin')
    throw new Error('Administrator directory access required.');
  const users = await prisma.user.findMany({
    where: {
      status: { in: ['ACTIVE', 'INVITED'] },
      ...(administratorsOnly ? { role: 'ADMIN', status: 'ACTIVE' } : {}),
      ...(query
        ? {
            OR: [
              { email: { contains: query, mode: 'insensitive' } },
              { name: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { id: 'asc' },
    take: 26,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      roleSource: true,
      status: true,
      oidcIdentities: { select: { issuer: true }, take: 10 },
    },
  });
  return {
    users: users.slice(0, 25).map(user => ({
      ...user,
      issuers: user.oidcIdentities.map(identity => identity.issuer),
      oidcIdentities: undefined,
    })),
    nextCursor: users.length > 25 ? users[24].id : null,
  };
}

export async function identityClaimsPreview(revisionId: string, claims: Record<string, unknown>) {
  const revision = await prisma.oidcRevision.findUniqueOrThrow({ where: { id: revisionId } });
  const config = providerConfigSchema.parse(revision.configuration);
  const role = evaluateOidcRoleClaims(claims, config.roleMapping);
  const provider = getOidcProviderPolicy(config.issuer, config.providerType);
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;
  const subject = typeof claims.sub === 'string' ? claims.sub : null;
  if (typeof claims.iss !== 'string' || normalizeOidcIssuer(claims.iss) !== config.issuer)
    return { outcome: 'REJECT', reason: 'Issuer must exactly match this staged revision.', role };
  if (!subject) return { outcome: 'REJECT', reason: 'A stable subject claim is required.', role };
  if (
    !provider.validateOrganizationBoundary(claims, config.allowedDomains, config.organizationId).ok
  )
    return { outcome: 'REJECT', reason: 'Organization boundary rejected these claims.', role };
  const emailVerified = coerceBooleanClaim(claims.email_verified);
  if (emailVerified === false)
    return { outcome: 'REJECT', reason: 'Provider explicitly reports unverified email.', role };
  let identity;
  try {
    identity = await findRevisionIdentity(prisma, config.issuer, subject);
  } catch {
    return { outcome: 'REJECT', reason: 'Ambiguous external identity ownership.', role };
  }
  if (!identity && (!email || (!provider.allowsMissingEmailVerified() && emailVerified !== true)))
    return {
      outcome: 'REJECT',
      reason: 'Verified email ownership is required for a new identity link.',
      role,
    };
  const user = await prisma.user.findUnique({
    where: identity ? { id: identity.userId } : { email: email! },
  });
  if (user?.status === 'DISABLED') return { outcome: 'REJECT', reason: 'User is disabled.', role };
  const effectiveRole =
    role.ok && user
      ? role.matched || user.roleSource === 'OIDC'
        ? role.role
        : user.role
      : role.ok
        ? role.role
        : null;
  return {
    outcome: identity
      ? 'EXISTING_IDENTITY'
      : user
        ? 'LINK_APPROVAL_REQUIRED'
        : config.autoProvision
          ? 'JIT_PROVISION'
          : 'REJECT',
    reason: identity
      ? 'Issuer and subject identify the same existing user; email changes do not relink it.'
      : user
        ? 'An explicit first-link approval is required; email matching alone never grants access.'
        : config.autoProvision
          ? 'Unknown identity can be provisioned after real token verification.'
          : 'JIT is disabled.',
    userId: user?.id ?? null,
    roleSource: user?.roleSource ?? 'OIDC',
    effectiveRole,
    role,
    warning:
      role.ok && role.groupsOverage
        ? 'Entra group overage prevents mapped elevation. Resolve claims before rollout.'
        : null,
  };
}
