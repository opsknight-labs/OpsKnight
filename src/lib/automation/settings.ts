import {
  automationReadinessPolicySchema,
  DEFAULT_AUTOMATION_READINESS_POLICY,
} from './readiness-policy';
import { Prisma, type AutomationMode } from '@prisma/client';
import prisma from '@/lib/prisma';

export type IngestionAutomationConfigRow = {
  serviceId: string;
  mode: AutomationMode;
  activeVersionId: string | null;
  candidateVersionId: string | null;
};

/** Fixed shared query, including the live workspace emergency switch. */
export function ingestionAutomationConfigsQuery(serviceIds: string[]) {
  return Prisma.sql`
    SELECT config."serviceId", config."mode"::text AS mode,
      config."activeVersionId", config."candidateVersionId"
    FROM "SystemSettings" AS settings
    JOIN "ServiceAutomationConfig" AS config ON config."serviceId" = ANY(${serviceIds}::text[])
    WHERE settings.id = 'default' AND settings."automationEnabled" = true
  `;
}

export function ingestionAutomationConfigsFromRows(rows: IngestionAutomationConfigRow[]) {
  return new Map(rows.map(({ serviceId, ...config }) => [serviceId, config]));
}

/** One shared MVCC read per incident; no cache can delay the emergency switch. */
export async function getIngestionAutomationConfigs(
  client: Prisma.TransactionClient,
  serviceIds: string[]
) {
  return ingestionAutomationConfigsFromRows(
    await client.$queryRaw<IngestionAutomationConfigRow[]>(ingestionAutomationConfigsQuery(serviceIds))
  );
}

export async function getIngestionAutomationConfig(
  client: Prisma.TransactionClient,
  serviceId: string
) {
  return (await getIngestionAutomationConfigs(client, [serviceId])).get(serviceId) ?? null;
}

/** Read shared settings directly so an admin disable is visible to every replica. */
export async function getAutomationSettings(client: Prisma.TransactionClient = prisma) {
  const settings = await client.systemSettings.findUnique({
    where: { id: 'default' },
    select: {
      automationEnabled: true,
      automationTraceRetentionDays: true,
      automationStoreObservationPreviews: true,
      automationReadinessPolicy: true,
      automationSettingsRevision: true,
    },
  });
  const policy = automationReadinessPolicySchema.safeParse(
    settings?.automationReadinessPolicy ?? DEFAULT_AUTOMATION_READINESS_POLICY
  );
  return {
    ...(settings ?? {
      automationEnabled: false,
      automationTraceRetentionDays: 90,
      automationStoreObservationPreviews: false,
      automationSettingsRevision: 0,
    }),
    // Malformed manual database writes must not interrupt LIVE ingestion. Candidate
    // activation separately fails closed until an administrator repairs the policy.
    automationReadinessPolicy: policy.success ? policy.data : DEFAULT_AUTOMATION_READINESS_POLICY,
    automationReadinessPolicyValid: policy.success,
  };
}
