import 'server-only';
import type { Prisma } from '@prisma/client';
import { getLegacyOidcIssuerVariants } from '@/lib/oidc/issuer-migration';

// Test and preview flows must preserve legacy ownership without migrating bindings.
export async function findRevisionIdentity(
  tx: Pick<Prisma.TransactionClient, 'oidcIdentity'>,
  issuer: string,
  subject: string
) {
  const identities = await tx.oidcIdentity.findMany({
    where: { issuer: { in: [issuer, ...getLegacyOidcIssuerVariants(issuer)] }, subject },
  });
  if (new Set(identities.map(identity => identity.userId)).size > 1)
    throw new Error('Ambiguous external identity ownership requires administrator resolution.');
  return identities.find(identity => identity.issuer === issuer) ?? identities[0] ?? null;
}
