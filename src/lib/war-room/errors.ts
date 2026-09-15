export class WarRoomRetryableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
    readonly retryBudgetNeutral = false
  ) {
    super(message);
    this.name = 'WarRoomRetryableError';
  }
}
