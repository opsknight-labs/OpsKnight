/**
 * Sentry Error Tracking Integration (Optional)
 *
 * Provides optional Sentry integration for error tracking.
 * Only active when SENTRY_DSN environment variable is set.
 *
 * To enable:
 * 1. Install Sentry: npm install @sentry/nextjs
 * 2. Set environment variable: SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
 * 3. Optionally set: SENTRY_ENVIRONMENT=production
 */

import { logger } from '@/lib/logger';

// Sentry types (we don't import Sentry directly to keep it optional)
interface SentryScope {
  setTag: (key: string, value: string) => void;
  setContext: (name: string, context: Record<string, unknown>) => void;
  setUser: (user: { id?: string; email?: string; username?: string } | null) => void;
}

interface SentryHub {
  captureException: (error: unknown, options?: { contexts?: Record<string, unknown> }) => string;
  captureMessage: (
    message: string,
    level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug'
  ) => string;
  configureScope: (callback: (scope: SentryScope) => void) => void;
}

let sentryHub: SentryHub | null = null;
let initializationAttempted = false;

/**
 * Check if Sentry is configured and available
 */
export function isSentryEnabled(): boolean {
  return !!process.env.SENTRY_DSN;
}

/**
 * Initialize Sentry (called once on first use)
 */
async function initializeSentry(): Promise<SentryHub | null> {
  if (initializationAttempted) {
    return sentryHub;
  }

  initializationAttempted = true;

  if (!process.env.SENTRY_DSN) {
    return null;
  }

  try {
    // Dynamic import to keep Sentry optional
    // @ts-expect-error - Sentry is an optional dependency
    const Sentry = await import(/* webpackIgnore: true */ '@sentry/nextjs');

    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      // Performance monitoring (optional)
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      // Only send errors in production by default
      enabled: process.env.NODE_ENV === 'production' || process.env.SENTRY_FORCE_ENABLE === 'true',
      // Don't send personal data by default
      sendDefaultPii: false,
      // Ignore common non-actionable errors
      ignoreErrors: [
        // Browser extension errors
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        // Network errors
        'Failed to fetch',
        'NetworkError',
        'AbortError',
        // User-caused navigation
        'Navigation cancelled',
      ],
    });

    sentryHub = Sentry as unknown as SentryHub;

    logger.info('Sentry error tracking initialized', {
      component: 'sentry',
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    });

    return sentryHub;
  } catch (error) {
    // Sentry package not installed - this is expected
    logger.debug('Sentry package not installed, error tracking disabled', {
      component: 'sentry',
    });
    return null;
  }
}

/**
 * Capture an exception to Sentry
 *
 * @param error - The error to capture
 * @param context - Additional context to attach to the error
 * @returns The Sentry event ID if sent, or null
 */
export async function captureException(
  error: unknown,
  context?: {
    component?: string;
    userId?: string;
    extra?: Record<string, unknown>;
    tags?: Record<string, string>;
  }
): Promise<string | null> {
  // Always log locally
  logger.error('Error captured', {
    component: context?.component || 'unknown',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...context?.extra,
  });

  const hub = await initializeSentry();
  if (!hub) {
    return null;
  }

  try {
    // Configure scope with context
    hub.configureScope((scope: SentryScope) => {
      if (context?.component) {
        scope.setTag('component', context.component);
      }
      if (context?.userId) {
        scope.setUser({ id: context.userId });
      }
      if (context?.tags) {
        Object.entries(context.tags).forEach(([key, value]) => {
          scope.setTag(key, value);
        });
      }
      if (context?.extra) {
        scope.setContext('extra', context.extra);
      }
    });

    return hub.captureException(error);
  } catch (sentryError) {
    logger.warn('Failed to send error to Sentry', {
      component: 'sentry',
      error: sentryError instanceof Error ? sentryError.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Capture a message to Sentry
 *
 * @param message - The message to capture
 * @param level - The severity level
 * @param context - Additional context
 * @returns The Sentry event ID if sent, or null
 */
export async function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
  context?: {
    component?: string;
    extra?: Record<string, unknown>;
  }
): Promise<string | null> {
  const hub = await initializeSentry();
  if (!hub) {
    return null;
  }

  try {
    hub.configureScope((scope: SentryScope) => {
      if (context?.component) {
        scope.setTag('component', context.component);
      }
      if (context?.extra) {
        scope.setContext('extra', context.extra);
      }
    });

    return hub.captureMessage(message, level);
  } catch (sentryError) {
    logger.warn('Failed to send message to Sentry', {
      component: 'sentry',
      error: sentryError instanceof Error ? sentryError.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Set user context for Sentry
 *
 * @param user - User information or null to clear
 */
export async function setUser(
  user: { id: string; email?: string; name?: string } | null
): Promise<void> {
  const hub = await initializeSentry();
  if (!hub) {
    return;
  }

  try {
    hub.configureScope((scope: SentryScope) => {
      if (user) {
        scope.setUser({
          id: user.id,
          email: user.email,
          username: user.name,
        });
      } else {
        scope.setUser(null);
      }
    });
  } catch {
    // Ignore errors setting user
  }
}
