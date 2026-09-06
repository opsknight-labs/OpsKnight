import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getEncryptionKey, encrypt, decrypt, encryptWithKey, decryptWithKey } from '../encryption';

const mockFindUnique = vi.fn();
vi.mock('../prisma', () => ({
  default: {
    systemSettings: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
  },
}));

describe('Encryption Utility Tests', () => {
  const originalEnv = { ...process.env };
  const VALID_KEY = 'a3f1c2e4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2';
  const INVALID_KEY = 'invalid-key-short';

  beforeEach(() => {
    vi.resetModules();
    mockFindUnique.mockReset();
    mockFindUnique.mockResolvedValue(null);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getEncryptionKey Resolving', () => {
    it('should resolve the ENCRYPTION_KEY environment variable when valid', () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;
      const key = getEncryptionKey();
      expect(key).toBe(VALID_KEY);
    });

    it('should fall back to the stable DEV_FALLBACK_KEY in development when ENCRYPTION_KEY is missing', () => {
      (process.env as any).NODE_ENV = 'development';
      delete process.env.ENCRYPTION_KEY;

      const key = getEncryptionKey();
      expect(key).toBe('0000000000000000000000000000000000000000000000000000000000000000');
    });

    it('should return null and warn in non-development mode when ENCRYPTION_KEY is missing', () => {
      (process.env as any).NODE_ENV = 'production';
      delete process.env.ENCRYPTION_KEY;

      const key = getEncryptionKey();
      expect(key).toBeNull();
    });

    it('should return null and error when ENCRYPTION_KEY is malformed (not 64-char hex)', () => {
      process.env.ENCRYPTION_KEY = INVALID_KEY;
      const key = getEncryptionKey();
      expect(key).toBeNull();
    });
  });

  describe('Envelope Encryption (v3) Operations', () => {
    it('should encrypt and decrypt data correctly using a valid key', async () => {
      const plaintext = 'Secret OpsKnight Credential';
      const encrypted = await encryptWithKey(plaintext, VALID_KEY);

      expect(encrypted).toContain('v3:');
      expect(encrypted.split(':')).toHaveLength(8);

      const decrypted = await decryptWithKey(encrypted, VALID_KEY);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw an error when encrypting with an invalid key length', async () => {
      await expect(encryptWithKey('plaintext', INVALID_KEY)).rejects.toThrow();
    });

    it('should throw an error when decrypting with a mismatched key', async () => {
      const plaintext = 'Sensitive Secret';
      const encrypted = await encryptWithKey(plaintext, VALID_KEY);

      const ANOTHER_VALID_KEY = 'b3f1c2e4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f3';
      await expect(decryptWithKey(encrypted, ANOTHER_VALID_KEY)).rejects.toThrow();
    });
  });

  describe('Legacy (v1) Decryption Operations', () => {
    it('should decrypt legacy v1 ciphertext (no prefix, formatted as iv:ciphertext)', async () => {
      // Create a manual legacy encrypted payload: iv (16 bytes = 32 hex chars) and payload ciphertext
      // Since AES-256-CBC with direct master key was used, we can simulate legacy encryption:
      const crypto = await import('crypto');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(VALID_KEY, 'hex'), iv);
      let legacyCiphertext = cipher.update('Legacy Secret', 'utf8', 'hex');
      legacyCiphertext += cipher.final('hex');

      const legacyPayload = `${iv.toString('hex')}:${legacyCiphertext}`;

      const decrypted = await decryptWithKey(legacyPayload, VALID_KEY);
      expect(decrypted).toBe('Legacy Secret');
    });

    it('should throw an error when legacy payload format is malformed', async () => {
      await expect(decryptWithKey('badpayload', VALID_KEY)).rejects.toThrow();
    });
  });

  describe('App-level Integration Helpers', () => {
    it('should successfully encrypt and decrypt using the active resolved system key', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;
      const plaintext = 'System Secret';

      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw an error on encrypt when ENCRYPTION_KEY is not configured', async () => {
      (process.env as any).NODE_ENV = 'production';
      delete process.env.ENCRYPTION_KEY;

      await expect(encrypt('secret')).rejects.toThrow('ENCRYPTION_KEY not configured');
    });

    it('should throw an error on decrypt when ENCRYPTION_KEY is not configured', async () => {
      (process.env as any).NODE_ENV = 'production';
      delete process.env.ENCRYPTION_KEY;

      await expect(decrypt('v2:some:encrypted:payload:here')).rejects.toThrow(
        'Failed to decrypt token'
      );
    });

    it('should fall back dynamically to legacy database key when primary key decryption fails', async () => {
      process.env.ENCRYPTION_KEY = VALID_KEY;
      const LEGACY_KEY = 'b3f1c2e4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f3';

      const plaintext = 'My Legacy Secret';
      const encryptedWithLegacy = await encryptWithKey(plaintext, LEGACY_KEY);

      mockFindUnique.mockResolvedValue({ encryptionKey: LEGACY_KEY });

      const decrypted = await decrypt(encryptedWithLegacy);
      expect(decrypted).toBe(plaintext);
    });
  });
});
