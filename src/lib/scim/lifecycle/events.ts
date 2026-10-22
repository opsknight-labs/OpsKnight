import { scimRequestId } from '../protocol/http';
import type { Prisma } from '@prisma/client';
import type { ScimPrincipal } from '../security/credentials';
export async function event(
  tx: Prisma.TransactionClient,
  principal: ScimPrincipal,
  action: string,
  resourceId: string,
  details: Prisma.InputJsonObject = {}
) {
  await tx.scimEvent.create({
    data: {
      connectorId: principal.connectorId,
      action,
      resourceId,
      requestId: scimRequestId(),
      details: { credentialId: principal.credentialId, ...details },
    },
  });
}
