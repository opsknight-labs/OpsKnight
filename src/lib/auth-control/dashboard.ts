import 'server-only';
import { z } from 'zod/v3';
import { coerceBooleanClaim, normalizeOidcBoundaryClaims } from '@/lib/oidc/claims';
import prisma from '@/lib/prisma';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import { getEnterpriseSessionPolicy } from '@/lib/local-auth-policy';
import { providerConfigSchema } from './provider-config';
import { storedProviderConfiguration } from './oidc-revisions';
import { evaluateOidcRoleClaims } from '@/lib/oidc/role-mapping';
import { normalizeOidcIssuer } from '@/lib/oidc/issuer-migration';
import { getOidcProviderPolicy } from '@/lib/oidc/provider-policy';
import { type ControlActor, isAuthenticationFresh } from './actor';
import { emergencyReadiness } from './emergency-management';
import { findRevisionIdentity } from './identity';
import { authenticationOrigin, recoveryOrigin } from './origin';
import { getActiveLinkingProvider, resolveOidcLinkingStatuses } from '@/lib/oidc-linking-status';
import { evaluateOidcProof } from './proof-status';

export type AuthenticationSection =
  'overview' | 'connection' | 'access' | 'policy' | 'emergency' | 'diagnostics';
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
    fanoutJobs,
    deliveredAlertCount,
    acceptedAlertCount,
    cancelledAlertCount,
    failedAlertCount,
    sessions,
  ] = await Promise.all([
    getAuthenticationPolicy(),
    prisma.oidcConfig.findUnique({ where: { id: 'default' } }),
    prisma.oidcRevision.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { tests: { orderBy: { verifiedAt: 'desc' }, take: 1 } },
    }),
    Promise.all([
      prisma.emergencyAccount.findMany({
        where: { status: { not: 'DISABLED' } },
        orderBy: { enrolledAt: 'desc' },
        take: 20,
        select: {
          id: true,
          displayName: true,
          authenticationMethod: true,
          credentialVersion: true,
          status: true,
          verifiedAt: true,
          lastUsedAt: true,
          credentials: {
            orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
            take: section === 'emergency' ? 50 : 0,
            select: { id: true, displayName: true, createdAt: true, revokedAt: true },
          },
        },
      }),
      prisma.emergencyAccount.findMany({
        where: { status: 'DISABLED' },
        orderBy: { enrolledAt: 'desc' },
        take: 25,
        select: {
          id: true,
          displayName: true,
          authenticationMethod: true,
          credentialVersion: true,
          status: true,
          verifiedAt: true,
          lastUsedAt: true,
          credentials: {
            orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
            take: section === 'emergency' ? 50 : 0,
            select: { id: true, displayName: true, createdAt: true, revokedAt: true },
          },
        },
      }),
    ]).then(([active, disabled]) => [...active, ...disabled]),
    Promise.resolve(
      [] as Array<{
        id: string;
        eventType: string;
        outcome: string;
        createdAt: Date;
        emergencyAccountId: string | null;
      }>
    ),
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
    Promise.resolve([] as Array<{ id: string; lastSeenAt: Date; differs: boolean }>),
    section === 'diagnostics'
      ? prisma.authenticationAlert.count({
          where: { acceptedAt: null, deliveredAt: null, cancelledAt: null, failedAt: null },
        })
      : Promise.resolve(0),
    section === 'diagnostics' ? prisma.authenticationAlertFanout.count() : Promise.resolve(0),
    Promise.resolve(0), // Historical totals are not needed for operational summaries or pagination.
    section === 'diagnostics'
      ? prisma.authenticationAlert.count({
          where: {
            acceptedAt: { not: null },
            deliveredAt: null,
            failedAt: null,
            cancelledAt: null,
          },
        })
      : Promise.resolve(0),
    Promise.resolve(0),
    section === 'diagnostics' || section === 'overview'
      ? prisma.authenticationAlert.count({
          where: { failedAt: { not: null }, deliveredAt: null, cancelledAt: null },
        })
      : Promise.resolve(0),
    Promise.resolve(
      [] as Array<{
        id: string;
        email: string;
        method: string;
        state: string;
        expiresAt: string | null;
        issuedUnderPolicyVersion: number | null;
        lastActive: string;
      }>
    ),
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
  if (
    policy.activeRevisionId &&
    !revisions.some(revision => revision.id === policy.activeRevisionId)
  ) {
    const activeRevision = await prisma.oidcRevision.findUnique({
      where: { id: policy.activeRevisionId },
      include: { tests: { orderBy: { verifiedAt: 'desc' }, take: 1 } },
    });
    if (activeRevision) revisions.push(activeRevision);
  }
  const editableRevisions = revisions.filter(
    revision => providerConfigSchema.safeParse(revision.configuration).success
  );
  const providerCompatibilityWarning = Boolean(
    (activeParsed && !activeParsed.success) || editableRevisions.length !== revisions.length
  );
  const registeredSessions = sessions;
  // Verification and authorship are resolved server-side so every badge reflects the same
  // evaluation activation uses, and no client has to infer validity from a timestamp.
  const principalIds = new Set<string>();
  for (const revision of editableRevisions) {
    if (revision.tests[0]) principalIds.add(revision.tests[0].adminUserId);
    const [kind, id] = revision.createdBy.split(':');
    if (kind === 'admin' && id) principalIds.add(id);
  }
  const [principals, linkingProvider] = await Promise.all([
    principalIds.size
      ? prisma.user.findMany({
          where: { id: { in: [...principalIds] } },
          select: { id: true, email: true, role: true, status: true, tokenVersion: true },
        })
      : Promise.resolve([]),
    getActiveLinkingProvider(prisma),
  ]);
  const principalById = new Map(principals.map(principal => [principal.id, principal]));
  const adminLinking = await resolveOidcLinkingStatuses(
    prisma,
    users.map(user => user.id),
    linkingProvider
  );
  const now = new Date();
  const authorLabel = (createdBy: string) => {
    const [kind, id] = createdBy.split(':');
    if (createdBy === 'MIGRATION') return 'Imported at upgrade';
    if (kind === 'admin') return principalById.get(id)?.email ?? 'Former administrator';
    if (kind === 'emergency' || kind === 'legacy') return 'Emergency recovery';
    return 'System';
  };
  return {
    section,
    effectiveSessionPolicy: getEnterpriseSessionPolicy({
      sessionMaxAgeSeconds: active?.sessionMaxAgeSeconds,
      sessionIdleTimeoutSeconds: active?.sessionIdleTimeoutSeconds,
    }),
    inheritedSessionPolicy: getEnterpriseSessionPolicy(),
    freshAuthenticationRequired: !isAuthenticationFresh(actor.authenticatedAt, actor.kind),
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
      createdByLabel: authorLabel(revision.createdBy),
      verification: evaluateOidcProof(revision.tests[0], {
        now,
        origin: canonical.origin,
        activeConfigVersion: active?.configVersion ?? 0,
        administrator: revision.tests[0]
          ? (principalById.get(revision.tests[0].adminUserId) ?? null)
          : null,
      }),
    })),
    emergencyAccounts: accounts.map(account => ({
      id: account.id,
      displayName: account.displayName,
      authenticationMethod: account.authenticationMethod,
      credentialVersion: account.credentialVersion,
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
      linkingState: adminLinking.get(user.id)?.state ?? 'not-approved',
      oidcIdentities: undefined,
    })),
    replicas: replicas.map(replica => ({
      id: replica.id,
      differs: replica.differs,
      lastSeenAt: replica.lastSeenAt.toISOString(),
    })),
    pendingEmailAlerts: pendingAlerts,
    pendingEmailFanoutJobs: fanoutJobs,
    deliveredEmailAlertCount: deliveredAlertCount,
    acceptedEmailAlertCount: acceptedAlertCount,
    cancelledEmailAlertCount: cancelledAlertCount,
    failedEmailAlertCount: failedAlertCount,
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
  const page = users.slice(0, 25);
  // One batched resolution per page; linking is scoped to the active provider trust boundary.
  const statuses = await resolveOidcLinkingStatuses(
    prisma,
    page.map(user => user.id),
    await getActiveLinkingProvider(prisma)
  );
  return {
    users: page.map(user => {
      const status = statuses.get(user.id);
      return {
        ...user,
        issuers: user.oidcIdentities.map(identity => identity.issuer),
        linkingState: status?.state ?? 'not-approved',
        approvalExpiresAt: status?.approvalExpiresAt ?? null,
        oidcIdentities: undefined,
      };
    }),
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
    !provider.validateOrganizationBoundary(
      normalizeOidcBoundaryClaims(claims),
      config.allowedDomains,
      config.organizationId
    ).ok
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
    identityRecognized: Boolean(identity),
    administratorVerification: {
      ready: Boolean(
        user?.status === 'ACTIVE' && effectiveRole === 'ADMIN' && role.ok && !role.groupsOverage
      ),
      reason:
        !role.ok || role.groupsOverage
          ? 'Administrator verification blocked by incomplete group claims.'
          : user?.status !== 'ACTIVE'
            ? 'Select an active administrator for verification.'
            : effectiveRole !== 'ADMIN'
              ? 'These claims do not preserve administrator access.'
              : 'Sample claims permit an administrator test; real signed-token verification is still required.',
    },
    warning:
      role.ok && role.groupsOverage
        ? 'Entra group overage prevents mapped elevation. Resolve claims before rollout.'
        : null,
  };
}

export const authenticationAlertHistoryStatus = z.enum([
  'all',
  'pending',
  'failed',
  'delivered',
  'accepted',
  'cancelled',
]);
const alertCursorSchema = z
  .object({ id: z.string().min(1).max(128), createdAt: z.string().datetime() })
  .strict();

/** Bounded keyset history includes terminal records and stable ordering for timestamp ties. */
export async function authenticationAlertHistory(
  status: z.infer<typeof authenticationAlertHistoryStatus> = 'failed',
  after?: string
) {
  const cursor = after
    ? alertCursorSchema.parse(JSON.parse(Buffer.from(after, 'base64url').toString('utf8')))
    : null;
  const state =
    status === 'pending'
      ? { acceptedAt: null, deliveredAt: null, failedAt: null, cancelledAt: null }
      : status === 'failed'
        ? { failedAt: { not: null }, deliveredAt: null, cancelledAt: null }
        : status === 'accepted'
          ? { acceptedAt: { not: null }, deliveredAt: null, failedAt: null, cancelledAt: null }
          : status === 'delivered'
            ? { deliveredAt: { not: null } }
            : status === 'cancelled'
              ? { cancelledAt: { not: null } }
              : {};
  const rows = await prisma.authenticationAlert.findMany({
    where: {
      ...state,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 26,
    select: {
      id: true,
      eventId: true,
      recipientId: true,
      title: true,
      createdAt: true,
      acceptedAt: true,
      deliveredAt: true,
      failedAt: true,
      cancelledAt: true,
      attempts: true,
      lastError: true,
      deliveryGeneration: true,
    },
  });
  const page = rows.slice(0, 25);
  const last = page[page.length - 1];
  return {
    alerts: page.map(row => ({
      id: row.id,
      eventId: row.eventId,
      recipientId: row.recipientId,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      attempts: row.attempts,
      lastError: row.lastError,
      deliveryGeneration: row.deliveryGeneration,
      state: row.cancelledAt
        ? ('CANCELLED' as const)
        : row.deliveredAt
          ? ('DELIVERED' as const)
          : row.failedAt
            ? ('FAILED' as const)
            : row.acceptedAt
              ? ('ACCEPTED' as const)
              : ('PENDING' as const),
      completedAt:
        (row.cancelledAt ?? row.deliveredAt ?? row.failedAt ?? row.acceptedAt)?.toISOString() ??
        null,
    })),
    nextCursor:
      rows.length > 25 && last
        ? Buffer.from(
            JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() })
          ).toString('base64url')
        : null,
  };
}
