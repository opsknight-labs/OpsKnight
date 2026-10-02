/**
 * Environment Variable Validation
 *
 * Ensures critical environment variables are set, especially in production.
 * Provides clear error messages when configuration is missing.
 */

import { logger } from './logger';
import { isWeakKey } from './encryption';

export const KNOWN_PLACEHOLDER_NEXTAUTH_SECRETS = new Set([
  'opsknight_super_secret_jwt_and_session_signing_key_change_in_production_min32chars',
  'change_this_to_a_random_secret_in_production',
  'change_this_to_a_complex_random_secret_in_production_min_32_chars',
  'change_this_in_production_min_32_chars',
  'change_this_in_production',
  'dev-secret-key-for-development-only',
  'changeme_to_a_secure_random_string',
]);

export const KNOWN_PLACEHOLDER_API_KEY_SECRETS = new Set([
  ...KNOWN_PLACEHOLDER_NEXTAUTH_SECRETS,
  'change_this_to_a_separate_random_api_key_secret_in_production',
  'changeme_to_a_different_secure_random_string',
]);

export const KNOWN_PLACEHOLDER_POSTGRES_PASSWORDS = new Set([
  'opsknight_secure_password_change_me',
  'devpassword',
]);

/**
 * Get the base application URL with proper validation
 * Throws an error in production if not configured
 */
export function getBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;

  if (!url) {
    if (process.env.NEXTAUTH_URL) {
      return process.env.NEXTAUTH_URL.replace(/\/$/, '');
    }

    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        'NEXT_PUBLIC_APP_URL environment variable is not set. ' +
          'Using localhost fallback. Set this to your application URL for correct notification links.'
      );
    } else {
      logger.warn('NEXT_PUBLIC_APP_URL not set, using localhost fallback (development only)');
    }

    return 'http://localhost:3000';
  }

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
    return;
  }

  const required: Array<{ name: string; description: string }> = [
    {
      name: 'DATABASE_URL',
      description: 'PostgreSQL connection string',
    },
    {
      name: 'NEXTAUTH_SECRET',
      description: 'Independent signing secret for authentication sessions',
    },
    {
      name: 'API_KEY_SECRET',
      description: 'Independent signing secret for API keys',
    },
  ];

  const _optional: Array<{ name: string; description: string }> = [
    {
      name: 'NEXTAUTH_URL',
      description:
        'Full URL of your application (optional — can be established via bootstrap setup or SystemSettings.appUrl)',
    },
    {
      name: 'PROMETHEUS_SCRAPE_TOKEN',
      description: 'Bearer token for scraping Prometheus metrics endpoint (/api/metrics)',
    },
  ];

  // Safe because 'name' comes from the hardcoded 'required' array above
  // eslint-disable-next-line security/detect-object-injection
  const missing = required.filter(({ name }) => !process.env[name]);

  if (!process.env.ENCRYPTION_KEY && !process.env.ENCRYPTION_KEYS) {
    missing.push({
      name: 'ENCRYPTION_KEY or ENCRYPTION_KEYS',
      description: '32-byte encryption key or versioned encryption keyring',
    });
  }

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

  // Fail-closed validation for known placeholder/insecure secrets in production
  const allowInsecureSecrets =
    process.env.ALLOW_INSECURE_SECRETS === 'true' || process.env.ALLOW_INSECURE_SECRETS === '1';

  if (allowInsecureSecrets) {
    logger.warn(
      '⚠️  ALLOW_INSECURE_SECRETS is enabled. Insecure or placeholder production secrets are permitted. DO NOT USE IN PRODUCTION.'
    );
  } else {
    const insecureSecrets: string[] = [];

    // 1. NEXTAUTH_SECRET placeholder check
    const nextAuthSecret = process.env.NEXTAUTH_SECRET?.trim();
    if (nextAuthSecret) {
      if (KNOWN_PLACEHOLDER_NEXTAUTH_SECRETS.has(nextAuthSecret)) {
        insecureSecrets.push(
          'NEXTAUTH_SECRET uses a known default placeholder. Generate a strong, random secret (min 32 chars).'
        );
      } else if (nextAuthSecret.length < 32) {
        insecureSecrets.push(
          `NEXTAUTH_SECRET is too short (${nextAuthSecret.length} chars). It must be at least 32 characters in production.`
        );
      }
    }

    const apiKeySecret = process.env.API_KEY_SECRET?.trim();
    if (apiKeySecret) {
      if (KNOWN_PLACEHOLDER_API_KEY_SECRETS.has(apiKeySecret)) {
        insecureSecrets.push(
          'API_KEY_SECRET uses a known default placeholder. Generate a separate strong, random secret (min 32 chars).'
        );
      } else if (apiKeySecret.length < 32) {
        insecureSecrets.push(
          `API_KEY_SECRET is too short (${apiKeySecret.length} chars). It must be at least 32 characters in production.`
        );
      } else if (apiKeySecret === nextAuthSecret) {
        insecureSecrets.push(
          'API_KEY_SECRET must be independent from NEXTAUTH_SECRET in production.'
        );
      }
    }

    // 2. ENCRYPTION_KEY / ENCRYPTION_KEYS placeholder check
    const legacyKey = process.env.ENCRYPTION_KEY?.trim();
    if (legacyKey && isWeakKey(legacyKey)) {
      insecureSecrets.push(
        'ENCRYPTION_KEY is a known weak or default placeholder. Provide a unique 64-character hex key.'
      );
    }

    const keyring = process.env.ENCRYPTION_KEYS?.trim();
    if (keyring) {
      for (const rawEntry of keyring.split(',')) {
        const sep = rawEntry.indexOf(':');
        const key = sep > 0 ? rawEntry.slice(sep + 1).trim() : rawEntry.trim();
        if (isWeakKey(key)) {
          const keyId = sep > 0 ? rawEntry.slice(0, sep).trim() : 'entry';
          insecureSecrets.push(
            `ENCRYPTION_KEYS contains a known weak or default placeholder key for "${keyId}".`
          );
        }
      }
    }

    // 3. PostgreSQL password placeholder check
    const postgresPassword = process.env.POSTGRES_PASSWORD?.trim();
    if (postgresPassword && KNOWN_PLACEHOLDER_POSTGRES_PASSWORDS.has(postgresPassword)) {
      insecureSecrets.push(
        'POSTGRES_PASSWORD uses a known default placeholder. Change it in production.'
      );
    }

    const checkDbUrl = (urlStr: string | undefined, label: string) => {
      if (!urlStr) return;
      for (const placeholder of KNOWN_PLACEHOLDER_POSTGRES_PASSWORDS) {
        if (urlStr.includes(`:${placeholder}@`) || urlStr.includes(`:${encodeURIComponent(placeholder)}@`)) {
          insecureSecrets.push(
            `${label} contains the default PostgreSQL password placeholder. Configure a secure database password in production.`
          );
          break;
        }
      }
    };

    checkDbUrl(process.env.DATABASE_URL, 'DATABASE_URL');
    checkDbUrl(process.env.DIRECT_DATABASE_URL, 'DIRECT_DATABASE_URL');

    if (insecureSecrets.length > 0) {
      const errorMessage = [
        '❌ PRODUCTION SECURITY ERROR',
        '',
        'Known insecure or placeholder secrets detected in production configuration:',
        '',
        ...insecureSecrets.map(msg => `  • ${msg}`),
        '',
        'OpsKnight fails closed to protect production deployments.',
        'Replace all placeholder credentials with secure, randomly generated values.',
        'For non-production or evaluation environments, set ALLOW_INSECURE_SECRETS=true to bypass this check.',
        '',
      ].join('\n');

      throw new Error(errorMessage);
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl && !appUrl.startsWith('http')) {
    logger.warn(`NEXT_PUBLIC_APP_URL should start with http:// or https:// (got: ${appUrl})`);
  }

  if (appUrl && appUrl.includes('localhost')) {
    logger.warn(
      '⚠️  NEXT_PUBLIC_APP_URL points to localhost in production. This may cause issues with notifications and webhooks.'
    );
  }

  if (!appUrl) {
    logger.warn(
      '⚠️  NEXT_PUBLIC_APP_URL is not set. Public URL resolution uses the database appUrl first, then NEXTAUTH_URL, then localhost as the final fallback.'
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
