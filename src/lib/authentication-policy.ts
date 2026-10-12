import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getLocalAuthPolicy } from '@/lib/local-auth-policy';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import {
  evaluateAuthenticationPolicy,
  type AuthenticationAction,
  type AuthenticationMethod,
  type AuthenticationPolicyState,
} from '@/lib/authentication-policy-evaluator';

export class AuthenticationPolicyDeniedError extends Error {
  constructor() {
    super('Local password operations are disabled by authentication policy.');
    this.name = 'AuthenticationPolicyDeniedError';
  }
}

export { evaluateAuthenticationPolicy } from '@/lib/authentication-policy-evaluator';

/** Explicit one-time import; advisory lock serializes bootstrap across web replicas. */
export async function initializeAuthenticationPolicy() {
  const existing = await prisma.authenticationPolicy.findUnique({ where: { id: 'default' } });
  if (existing) return existing;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(210012001::bigint)`;
    const winner = await tx.authenticationPolicy.findUnique({ where: { id: 'default' } });
    if (winner) return winner;
    if (await tx.authenticationPolicyImport.findUnique({ where: { id: 'default' } })) {
      throw new Error(
        'Authentication policy is missing after migration. Restore PostgreSQL policy state; environment fallback is prohibited.'
      );
    }
    const legacy = getLocalAuthPolicy();
    const oidc = await tx.oidcConfig.findUnique({ where: { id: 'default' } });
    const snapshot = {
      localLoginEnabled: legacy.localLoginEnabled,
      breakGlassEnabled: legacy.breakGlassEnabled,
      breakGlassEmail: legacy.breakGlassEmail,
      oidcEnabled: Boolean(oidc?.enabled),
    };
    const policy = await tx.authenticationPolicy.create({
      data: {
        id: 'default',
        mode: !legacy.localLoginEnabled
          ? 'SSO_REQUIRED'
          : oidc?.enabled
            ? 'SSO_OPTIONAL'
            : 'PASSWORD_ONLY',
        oidcConfigVersion: oidc?.configVersion ?? null,
        passwordSessionMinVersion: legacy.localLoginEnabled ? 0 : 1,
        legacyEmergencyEmail: legacy.breakGlassEnabled ? legacy.breakGlassEmail : null,
        legacySnapshot: snapshot,
        enforcedAt: !legacy.localLoginEnabled ? new Date() : null,
      },
    });
    await tx.authenticationPolicyImport.create({ data: { id: 'default' } });
    await logAudit(
      {
        action: 'auth.policy.migrated',
        entityType: 'SYSTEM_CONFIG',
        source: 'MIGRATION',
        entityId: 'default',
        details: { ...snapshot, mode: policy.mode, version: policy.version },
      },
      tx
    );
    logger.warn(
      'Authentication policy imported from legacy environment. Database policy is now authoritative; legacy emergency passwords require replacement.',
      {
        component: 'authentication-policy',
        mode: policy.mode,
        legacyEmergencyConfigured: Boolean(policy.legacyEmergencyEmail),
      }
    );
    return policy;
  });
}

/** No process cache: revocation and login decisions converge on the next protected request. */
export async function getAuthenticationPolicy() {
  return initializeAuthenticationPolicy();
}

export async function checkAuthenticationPolicy(
  action: AuthenticationAction,
  principal: { email?: string | null } = {},
  session: { method?: AuthenticationMethod; policyVersion?: number } = {}
) {
  const policy = await getAuthenticationPolicy();
  return evaluateAuthenticationPolicy(policy, action, principal, session);
}

export async function assertPasswordOperationAllowed(client?: Prisma.TransactionClient) {
  let policy: AuthenticationPolicyState;
  if (client) {
    // Shares the policy lock with mode transitions. A reset cannot commit after enforcement.
    const rows = await client.$queryRaw<AuthenticationPolicyState[]>`
      SELECT "mode", "version", "legacyEmergencyEmail", "passwordSessionMinVersion", "oidcSessionMinVersion" FROM "AuthenticationPolicy"
      WHERE "id" = 'default' FOR UPDATE`;
    if (!rows[0]) throw new Error('Authentication policy is missing.');
    policy = rows[0];
  } else policy = await getAuthenticationPolicy();
  if (!evaluateAuthenticationPolicy(policy, 'PASSWORD_WRITE').allowed) {
    throw new AuthenticationPolicyDeniedError();
  }
}

export async function getDatabaseLocalAuthPolicy() {
  const policy = await getAuthenticationPolicy();
  const localLoginEnabled = policy.mode !== 'SSO_REQUIRED';
  return {
    enabled: localLoginEnabled || Boolean(policy.legacyEmergencyEmail),
    localLoginEnabled,
    oidcLoginEnabled: policy.mode !== 'PASSWORD_ONLY',
    breakGlassEnabled: Boolean(policy.legacyEmergencyEmail),
    breakGlassEmail: policy.legacyEmergencyEmail,
  };
}
