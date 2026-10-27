import { AsyncLocalStorage } from 'node:async_hooks';
import type { IngestionRateLimitError } from './contract';

export const ingestionDeliveries = new AsyncLocalStorage<{
  key?: string;
  ordinal: number;
  replayOnly?: IngestionRateLimitError;
  replayed: number;
}>();

export function assertNewIngestionWorkAllowed(): void {
  const denied = ingestionDeliveries.getStore()?.replayOnly;
  if (denied) throw denied;
}
