import type { Prisma } from '@prisma/client';
import {
  ingestionAutomationConfigsFromRows,
  ingestionAutomationConfigsQuery,
  type IngestionAutomationConfigRow,
} from '@/lib/automation/settings';
import { parseIngestionPolicy } from './policy';
import { IngestionUnavailableError } from './contract';

/** One authoritative statement for admission control and pinned Automation.
 * The caller owns the receipt transaction. No process cache or policy snapshot
 * survives a retry; workspace disable and service version pointers share MVCC.
 */
export async function readIngestionAdmissionSettings(
  tx: Prisma.TransactionClient,
  serviceIds: string[]
) {
  const ids = [...new Set(serviceIds)];
  if (!ids.length || ids.length > 32) throw new Error('Invalid admission service count');
  const [row] = await tx.$queryRaw<Array<{
    control: Prisma.JsonValue | null;
    automation: IngestionAutomationConfigRow[];
  }>>`
    SELECT (SELECT value FROM "SystemConfig" WHERE key = 'ingestion_control') AS control,
      (SELECT COALESCE(jsonb_agg(to_jsonb(config)), '[]'::jsonb)
        FROM (${ingestionAutomationConfigsQuery(ids)}) config) AS automation
  `;
  if (!row) throw new IngestionUnavailableError('Ingestion admission settings unavailable');
  return {
    ...parseIngestionPolicy(row.control),
    automation: ingestionAutomationConfigsFromRows(row.automation),
  };
}
