/**
 * Retry utility for external API calls
 * Provides configurable retry logic with exponential backoff and circuit breaker pattern
 */

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: unknown;
  attempts: number;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryableErrors' | 'onRetry'>> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

const DEFAULT_RETRYABLE_ERRORS = (_error: unknown): boolean => {
  // Retry by default unless a specific retryableErrors filter is provided
  return true;
};

/**
 * Filter for network and 5xx/429 status codes without matching unrelated digit 5 errors
 */
export const isRetryableApiError = (error: unknown): boolean => {
  if (error instanceof Error) {
    if (
      error.message.includes('fetch') ||
      error.message.includes('network') ||
      error.message.includes('ECONNRESET')
    ) {
      return true;
    }
    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      return true;
    }
    if (
      /\b5\d{2}\b/.test(error.message) ||
      error.message.includes('HTTP 5') ||
      error.message.includes('429')
    ) {
      return true;
    }
    return false;
  }
  return false;
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay for retry attempt with Full Jitter exponential backoff
 */
function calculateDelay(
  attempt: number,
  options: Required<Omit<RetryOptions, 'retryableErrors' | 'onRetry'>>
): number {
  const maxDelayForAttempt = Math.min(
    options.maxDelayMs,
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1)
  );
  // Full Jitter (AWS Architecture): uniform random between 0 and maxDelayForAttempt
  return Math.floor(Math.random() * maxDelayForAttempt);
}

/**
 * Retry a function with exponential backoff
 *
 * @example
 * const result = await retry(() => fetch('https://api.example.com'), {
 *   maxAttempts: 3,
 *   initialDelayMs: 1000
 * });
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const retryableErrors = options.retryableErrors || DEFAULT_RETRYABLE_ERRORS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    try {
      const data = await fn();
      return {
        success: true,
        data,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (!retryableErrors(error)) {
        return {
          success: false,
          error,
          attempts: attempt,
        };
      }

      // Don't retry on last attempt
      if (attempt < opts.maxAttempts) {
        const delay = calculateDelay(attempt, opts);

        // Call onRetry callback if provided
        if (options.onRetry) {
          options.onRetry(attempt, error);
        }

        if (!(error as any)?.retryAfterHandled) {
          await sleep(delay);
        }
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: opts.maxAttempts,
  };
}

/**
 * Check if an HTTP response indicates a retryable error
 */
export function isRetryableHttpError(status: number): boolean {
  // Retry on server errors (5xx) and rate limiting (429)
  return status >= 500 || status === 429;
}

/**
 * Retry HTTP fetch calls with proper error handling
 *
 * @example
 * const result = await retryFetch('https://api.example.com', {
 *   method: 'POST',
 *   body: JSON.stringify(data)
 * });
 */
export async function retryFetch(
  url: string,
  options: RequestInit = {},
  retryOptions?: RetryOptions
): Promise<Response> {
  const result = await retry(async () => {
    const response = await fetch(url, options);

    // Check if response status is retryable
    if (!response.ok && isRetryableHttpError(response.status)) {
      const retryAfter = response.headers?.get ? response.headers.get('Retry-After') : null;
      let retryAfterMs: number | undefined;
      if (response.status === 429 && retryAfter) {
        let waitMs = 0;
        const seconds = parseInt(retryAfter, 10);
        if (!isNaN(seconds) && seconds > 0) {
          waitMs = seconds * 1000;
        } else {
          // Check if it's an HTTP-Date format (RFC 7231)
          const targetTime = new Date(retryAfter).getTime();
          if (!isNaN(targetTime)) {
            waitMs = Math.max(0, targetTime - Date.now());
          }
        }
        if (waitMs > 0) {
          retryAfterMs = waitMs;
          if ((retryOptions?.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts) > 1) {
            await sleep(Math.min(waitMs, 60000));
          }
        }
      }
      const err = new Error(`HTTP ${response.status}: ${response.statusText || 'Error'}`) as Error & {
        statusCode?: number;
        retryAfterHandled?: boolean;
        retryAfterMs?: number;
      };
      err.statusCode = response.status;
      err.retryAfterMs = retryAfterMs;
      if (response.status === 429 && retryAfter) {
        err.retryAfterHandled = true;
      }
      throw err;
    }

    return response;
  }, retryOptions);

  if (!result.success) {
    throw result.error || new Error('Request failed after retries');
  }

  return result.data!;
}

/**
 * Simple retry wrapper for common async operations
 * Returns the value directly or throws the last error
 */
export async function retryWithThrow<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const result = await retry(fn, options);

  if (!result.success) {
    throw result.error || new Error('Operation failed after retries');
  }

  return result.data!;
}
