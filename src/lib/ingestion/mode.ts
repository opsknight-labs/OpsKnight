export type IngestionMode = 'sync' | 'postgres';

/** Image upgrades enable durable ingestion without a customer environment flag.
 * Explicit sync remains a temporary operational rollback override.
 */
export function resolveIngestionMode(value: string | undefined): IngestionMode {
  if (value === undefined) return 'postgres';
  if (value === 'sync' || value === 'postgres') return value;
  throw new Error('Invalid ingestion mode');
}
