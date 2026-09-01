/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascade failures when external services (email, SMS, webhooks) are slow or down.
 * Instead of retrying forever, the circuit "opens" after too many failures,
 * allowing the system to fail fast and recover gracefully.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Circuit is tripped, requests fail immediately
 * - HALF_OPEN: Testing if service has recovered
 *
 * Usage:
 *   const emailBreaker = getCircuitBreaker('email');
 *   const result = await emailBreaker.execute(() => sendEmail(...));
 */

import { logger } from './logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting recovery */
  resetTimeout: number;
  /** Number of successful calls to close circuit from half-open */
  successThreshold: number;
  /** Request timeout in ms */
  timeout: number;
  /** Name for logging */
  name: string;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  lastAttemptTime: number;
  halfOpenRequestInFlight?: boolean;
}

const DEFAULT_CONFIG: Omit<CircuitBreakerConfig, 'name'> = {
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  successThreshold: 2,
  timeout: 10000, // 10 seconds
};

// Store circuit breakers by service name
const breakers = new Map<string, CircuitBreaker>();

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitBreakerState;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
    this.state = {
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      lastAttemptTime: 0,
      halfOpenRequestInFlight: false,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state.state === 'OPEN') {
      const now = Date.now();
      if (now - this.state.lastFailureTime >= this.config.resetTimeout) {
        this.state.state = 'HALF_OPEN';
        this.state.successes = 0;
        this.state.halfOpenRequestInFlight = false;
        logger.info(`[CircuitBreaker:${this.config.name}] Transitioning to HALF_OPEN`);
      } else {
        // Circuit is open, fail fast
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.config.name}`,
          this.config.name
        );
      }
    }

    if (this.state.state === 'HALF_OPEN') {
      if (this.state.halfOpenRequestInFlight) {
        throw new CircuitBreakerError(
          `Circuit breaker is HALF_OPEN (test in flight) for ${this.config.name}`,
          this.config.name
        );
      }
      this.state.halfOpenRequestInFlight = true;
    }

    this.state.lastAttemptTime = Date.now();

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Execute function with timeout wrapper
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);

      fn()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    if (this.state.state === 'HALF_OPEN') {
      this.state.halfOpenRequestInFlight = false;
      this.state.successes++;
      if (this.state.successes >= this.config.successThreshold) {
        this.state.state = 'CLOSED';
        this.state.failures = 0;
        this.state.successes = 0;
        logger.info(`[CircuitBreaker:${this.config.name}] Circuit CLOSED (recovered)`);
      }
    } else {
      // Reset failure count on success in CLOSED state
      this.state.failures = 0;
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: unknown): void {
    const now = Date.now();
    const failureWindow = 60000; // 1-minute sliding failure window
    if (
      this.state.state === 'CLOSED' &&
      this.state.lastFailureTime > 0 &&
      now - this.state.lastFailureTime > failureWindow
    ) {
      this.state.failures = 0;
    }

    this.state.failures++;
    this.state.lastFailureTime = now;

    const errorMessage = error instanceof Error ? error.message : String(error);

    if (this.state.state === 'HALF_OPEN') {
      this.state.halfOpenRequestInFlight = false;
      // Any failure in HALF_OPEN immediately opens the circuit
      this.state.state = 'OPEN';
      logger.warn(`[CircuitBreaker:${this.config.name}] Circuit OPENED (failed in HALF_OPEN)`, {
        error: errorMessage,
      });
    } else if (this.state.failures >= this.config.failureThreshold) {
      this.state.state = 'OPEN';
      logger.warn(`[CircuitBreaker:${this.config.name}] Circuit OPENED (threshold reached)`, {
        failures: this.state.failures,
        threshold: this.config.failureThreshold,
        error: errorMessage,
      });
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state.state;
  }

  /**
   * Get circuit statistics
   */
  getStats(): {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number;
  } {
    return {
      state: this.state.state,
      failures: this.state.failures,
      successes: this.state.successes,
      lastFailureTime: this.state.lastFailureTime,
    };
  }

  /**
   * Manually reset the circuit (for testing or admin override)
   */
  reset(): void {
    this.state = {
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      lastAttemptTime: 0,
      halfOpenRequestInFlight: false,
    };
    logger.info(`[CircuitBreaker:${this.config.name}] Circuit manually reset`);
  }

  /**
   * Check if circuit allows requests
   */
  isAvailable(): boolean {
    if (this.state.state === 'CLOSED') return true;
    if (this.state.state === 'OPEN') {
      const now = Date.now();
      return now - this.state.lastFailureTime >= this.config.resetTimeout;
    }
    return !this.state.halfOpenRequestInFlight;
  }
}

/**
 * Custom error for circuit breaker failures
 */
export class CircuitBreakerError extends Error {
  public readonly serviceName: string;

  constructor(message: string, serviceName: string) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.serviceName = serviceName;
  }
}

/**
 * Get or create a circuit breaker for a service
 */
export function getCircuitBreaker(
  serviceName: string,
  config?: Partial<Omit<CircuitBreakerConfig, 'name'>>
): CircuitBreaker {
  if (!breakers.has(serviceName)) {
    breakers.set(
      serviceName,
      new CircuitBreaker({
        ...DEFAULT_CONFIG,
        ...config,
        name: serviceName,
      })
    );
  }
  return breakers.get(serviceName)!;
}

/**
 * Pre-configured circuit breakers for common services
 */
export const CircuitBreakers = {
  email: () =>
    getCircuitBreaker('email', {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      timeout: 15000, // 15 seconds for email
    }),

  sms: () =>
    getCircuitBreaker('sms', {
      failureThreshold: 3,
      resetTimeout: 30000, // 30 seconds
      timeout: 10000, // 10 seconds for SMS
    }),

  slack: () =>
    getCircuitBreaker('slack', {
      failureThreshold: 5,
      resetTimeout: 30000,
      timeout: 10000,
    }),

  webhook: (url: string) => {
    let host = 'generic';
    try {
      host = new URL(url).hostname;
    } catch {
      host = 'invalid-url';
    }
    const key = `webhook:${host}`;
    if (breakers.size > 200 && !breakers.has(key)) {
      const firstKey = breakers.keys().next().value;
      if (firstKey && firstKey.startsWith('webhook:')) {
        breakers.delete(firstKey);
      }
    }
    return getCircuitBreaker(key, {
      failureThreshold: 3,
      resetTimeout: 60000, // 1 minute
      timeout: 10000,
    });
  },

  push: () =>
    getCircuitBreaker('push', {
      failureThreshold: 10, // Push can have many transient failures
      resetTimeout: 30000,
      timeout: 5000, // 5 seconds for push
    }),

  whatsapp: () =>
    getCircuitBreaker('whatsapp', {
      failureThreshold: 3,
      resetTimeout: 30000,
      timeout: 10000,
    }),
};

/**
 * Get all circuit breaker statuses
 */
export function getAllCircuitStats(): Record<
  string,
  { state: CircuitState; failures: number; successes: number }
> {
  const stats: Record<string, { state: CircuitState; failures: number; successes: number }> = {};

  for (const [name, breaker] of breakers) {
    const s = breaker.getStats();
    stats[name] = {
      state: s.state,
      failures: s.failures,
      successes: s.successes,
    };
  }

  return stats;
}

/**
 * Reset all circuit breakers (for testing)
 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of breakers.values()) {
    breaker.reset();
  }
}
