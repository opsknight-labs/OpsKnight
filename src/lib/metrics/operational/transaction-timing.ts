import type { TransactionTiming } from '@/lib/db-utils';
import { observeOperationalHistogram } from './registry';

/** Driver intervals are deliberately distinct from PostgreSQL execution time. */
export function observeTransactionTiming(
  domain: 'ingestion_admission' | 'event',
  timing: TransactionTiming
): void {
  observeOperationalHistogram(`opsknight_${domain}_stage_duration_ms`, timing.durationMs, {
    stage: `transaction-${timing.phase}`,
    outcome: timing.outcome,
  });
}
