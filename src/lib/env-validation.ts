/**
 * Environment Variable Validation
 *
 * Ensures critical environment variables are set, especially in production.
 * Provides clear error messages when configuration is missing.
 */

import { logger } from './logger';

/**
 * Get the base application URL with proper validation
 * Throws an error in production if not configured
 */
export function getBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;

  if (!url) {
    // Fallback to NEXTAUTH_URL if available
    if (process.env.NEXTAUTH_URL) {
      return process.env.NEXTAUTH_URL.replace(/\/$/, '');
    }

    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        'NEXT_PUBLIC_APP_URL environment variable is not set. ' +
          'Using localhost fallback. Set this to your application URL for correct notification links.'
      );
    } else {
      // Development fallback
      logger.warn('NEXT_PUBLIC_APP_URL not set, using localhost fallback (development only)');
    }

    return 'http://localhost:3000';
  }

  // Remove trailing slash for consistency
  return url.replace(/\/$/, '');
}

/**
 * Validate required environment variables for production
 * Call this early in application startup
 */
export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production' || process.env.SKIP_ENV_VALIDATION) {
    if (process.env.SKIP_ENV_VALIDATION) {
      logger.warn('⚠️  Skipping environment validation due to SKIP_ENV_VALIDATION flag');
    }
    return; // Skip validation
  }

  const required: Array<{ name: string; description: string }> = [
    {
      name: 'DATABASE_URL',
      description: 'PostgreSQL connection string',
    },
    // NEXTAUTH_SECRET is now auto-generated - no longer required in env
    {
      name: 'NEXTAUTH_URL',
      description: 'Full URL of your application (e.g., https://OpsKnight.yourdomain.com)',
    },
  ];

  // Optional environment variables for reference and documentation
  const _optional: Array<{ name: string; description: string }> = [
    {
      name: 'PROMETHEUS_SCRAPE_TOKEN',
      description: 'Bearer token for scraping Prometheus metrics endpoint (/api/metrics)',
    },
  ];

  // Safe because 'name' comes from the hardcoded 'required' array above
  // eslint-disable-next-line security/detect-object-injection
  const missing = required.filter(({ name }) => !process.env[name]);

  if (missing.length > 0) {
    const errorMessage = [
      '❌ PRODUCTION CONFIGURATION ERROR',
      '',
      'Missing required environment variables:',
      '',
      ...missing.map(({ name, description }) => `  • ${name}\n    ${description}`),
      '',
      'Please set these in your .env file or deployment configuration.',
      'See env.example for reference.',
      '',
    ].join('\n');

    throw new Error(errorMessage);
  }

  // Validate NEXT_PUBLIC_APP_URL format if present
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl && !appUrl.startsWith('http')) {
    logger.warn(`NEXT_PUBLIC_APP_URL should start with http:// or https:// (got: ${appUrl})`);
  }

  // Warn about localhost in production
  if (appUrl && appUrl.includes('localhost')) {
    logger.warn(
      '⚠️  NEXT_PUBLIC_APP_URL points to localhost in production. This may cause issues with notifications and webhooks.'
    );
  }

  if (!appUrl) {
    logger.warn(
      '⚠️  NEXT_PUBLIC_APP_URL is not set. The application will attempt to use the database configuration or request headers.'
    );
  }

  logger.info('✅ Production environment variables validated');
}

/**
 * Get notification from email with fallback
 */
export function getFromEmail(): string {
  const fromEmail = process.env.EMAIL_FROM;

  if (fromEmail) {
    return fromEmail;
  }

  // Generate from domain
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    const domain = appUrl.replace(/^https?:\/\//, '').split('/')[0];
    return `noreply@${domain}`;
  }

  if (process.env.NODE_ENV === 'production') {
    logger.warn('EMAIL_FROM not set and cannot derive from NEXT_PUBLIC_APP_URL. Using default.');
  }

  return 'noreply@OpsKnight.local';
}
