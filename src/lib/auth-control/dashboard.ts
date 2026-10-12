import 'server-only';
import prisma from '@/lib/prisma';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import { providerConfigSchema } from './provider-config';
import { activeProviderConfiguration } from './oidc-revisions';
import { evaluateOidcRoleClaims } from '@/lib/oidc/role-mapping';
import { normalizeOidcIssuer } from '@/lib/oidc/issuer-migration';
import { getOidcProviderPolicy } from '@/lib/oidc/provider-policy';
import type { ControlActor } from './actor';
import { emergencyReadiness } from './emergency-management';
import { findRevisionIdentity } from './identity';

export async function authenticationDashboard(actor: ControlActor) {
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
      orderBy: { enrolledAt: 'asc' },
      include: { credentials: { orderBy: { createdAt: 'desc' } } },
    }),
    prisma.emergencyAccessEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.user.findMany({
      where: { status: { in: ['ACTIVE', 'INVITED'] } },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roleSource: true,
        status: true,
        oidcIdentities: { select: { issuer: true } },
      },
      take: 500,
      orderBy: { email: 'asc' },
    }),
    emergencyReadiness(prisma).catch(error => {
      if (error instanceof Error && error.message.includes('conflicting canonical')) return [];
      throw error;
    }),
    prisma.authenticationReplicaObservation.findMany({
      where: { lastSeenAt: { gt: new Date(Date.now() - 600000) } },
    }),
    prisma.authenticationAlert.count({ where: { deliveredAt: null } }),
    prisma.userDevice.findMany({
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
    }),
  ]);
  const redact = (config: ReturnType<typeof providerConfigSchema.parse>) => {
    const { clientSecret, ...publicConfig } = config;
    return { ...publicConfig, clientSecret: '', hasClientSecret: Boolean(clientSecret) };
  };
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
    const cutoff =
      method === 'oidc' ? policy.oidcSessionMinVersion : policy.passwordSessionMinVersion;
    const disallowed =
      (method === 'oidc' && policy.mode === 'PASSWORD_ONLY') ||
      (method === 'credentials' && policy.mode === 'SSO_REQUIRED') ||
      (metadata.issuedUnderPolicyVersion ?? 0) < cutoff;
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
    registeredSessions,
    actor: { kind: actor.kind, id: actor.id },
    mode: policy.mode,
    policyVersion: policy.version,
    activeRevisionId: policy.activeRevisionId,
    legacyEmergencyConfigured: Boolean(policy.legacyEmergencyEmail),
    activeProvider: active ? redact(activeProviderConfiguration(active)) : null,
    providerConfigVersion: active?.configVersion ?? 0,
    revisions: revisions.map(revision => ({
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

export async function identityClaimsPreview(revisionId: string, claims: Record<string, unknown>) {
  const revision = await prisma.oidcRevision.findUniqueOrThrow({ where: { id: revisionId } });
  const config = providerConfigSchema.parse(revision.configuration);
  const role = evaluateOidcRoleClaims(claims, config.roleMapping);
  const provider = getOidcProviderPolicy(config.issuer, config.providerType);
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null;
  const subject = typeof claims.sub === 'string' ? claims.sub : null;
  if (typeof claims.iss !== 'string' || normalizeOidcIssuer(claims.iss) !== config.issuer)
    return { outcome: 'REJECT', reason: 'Issuer must exactly match this staged revision.', role };
  if (
    !subject ||
    !email ||
    claims.email_verified === false ||
    (!provider.allowsMissingEmailVerified() && claims.email_verified !== true)
  )
    return {
      outcome: 'REJECT',
      reason: 'Stable subject and required verified email claims are missing.',
      role,
    };
  if (
    !provider.validateOrganizationBoundary(claims, config.allowedDomains, config.organizationId).ok
  )
    return { outcome: 'REJECT', reason: 'Organization boundary rejected these claims.', role };
  let identity;
  try {
    identity = await findRevisionIdentity(prisma, config.issuer, subject);
  } catch {
    return { outcome: 'REJECT', reason: 'Ambiguous external identity ownership.', role };
  }
  const user = await prisma.user.findUnique({
    where: identity ? { id: identity.userId } : { email },
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
