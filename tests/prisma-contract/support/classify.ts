import { mapDatabaseError } from '@/lib/api-v2/database-errors';
import { isRetryableTransactionError } from '@/lib/db-utils';
import { escalationOutcomeForError } from '@/lib/escalation/types';
import { isAppError } from '@/lib/errors';
import { postgresSqlState } from '@/lib/postgres-error';
import { getPrismaErrorInfo } from '@/lib/prisma-errors';

/**
 * Application-visible interpretation of a database failure. These outputs drive retries,
 * HTTP status codes and escalation outcomes, so they must not change across upgrades.
 */
export function classify(error: unknown) {
  const mapped = mapDatabaseError(error);
  const info = getPrismaErrorInfo(error);
  return {
    sqlState: postgresSqlState(error),
    retryable: isRetryableTransactionError(error),
    httpMapping: isAppError(mapped) ? mapped.code : 'unmapped',
    escalation: escalationOutcomeForError(error),
    uniqueFields: info?.code === 'P2002' ? [...info.fields].sort() : null,
  };
}

export async function outcome<T>(
  run: () => Promise<T>,
  onSuccess: (value: T) => unknown = () => 'ok'
): Promise<unknown> {
  try {
    return { ok: true, value: onSuccess(await run()) };
  } catch (error) {
    return { ok: false, error: classify(error) };
  }
}
