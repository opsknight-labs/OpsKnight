import type { AutomationMode, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

/** One shared MVCC read per incident; no cache can delay the emergency switch. */
export async function getIngestionAutomationConfig(
  client: Prisma.TransactionClient,
  serviceId: string
) {
  const rows = await client.$queryRaw<
    Array<{
      mode: AutomationMode;
      activeVersionId: string | null;
      candidateVersionId: string | null;
    }>
  >`
    SELECT config."mode"::text AS mode, config."activeVersionId", config."candidateVersionId"
    FROM "SystemSettings" AS settings
    JOIN "ServiceAutomationConfig" AS config ON config."serviceId" = ${serviceId}
    WHERE settings.id = 'default' AND settings."automationEnabled" = true
  `;
  return rows[0] ?? null;
}

/** Read shared settings directly so an admin disable is visible to every replica. */
export async function getAutomationSettings(client: Prisma.TransactionClient = prisma) {
  const settings = await client.systemSettings.findUnique({
    where: { id: 'default' },
    select: {
      automationEnabled: true,
      automationTraceRetentionDays: true,
      automationStoreObservationPreviews: true,
      automationSettingsRevision: true,
    },
  });
  return (
    settings ?? {
      automationEnabled: false,
      automationTraceRetentionDays: 90,
      automationStoreObservationPreviews: false,
      automationSettingsRevision: 0,
    }
  );
}
