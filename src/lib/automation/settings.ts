import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

/** Read shared settings directly so an admin disable is visible to every replica. */
export async function getAutomationSettings(client: Prisma.TransactionClient = prisma) {
  const settings = await client.systemSettings.findUnique({
    where: { id: 'default' },
    select: {
      automationEnabled: true,
      automationTraceRetentionDays: true,
      automationSettingsRevision: true,
    },
  });
  return (
    settings ?? {
      automationEnabled: false,
      automationTraceRetentionDays: 90,
      automationSettingsRevision: 0,
    }
  );
}
