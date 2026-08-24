/**
 * Encrypted Provider Configuration
 *
 * Handles encryption/decryption of sensitive fields in notification provider configs.
 * API keys, auth tokens, and other secrets are encrypted at rest in the database.
 */

import { encrypt, decrypt, getEncryptionKey } from './encryption';
import { logger } from './logger';

/**
 * Fields that should be encrypted for each provider type
 */
const SENSITIVE_FIELDS: Record<string, string[]> = {
  twilio: ['accountSid', 'authToken', 'whatsappAccountSid', 'whatsappAuthToken'],
  'aws-sns': ['accessKeyId', 'secretAccessKey'],
  'web-push': ['vapidPrivateKey'],
  resend: ['apiKey'],
  sendgrid: ['apiKey'],
  smtp: ['password'],
  ses: ['accessKeyId', 'secretAccessKey'],
};

/**
 * Marker prefix for encrypted values
 */
const ENCRYPTED_PREFIX = 'enc:';

/**
 * Check if a value is already encrypted
 */
function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypt a single value
 */
async function encryptValue(value: string): Promise<string> {
  if (!value || isEncrypted(value)) {
    return value;
  }
  const encrypted = await encrypt(value);
  return ENCRYPTED_PREFIX + encrypted;
}

/**
 * Decrypt a single value
 */
async function decryptValue(value: string): Promise<string> {
  if (!value || !isEncrypted(value)) {
    return value;
  }
  const encryptedPart = value.slice(ENCRYPTED_PREFIX.length);
  return await decrypt(encryptedPart);
}

/**
 * Encrypt sensitive fields in a provider config before storing in database
 *
 * @param provider - The provider type (e.g., 'twilio', 'resend')
 * @param config - The config object with plaintext sensitive fields
 * @returns Config object with sensitive fields encrypted
 */
export async function encryptProviderConfig(
  provider: string,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const sensitiveFields = SENSITIVE_FIELDS[provider] || [];

  // Check if encryption is available
  const key = await getEncryptionKey();
  if (!key) {
    logger.error('Encryption key not configured; refusing to store provider secrets', {
      component: 'encrypted-provider-config',
      provider,
    });
    if (
      sensitiveFields.some(
        field => typeof config[field] === 'string' && String(config[field]).length > 0
      )
    ) {
      throw new Error('Provider secrets cannot be stored because encryption is unavailable.');
    }
    return { ...config };
  }

  const encryptedConfig = { ...config };

  for (const field of sensitiveFields) {
    const value = config[field];
    if (typeof value === 'string' && value.length > 0) {
      try {
        encryptedConfig[field] = await encryptValue(value);
      } catch (error) {
        logger.error('Failed to encrypt provider config field', {
          component: 'encrypted-provider-config',
          provider,
          field,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw new Error(`Failed to encrypt provider config field: ${field}`);
      }
    }
  }

  return encryptedConfig;
}

/**
 * Decrypt sensitive fields in a provider config after retrieving from database
 *
 * @param provider - The provider type (e.g., 'twilio', 'resend')
 * @param config - The config object with encrypted sensitive fields
 * @returns Config object with sensitive fields decrypted
 */
export async function decryptProviderConfig(
  provider: string,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const sensitiveFields = SENSITIVE_FIELDS[provider] || [];

  // Check if encryption is available
  const key = await getEncryptionKey();
  if (!key) {
    // No encryption key - config might be plaintext (legacy) or we can't decrypt
    return config;
  }

  const decryptedConfig = { ...config };

  for (const field of sensitiveFields) {
    const value = config[field];
    if (typeof value === 'string' && isEncrypted(value)) {
      try {
        decryptedConfig[field] = await decryptValue(value);
      } catch (error) {
        logger.error('Failed to decrypt provider config field', {
          component: 'encrypted-provider-config',
          provider,
          field,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Return empty string on decryption failure to avoid exposing encrypted data
        decryptedConfig[field] = '';
      }
    }
  }

  return decryptedConfig;
}

/**
 * Check if a config has any encrypted fields
 */
export function hasEncryptedFields(provider: string, config: Record<string, unknown>): boolean {
  const sensitiveFields = SENSITIVE_FIELDS[provider] || [];

  for (const field of sensitiveFields) {
    const value = config[field];
    if (typeof value === 'string' && isEncrypted(value)) {
      return true;
    }
  }

  return false;
}

/**
 * Mask sensitive fields for safe logging/display
 * Returns the config with sensitive fields replaced with "***"
 */
export function maskSensitiveFields(
  provider: string,
  config: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveFields = SENSITIVE_FIELDS[provider] || [];
  const maskedConfig = { ...config };

  for (const field of sensitiveFields) {
    const value = config[field];
    if (typeof value === 'string' && value.length > 0) {
      // Show first 4 chars if long enough, otherwise just mask
      maskedConfig[field] = value.length > 8 ? value.slice(0, 4) + '***' : '***';
    }
  }

  return maskedConfig;
}
