import type { Prisma } from '@prisma/client';

/** Remove preview scalars from durable observation payloads. Legacy unkeyed
 * samples are dropped; their routing aggregates and other job metadata remain.
 */
export async function clearObservationJobPreviews(
  tx: Prisma.TransactionClient,
  logicalKeys?: string[]
) {
  const ids = logicalKeys ?? [];
  await tx.$executeRaw`
    UPDATE "BackgroundJob" AS job SET payload = jsonb_set(job.payload, '{observations}',
      COALESCE((SELECT jsonb_agg(item || '{"value":""}'::jsonb)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(job.payload->'observations') = 'array'
          THEN job.payload->'observations' ELSE '[]'::jsonb END) AS item
        WHERE item->>'valueHash' ~ '^[a-f0-9]{64}$'), '[]'::jsonb))
    WHERE job.type = 'SCHEDULED_TASK'::"JobType"
      AND job.payload->>'task' = 'AUTOMATION_OBSERVE'
      AND (${logicalKeys === undefined} OR job.id = ANY(${ids}::text[]))
  `;
}
