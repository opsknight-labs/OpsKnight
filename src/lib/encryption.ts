/**
 * Encryption utilities for sensitive data
 * Uses authenticated AES-256-GCM envelope encryption (v3).
 *
 * Key resolution order:
 *  1. First key in ENCRYPTION_KEYS (for example `k2:hex,k1:hex`)
 *  2. ENCRYPTION_KEY environment variable (legacy single-key deployments)
 *  3. Static development fallback key (development only)
 */

import crypto from 'crypto';
import { logger } from './logger';

// Stable, well-known fallback key for local development only.
// This is intentionally public knowledge — it is NOT a secret.
const DEV_FALLBACK_KEY = '0000000000000000000000000000000000000000000000000000000000000000';

function isValidHexKey(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function isWeakKey(value: string): boolean {
  return /^0{64}$/i.test(value) || /^([0-9a-f])\1{63}$/i.test(value);
}

type EncryptionKeyEntry = { id: string; key: string };

function getEncryptionKeyring(): EncryptionKeyEntry[] {
  const entries: EncryptionKeyEntry[] = [];
  const configuredKeyring = process.env.ENCRYPTION_KEYS?.trim();

  if (configuredKeyring) {
    for (const rawEntry of configuredKeyring.split(',')) {
      const separator = rawEntry.indexOf(':');
      const id = rawEntry.slice(0, separator).trim();
      const key = rawEntry.slice(separator + 1).trim();
      if (
        separator <= 0 ||
        !/^[A-Za-z0-9._-]{1,64}$/.test(id) ||
        !isValidHexKey(key) ||
        (process.env.NODE_ENV === 'production' && isWeakKey(key))
      ) {
        logger.error('[Encryption] ENCRYPTION_KEYS contains an invalid or weak key entry.');
        return [];
      }
      if (entries.some(entry => entry.id === id)) {
        logger.error('[Encryption] ENCRYPTION_KEYS contains a duplicate key ID.');
        return [];
      }
      entries.push({ id, key });
    }
  }

  const legacyKey = process.env.ENCRYPTION_KEY?.trim();
  if (legacyKey) {
    if (
      !isValidHexKey(legacyKey) ||
      (process.env.NODE_ENV === 'production' && isWeakKey(legacyKey))
    ) {
      logger.error(
        '[Encryption] ENCRYPTION_KEY is invalid or uses a known weak value. Encryption disabled.'
      );
      return [];
    }
    if (!entries.some(entry => entry.key === legacyKey)) {
      const legacyId = entries.some(entry => entry.id === 'k1') ? 'legacy' : 'k1';
      entries.push({ id: legacyId, key: legacyKey });
    }
  }

  if (entries.length === 0 && process.env.NODE_ENV === 'development') {
    logger.warn(
      '[Encryption] Encryption keys not set. Using development fallback key. DO NOT use this in production.'
    );
    entries.push({ id: 'dev', key: DEV_FALLBACK_KEY });
  }

  return entries;
}

/**
 * Resolve the active encryption key.
 * Returns null only in production when ENCRYPTION_KEY is not set.
 */
export function getEncryptionKey(): string | null {
  const active = getEncryptionKeyring()[0];
  if (active) return active.key;
  logger.error('[Encryption] No valid encryption key is configured.');
  return null;
}

/**
 * Encrypt text using AES-256-GCM envelope encryption (v3 format).
 */
export async function encryptWithKey(
  text: string,
  keyHex: string,
  keyId: string = 'k1'
): Promise<string> {
  const algorithm = 'aes-256-gcm';
  if (!keyHex || !isValidHexKey(keyHex)) {
    throw new Error('Invalid encryption key provided');
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) {
    throw new Error('Invalid encryption key ID');
  }

  // 1. Generate Data Encryption Key (DEK)
  const dek = crypto.randomBytes(32);

  // 2. Encrypt payload with DEK
  const payloadIv = crypto.randomBytes(12);
  const payloadCipher = crypto.createCipheriv(algorithm, dek, payloadIv);
  payloadCipher.setAAD(Buffer.from(`opsknight:v3:${keyId}:payload`, 'utf8'));
  const encryptedPayload = Buffer.concat([
    payloadCipher.update(text, 'utf8'),
    payloadCipher.final(),
  ]);
  const payloadAuthTag = payloadCipher.getAuthTag();

  // 3. Encrypt DEK with master key
  const masterKey = Buffer.from(keyHex, 'hex');
  const dekIv = crypto.randomBytes(12);
  const dekCipher = crypto.createCipheriv(algorithm, masterKey, dekIv);
  dekCipher.setAAD(Buffer.from(`opsknight:v3:${keyId}:dek`, 'utf8'));
  const encryptedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const dekAuthTag = dekCipher.getAuthTag();

  // v3:kid:dekIv:encryptedDek:dekTag:payloadIv:encryptedPayload:payloadTag
  return [
    'v3',
    keyId,
    dekIv.toString('hex'),
    encryptedDek.toString('hex'),
    dekAuthTag.toString('hex'),
    payloadIv.toString('hex'),
    encryptedPayload.toString('hex'),
    payloadAuthTag.toString('hex'),
  ].join(':');
}

/**
 * Decrypt ciphertext. Supports authenticated v3 plus legacy v1/v2 CBC data.
 */
export async function decryptWithKey(encryptedText: string, keyHex: string): Promise<string> {
  if (!keyHex || !isValidHexKey(keyHex)) {
    throw new Error('Invalid encryption key provided');
  }
  const masterKey = Buffer.from(keyHex, 'hex');

  if (encryptedText.startsWith('v3:')) {
    const parts = encryptedText.split(':');
    if (parts.length !== 8 || !/^[A-Za-z0-9._-]{1,64}$/.test(parts[1])) {
      throw new Error('Invalid v3 encrypted text format');
    }
    const [, keyId, dekIvHex, encryptedDekHex, dekTagHex, payloadIvHex, payloadHex, payloadTagHex] =
      parts;
    const dekDecipher = crypto.createDecipheriv(
      'aes-256-gcm',
      masterKey,
      Buffer.from(dekIvHex, 'hex')
    );
    dekDecipher.setAAD(Buffer.from(`opsknight:v3:${keyId}:dek`, 'utf8'));
    dekDecipher.setAuthTag(Buffer.from(dekTagHex, 'hex'));
    const dek = Buffer.concat([
      dekDecipher.update(Buffer.from(encryptedDekHex, 'hex')),
      dekDecipher.final(),
    ]);
    if (dek.length !== 32) throw new Error('Invalid v3 data encryption key');

    const payloadDecipher = crypto.createDecipheriv(
      'aes-256-gcm',
      dek,
      Buffer.from(payloadIvHex, 'hex')
    );
    payloadDecipher.setAAD(Buffer.from(`opsknight:v3:${keyId}:payload`, 'utf8'));
    payloadDecipher.setAuthTag(Buffer.from(payloadTagHex, 'hex'));
    return Buffer.concat([
      payloadDecipher.update(Buffer.from(payloadHex, 'hex')),
      payloadDecipher.final(),
    ]).toString('utf8');
  }

  // V2 envelope format
  if (encryptedText.startsWith('v2:')) {
    const algorithm = 'aes-256-cbc';
    const parts = encryptedText.split(':');
    if (parts.length !== 5) {
      throw new Error('Invalid v2 encrypted text format');
    }
    const dekIv = Buffer.from(parts[1], 'hex');
    const encryptedDek = parts[2];
    const payloadIv = Buffer.from(parts[3], 'hex');
    const encryptedPayload = parts[4];

    const dekDecipher = crypto.createDecipheriv(algorithm, masterKey, dekIv);
    let dekHex = dekDecipher.update(encryptedDek, 'hex', 'utf8');
    dekHex += dekDecipher.final('utf8');
    const dek = Buffer.from(dekHex, 'hex');

    const payloadDecipher = crypto.createDecipheriv(algorithm, dek, payloadIv);
    let decrypted = payloadDecipher.update(encryptedPayload, 'hex', 'utf8');
    decrypted += payloadDecipher.final('utf8');
    return decrypted;
  }

  // Legacy v1 format: iv:ciphertext
  const algorithm = 'aes-256-cbc';
  const parts = encryptedText.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Invalid encrypted text format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Encrypt using the active system key.
 */
export async function encrypt(text: string): Promise<string> {
  const active = getEncryptionKeyring()[0];
  if (!active) throw new Error('ENCRYPTION_KEY not configured');
  return encryptWithKey(text, active.key, active.id);
}

/**
 * Decrypt using the active system key.
 */
export async function decrypt(encryptedText: string): Promise<string> {
  try {
    const keyring = getEncryptionKeyring();
    if (keyring.length === 0) throw new Error('ENCRYPTION_KEY not configured');

    if (encryptedText.startsWith('v3:')) {
      const keyId = encryptedText.split(':', 3)[1];
      const matchingKey = keyring.find(entry => entry.id === keyId);
      if (!matchingKey) throw new Error(`Encryption key ID is unavailable: ${keyId}`);
      return await decryptWithKey(encryptedText, matchingKey.key);
    }

    let lastLegacyError: unknown;
    for (const entry of keyring) {
      try {
        return await decryptWithKey(encryptedText, entry.key);
      } catch (error) {
        lastLegacyError = error;
      }
    }
    throw lastLegacyError || new Error('Unable to decrypt legacy ciphertext');
  } catch (primaryError) {
    // If primary decryption fails, attempt legacy database-backed key fallback
    try {
      const prismaModule = await import('./prisma');
      const prisma = prismaModule.default;
      const settings = await prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: { encryptionKey: true },
      });

      if (settings?.encryptionKey) {
        logger.warn(
          '[Encryption] Primary decryption failed. Attempting legacy database key fallback...'
        );
        const decryptedLegacy = await decryptWithKey(encryptedText, settings.encryptionKey);
        logger.info(
          '[Encryption] Legacy decryption succeeded. Initiating background transparent migration to new key...'
        );

        // Asynchronously migrate this specific ciphertext to the new key in the database
        // without blocking the returned result:
        const active = getEncryptionKeyring()[0];
        if (active) {
          Promise.resolve().then(async () => {
            try {
              const newEncrypted = await encryptWithKey(decryptedLegacy, active.key, active.id);

              // 1. Check OidcConfig
              await prisma.oidcConfig.updateMany({
                where: { clientSecret: encryptedText },
                data: { clientSecret: newEncrypted },
              });

              // 2. Check SlackIntegration
              await prisma.slackIntegration.updateMany({
                where: { botToken: encryptedText },
                data: { botToken: newEncrypted },
              });
              await prisma.slackIntegration.updateMany({
                where: { signingSecret: encryptedText },
                data: { signingSecret: newEncrypted },
              });

              // 3. Check SlackOAuthConfig
              await prisma.slackOAuthConfig.updateMany({
                where: { clientSecret: encryptedText },
                data: { clientSecret: newEncrypted },
              });

              // For provider JSON configs, it's prefixed by "enc:". So we search for "enc:" + encryptedText.
              const oldEncPrefixed = 'enc:' + encryptedText;
              const newEncPrefixed = 'enc:' + newEncrypted;

              // 4. Check NotificationProvider config values
              const notifProviders = await prisma.notificationProvider.findMany();
              for (const np of notifProviders) {
                if (np.config && typeof np.config === 'object') {
                  let updated = false;
                  const cfg = { ...(np.config as Record<string, any>) };
                  for (const [k, v] of Object.entries(cfg)) {
                    if (v === oldEncPrefixed) {
                      cfg[k] = newEncPrefixed;
                      updated = true;
                    }
                  }
                  if (updated) {
                    await prisma.notificationProvider.update({
                      where: { id: np.id },
                      data: { config: cfg },
                    });
                    logger.info(
                      `[Encryption] Dynamic migration: updated NotificationProvider ${np.id} configuration.`
                    );
                  }
                }
              }
            } catch (migrationError) {
              logger.error('[Encryption] Dynamic on-the-fly migration error', { migrationError });
            }
          });
        }

        return decryptedLegacy;
      }
    } catch (fallbackError) {
      logger.error('[Encryption] Legacy fallback decryption failed or skipped', { fallbackError });
    }

    logger.error('[Encryption] Decryption error', { error: primaryError });
    throw new Error('Failed to decrypt token');
  }
}

/** Read a secret during the rollout from legacy plaintext to encrypted values. */
export async function decryptStoredSecret(value: string): Promise<string> {
  const looksEncrypted =
    value.startsWith('v3:') || value.startsWith('v2:') || /^[0-9a-f]+:[0-9a-f]+$/i.test(value);
  return looksEncrypted ? decrypt(value) : value;
}
