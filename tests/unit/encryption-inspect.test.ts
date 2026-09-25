import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  inspectValue,
  inspectTargetRecord,
  getUniqueLegacyKeyCandidates,
} from '@/lib/encryption/inspect';
import { encryptWithKey } from '@/lib/encryption';
import { EncryptionTargetDefinition } from '@/lib/encryption/types';

describe('Encryption Inspector Unit Tests', () => {
  const key1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const key2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  const keyring = [
    { id: 'k1', key: key1 },
    { id: 'k2', key: key2 },
  ];
  const activeKeyId = 'k1';

  it('classifies empty or null values as EMPTY', async () => {
    expect((await inspectValue(null, false, keyring, activeKeyId)).classification).toBe('EMPTY');
    expect((await inspectValue(undefined, false, keyring, activeKeyId)).classification).toBe(
      'EMPTY'
    );
    expect((await inspectValue('', false, keyring, activeKeyId)).classification).toBe('EMPTY');
    expect((await inspectValue('   ', false, keyring, activeKeyId)).classification).toBe('EMPTY');
  });

  it('classifies v3 ciphertext encrypted with active key as CURRENT_V3', async () => {
    const ciphertext = await encryptWithKey('my-secret', key1, 'k1');
    const result = await inspectValue(ciphertext, false, keyring, activeKeyId);

    expect(result.classification).toBe('CURRENT_V3');
    expect(result.detectedKeyId).toBe('k1');
  });

  it('classifies v3 ciphertext encrypted with known non-active key as OLD_KEY_V3', async () => {
    const ciphertext = await encryptWithKey('my-secret', key2, 'k2');
    const result = await inspectValue(ciphertext, false, keyring, activeKeyId);

    expect(result.classification).toBe('OLD_KEY_V3');
    expect(result.detectedKeyId).toBe('k2');
  });

  it('classifies v3 ciphertext encrypted with unknown key as UNAVAILABLE_KEY', async () => {
    const randomKey = '1111111111111111111111111111111111111111111111111111111111111111';
    const ciphertext = await encryptWithKey('my-secret', randomKey, 'k_unknown');
    const result = await inspectValue(ciphertext, false, keyring, activeKeyId);

    expect(result.classification).toBe('UNAVAILABLE_KEY');
    expect(result.detectedKeyId).toBe('k_unknown');
  });

  it('classifies legacy v1 format ciphertext correctly', async () => {
    // Generate valid legacy v1 AES-256-CBC ciphertext (iv:hex)
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key2, 'hex'), iv);
    let encrypted = cipher.update('my-legacy-secret', 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const v1Ciphertext = `${iv.toString('hex')}:${encrypted}`;

    const result = await inspectValue(v1Ciphertext, false, keyring, activeKeyId);
    expect(result.classification).toBe('LEGACY_V1');
    expect(result.detectedKeyId).toBe('k2');
  });

  it('classifies legacy v2 envelope ciphertext correctly', async () => {
    // Generate valid legacy v2 envelope
    const dek = crypto.randomBytes(32);
    const dekIv = crypto.randomBytes(16);
    const dekCipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key1, 'hex'), dekIv);
    let encryptedDek = dekCipher.update(dek.toString('hex'), 'utf8', 'hex');
    encryptedDek += dekCipher.final('hex');

    const payloadIv = crypto.randomBytes(16);
    const payloadCipher = crypto.createCipheriv('aes-256-cbc', dek, payloadIv);
    let encryptedPayload = payloadCipher.update('my-v2-secret', 'utf8', 'hex');
    encryptedPayload += payloadCipher.final('hex');

    const v2Ciphertext = `v2:${dekIv.toString('hex')}:${encryptedDek}:${payloadIv.toString('hex')}:${encryptedPayload}`;

    const result = await inspectValue(v2Ciphertext, false, keyring, activeKeyId);
    expect(result.classification).toBe('LEGACY_V2');
    expect(result.detectedKeyId).toBe('k1');
  });

  it('handles plaintext values according to plaintextLegacyAllowed flag', async () => {
    const rawSecret = 'plain-secret-value-12345';

    // Disallowed -> UNREADABLE
    const resultNotAllowed = await inspectValue(rawSecret, false, keyring, activeKeyId);
    expect(resultNotAllowed.classification).toBe('UNREADABLE');

    // Allowed -> PLAINTEXT
    const resultAllowed = await inspectValue(rawSecret, true, keyring, activeKeyId);
    expect(resultAllowed.classification).toBe('PLAINTEXT');
  });

  it('inspects JSON_FIELD targets with enc: prefixes and raw values', async () => {
    const v3Cipher = await encryptWithKey('api-key-secret', key1, 'k1');

    const target: EncryptionTargetDefinition = {
      id: 'notification-provider.config',
      model: 'NotificationProvider',
      field: 'config',
      storageType: 'JSON_FIELD',
      jsonKeys: ['apiKey', 'password'],
      plaintextLegacyAllowed: true,
      label: 'Provider Config',
      description: 'Test',
    };

    const record = {
      id: 'np-1',
      config: {
        apiKey: `enc:${v3Cipher}`,
        password: 'plain-smtp-password',
        unrelated: 'not-inspected',
      },
    };

    const results = await inspectTargetRecord(record, target, keyring, activeKeyId);
    expect(results).toHaveLength(2);

    const apiKeyResult = results[0];
    expect(apiKeyResult.classification).toBe('CURRENT_V3');
    expect(apiKeyResult.detectedKeyId).toBe('k1');

    const passwordResult = results[1];
    expect(passwordResult.classification).toBe('PLAINTEXT');
  });

  it('classifies corrupted/tampered v3 ciphertext as UNREADABLE (cryptographic authentication)', async () => {
    const validCiphertext = await encryptWithKey('sensitive-payload', key1, 'k1');
    const parts = validCiphertext.split(':');
    // Corrupt the payload ciphertext by inverting the first byte to guarantee tampering
    const firstByte = parseInt(parts[6].slice(0, 2), 16);
    parts[6] = (firstByte ^ 0xff).toString(16).padStart(2, '0') + parts[6].slice(2);
    const tampered = parts.join(':');

    const result = await inspectValue(tampered, false, keyring, activeKeyId);
    expect(result.classification).toBe('UNREADABLE');
    expect(result.details).toContain('cryptographic authentication');
  });

  it('inspects nested array paths such as vapidKeyHistory[].privateKey in JSON_FIELD', async () => {
    const v3Cipher = await encryptWithKey('vapid-private-key-data', key2, 'k2');

    const target: EncryptionTargetDefinition = {
      id: 'notification-provider.config',
      model: 'NotificationProvider',
      field: 'config',
      storageType: 'JSON_FIELD',
      jsonKeys: ['vapidPrivateKey'],
      nestedArrayPaths: [{ arrayField: 'vapidKeyHistory', itemField: 'privateKey' }],
      plaintextLegacyAllowed: true,
      label: 'Provider Config',
      description: 'Test',
    };

    const record = {
      id: 'np-webpush',
      config: {
        vapidPrivateKey: `enc:${v3Cipher}`,
        vapidKeyHistory: [
          { keyId: 'prev-1', privateKey: `enc:${v3Cipher}` },
          { keyId: 'prev-2', privateKey: 'plaintext-unencrypted-key' },
        ],
      },
    };

    const results = await inspectTargetRecord(record, target, keyring, activeKeyId);
    expect(results).toHaveLength(3); // 1 root + 2 nested
    expect(results[0].classification).toBe('OLD_KEY_V3');
    expect(results[0].detectedKeyId).toBe('k2');
    expect(results[1].classification).toBe('OLD_KEY_V3');
    expect(results[1].detectedKeyId).toBe('k2');
    expect(results[2].classification).toBe('PLAINTEXT');
  });

  it('getUniqueLegacyKeyCandidates deduplicates identical key material and prefers env keys over database_legacy', () => {
    // Case 1: k1 and database_legacy share the exact same key bytes
    const keyringWithDb = [
      { id: 'k2', key: key2 },
      { id: 'k1', key: key1 },
      { id: 'database_legacy', key: key1 },
    ];
    const unique = getUniqueLegacyKeyCandidates(keyringWithDb, 'k2');
    expect(unique).toHaveLength(2);
    expect(unique.map(e => e.id)).toEqual(['k2', 'k1']);
    expect(unique.find(e => e.id === 'k1')?.key).toBe(key1);

    // Case 2: database_legacy appears before env key
    const keyringReversed = [
      { id: 'database_legacy', key: key1 },
      { id: 'k1', key: key1 },
    ];
    const uniqueReversed = getUniqueLegacyKeyCandidates(keyringReversed, 'k1');
    expect(uniqueReversed).toHaveLength(1);
    expect(uniqueReversed[0].id).toBe('k1');
  });

  it('classifies legacy v1/v2 as NOT AMBIGUOUS when env k1 and database_legacy share the same key material', async () => {
    const duplicatedKeyring = [
      { id: 'k2', key: key2 },
      { id: 'k1', key: key1 },
      { id: 'database_legacy', key: key1 },
    ];

    // Legacy v1 ciphertext encrypted with key1
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key1, 'hex'), iv);
    let encrypted = cipher.update('legacy-v1-secret', 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const v1Ciphertext = `${iv.toString('hex')}:${encrypted}`;

    const v1Result = await inspectValue(v1Ciphertext, false, duplicatedKeyring, 'k2');
    expect(v1Result.classification).toBe('LEGACY_V1');
    expect(v1Result.detectedKeyId).toBe('k1');
    expect(v1Result.details).toBeUndefined();

    // Legacy v2 ciphertext encrypted with key1
    const dek = crypto.randomBytes(32);
    const dekIv = crypto.randomBytes(16);
    const dekCipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key1, 'hex'), dekIv);
    let encryptedDek = dekCipher.update(dek.toString('hex'), 'utf8', 'hex');
    encryptedDek += dekCipher.final('hex');

    const payloadIv = crypto.randomBytes(16);
    const payloadCipher = crypto.createCipheriv('aes-256-cbc', dek, payloadIv);
    let encryptedPayload = payloadCipher.update('legacy-v2-secret', 'utf8', 'hex');
    encryptedPayload += payloadCipher.final('hex');

    const v2Ciphertext = `v2:${dekIv.toString('hex')}:${encryptedDek}:${payloadIv.toString('hex')}:${encryptedPayload}`;

    const v2Result = await inspectValue(v2Ciphertext, false, duplicatedKeyring, 'k2');
    expect(v2Result.classification).toBe('LEGACY_V2');
    expect(v2Result.detectedKeyId).toBe('k1');
    expect(v2Result.details).toBeUndefined();
  });
});
