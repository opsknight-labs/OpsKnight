import { ingestionConfig } from './config';
import { ingestionErrorResponse } from './http';
import { IngestionUnavailableError } from './contract';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { AsyncLocalStorage } from 'node:async_hooks';

export function ingestionBodyReadTimeoutMs(): number | undefined {
  return globalThis.opsknightIngestionRequestBodyContext?.getStore() ? 5000 : undefined;
}

declare global {
  var opsknightIngestionRequestGate: { active: number } | undefined;
  var opsknightIngestionRequestBodyContext: AsyncLocalStorage<boolean> | undefined;
}

/** Bound requests before authentication/body/Prisma work queues up locally.
 * Shared across route bundles in one process; this is not a distributed quota.
 * Never race an active operation with a timeout: it may already be committing.
 */
export async function withIngestionRequestSlot<T extends Response>(
  operation: () => Promise<T>
): Promise<T | Response> {
  const config = ingestionConfig();
  if (config.mode !== 'postgres') return operation();
  const state = (globalThis.opsknightIngestionRequestGate ??= { active: 0 });
  if (state.active >= config.maxInFlightRequests) {
    addOperationalMetric('opsknight_ingestion_request_overload_total', 1);
    return ingestionErrorResponse(new IngestionUnavailableError('Local ingestion saturated'))!;
  }
  state.active += 1;
  try {
    const context = (globalThis.opsknightIngestionRequestBodyContext ??=
      new AsyncLocalStorage<boolean>());
    return await context.run(true, operation);
  } finally {
    state.active -= 1;
  }
}
