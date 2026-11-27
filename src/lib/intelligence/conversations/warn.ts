import { logger } from '@/lib/logger';

/**
 * For fire-and-forget work whose failure must not break the request but must not vanish either: an answer
 * that could not be started or recorded would otherwise leave nothing for an operator to find.
 */
export const warnAndContinue =
  (what: string) =>
  (error: unknown): undefined => {
    logger.warn(`[Squire] ${what}`, {
      error: error instanceof Error ? error.name : 'error',
    });
    return undefined;
  };
