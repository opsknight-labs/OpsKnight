import 'server-only';
import type { Prisma } from '@prisma/client';
import { normalizeOidcIssuer } from './issuer-migration';

export class OidcRegistrationChangedError extends Error {
  constructor() {
    super('OIDC_CONFIGURATION_CHANGED');
    this.name = 'OidcRegistrationChangedError';
  }
}

/** Hold these locks until all identity and claim writes in the caller commit. */
export async function assertCurrentOidcRegistration(
  tx: Prisma.TransactionClient,
  expected: { issuer: string; clientId?: string; configVersion?: number; providerConfigId?: string }
) {
  // Activation takes policy first, then provider. Keep the same order.
  const policies = await tx.$queryRaw<Array<{ mode: string }>>`
    SELECT "mode" FROM "AuthenticationPolicy" WHERE "id" = 'default' FOR SHARE`;
  const id = expected.providerConfigId ?? 'default';
  await tx.$queryRaw`SELECT "id" FROM "OidcConfig" WHERE "id" = ${id} FOR SHARE`;
  const current = await tx.oidcConfig.findUnique({ where: { id } });
  if (
    !policies[0] ||
    policies[0].mode === 'PASSWORD_ONLY' ||
    !current?.enabled ||
    current.configVersion !== expected.configVersion ||
    current.clientId !== expected.clientId ||
    normalizeOidcIssuer(current.issuer) !== normalizeOidcIssuer(expected.issuer)
  )
    throw new OidcRegistrationChangedError();
}
