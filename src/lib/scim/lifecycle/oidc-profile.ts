import type { Prisma } from '@prisma/client';
/** Called inside OIDC's security transaction so profile ownership cannot race provisioning. */
export async function preserveScimOwnedOidcFields(
  tx: Prisma.TransactionClient,
  userId: string,
  update: Record<string, unknown>
) {
  if (!('department' in update || 'jobTitle' in update || 'avatarUrl' in update)) return;
  const identity = await tx.scimIdentity.findUnique({
    where: { userId },
    select: { deletedAt: true, connector: { select: { profileFields: true } } },
  });
  if (!identity || identity.deletedAt) return;
  const owned = identity.connector.profileFields;
  if (owned.includes('department')) delete update.department;
  if (owned.includes('title')) delete update.jobTitle;
  if (owned.includes('photos')) delete update.avatarUrl;
  if (!('department' in update || 'jobTitle' in update || 'avatarUrl' in update))
    delete update.lastOidcSync;
}
