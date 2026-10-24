// Symbol branding cannot be supplied by JSON input and survives server bundles.
const retryTransaction = Symbol.for('opsknight.transaction.retry');

/** Request a bounded retry only after the transaction has rolled back. */
export function markTransactionRetry<T extends Error>(error: T): T {
  Object.defineProperty(error, retryTransaction, { value: true });
  return error;
}

export function isExplicitTransactionRetry(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, retryTransaction) === true;
}
