import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { getLegacyOidcIssuerVariants, normalizeOidcIssuer } from '@/lib/oidc/issuer-migration';
import { oidcTrustFingerprint } from '@/lib/oidc/trust-fingerprint';
import {
  getOidcLinkingApprovalState,
  type CurrentProviderTrustContext,
  type OidcLinkingState,
} from '@/lib/oidc-linking-approval';

type Db = PrismaClient | Prisma.TransactionClient;

export type ActiveLinkingProvider = {
  id: string;
  issuer: string;
  clientId: string;
  configVersion: number;
};

export type OidcLinkingStatus = {
  state: OidcLinkingState;
  /** Expiry of a pending first-link approval, when one exists. */
  approvalExpiresAt: string | null;
};

/** The provider trust boundary that production sign-in currently uses, or null if SSO is off. */
export async function getActiveLinkingProvider(db: Db): Promise<ActiveLinkingProvider | null> {
  const provider = await db.oidcConfig.findUnique({
    where: { id: 'default' },
    select: { id: true, issuer: true, clientId: true, configVersion: true, enabled: true },
  });
  if (!provider?.enabled || !provider.issuer || !provider.clientId) return null;
  return provider;
}

function trustContext(provider: ActiveLinkingProvider): CurrentProviderTrustContext {
  return {
    providerConfigId: provider.id,
    issuerFingerprint: oidcTrustFingerprint(provider.issuer, provider.clientId),
    configVersion: provider.configVersion,
  };
}

/**
 * Resolves each user's first-link state against the active provider trust boundary with a
 * fixed number of queries, regardless of page size:
 *
 * - linked: an identity under the active issuer (or a legacy spelling of it) whose trust
 *   fingerprint matches the active issuer + client ID. Identities recorded before
 *   fingerprints existed are not counted: providers such as Entra issue a different subject
 *   per app registration, so their binding to the current client cannot be assumed.
 * - provider-changed: the user only has identities that are not confirmed for the active
 *   trust boundary (another issuer, another client registration, or an unconfirmed legacy
 *   record), so linking to the current provider needs approval.
 * - approval states: from the shared approval state machine, scoped to the same boundary.
 */
export async function resolveOidcLinkingStatuses(
  db: Db,
  userIds: string[],
  provider: ActiveLinkingProvider | null,
  now = new Date()
): Promise<Map<string, OidcLinkingStatus>> {
  const result = new Map<string, OidcLinkingStatus>();
  if (!userIds.length) return result;
  const fingerprint = provider ? oidcTrustFingerprint(provider.issuer, provider.clientId) : null;
  const canonicalIssuer = provider ? normalizeOidcIssuer(provider.issuer) : null;
  const issuers = canonicalIssuer
    ? [canonicalIssuer, provider!.issuer, ...getLegacyOidcIssuerVariants(canonicalIssuer)]
    : [];

  const [currentIdentities, anyIdentities, approvals] = await Promise.all([
    provider
      ? db.oidcIdentity.findMany({
          where: {
            userId: { in: userIds },
            issuer: { in: issuers },
            issuerFingerprint: fingerprint,
          },
          select: { userId: true },
          distinct: ['userId'],
        })
      : Promise.resolve([] as Array<{ userId: string }>),
    db.oidcIdentity.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true },
      distinct: ['userId'],
    }),
    db.oidcLinkingApproval.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        revokedAt: true,
        consumedAt: true,
        expiresAt: true,
        providerConfigId: true,
        issuerFingerprint: true,
        configVersion: true,
      },
    }),
  ]);
  const linked = new Set(currentIdentities.map(identity => identity.userId));
  const hasAnyIdentity = new Set(anyIdentities.map(identity => identity.userId));
  const approvalByUser = new Map(approvals.map(approval => [approval.userId, approval]));
  const context = provider ? trustContext(provider) : null;

  for (const userId of userIds) {
    // Without an active provider there is no trust boundary to compare against.
    if (!provider) {
      result.set(userId, {
        state: hasAnyIdentity.has(userId) ? 'linked' : 'not-approved',
        approvalExpiresAt: null,
      });
      continue;
    }
    if (linked.has(userId)) {
      result.set(userId, { state: 'linked', approvalExpiresAt: null });
      continue;
    }
    const approval = approvalByUser.get(userId);
    const approvalState = getOidcLinkingApprovalState(approval, now, context);
    if (approvalState !== 'not-approved' && approvalState !== 'consumed') {
      result.set(userId, {
        state: approvalState,
        approvalExpiresAt:
          approvalState === 'approved' ? (approval?.expiresAt?.toISOString() ?? null) : null,
      });
      continue;
    }
    result.set(userId, {
      state: hasAnyIdentity.has(userId) ? 'provider-changed' : 'not-approved',
      approvalExpiresAt: null,
    });
  }
  return result;
}

export async function resolveOidcLinkingStatus(
  db: Db,
  userId: string,
  provider?: ActiveLinkingProvider | null,
  now = new Date()
): Promise<OidcLinkingStatus> {
  const active = provider !== undefined ? provider : await getActiveLinkingProvider(db);
  return (await resolveOidcLinkingStatuses(db, [userId], active, now)).get(userId)!;
}
