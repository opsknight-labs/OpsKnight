import { describe, it, expect } from 'vitest';
import { generateApiKey, hashToken } from '@/lib/api-keys';

describe('API Keys Utilities', () => {
  describe('generateApiKey', () => {
    it('should generate a valid API key with prefix', () => {
      const result = generateApiKey();

      expect(result.token).toBeDefined();
      expect(result.token).toMatch(/^ok_(live|test)_/);
      expect(result.prefix).toBe(result.token.slice(0, 12));
      expect(result.tokenHash).toBeDefined();
      expect(result.tokenHash).toHaveLength(64); // SHA-256 hash is 64 hex characters
    });

    it('should generate unique tokens on each call', () => {
      const key1 = generateApiKey();
      const key2 = generateApiKey();

      expect(key1.token).not.toBe(key2.token);
      expect(key1.tokenHash).not.toBe(key2.tokenHash);
    });

    it('should generate token with correct format', () => {
      const result = generateApiKey();

      // Token should start with 'ok_' prefix and contain base64url characters
      expect(result.token.startsWith('ok_')).toBe(true);

      // Remove prefix and check base64url format (alphanumeric, -, _)
      const tokenBody = result.token.slice(3);
      expect(tokenBody).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('should hash the generated token correctly', () => {
      const result = generateApiKey();
      const expectedHash = hashToken(result.token);

      expect(result.tokenHash).toBe(expectedHash);
    });
  });

  describe('hashToken', () => {
    it('should generate a consistent hash for the same token', () => {
      const token = 'ok_test-token-123';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex string length
    });

    it('should generate different hashes for different tokens', () => {
      const hash1 = hashToken('ok_token1');
      const hash2 = hashToken('ok_token2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle tokens with special characters', () => {
      const tokens = [
        'ok_test-token-123',
        'ok_test_token_456',
        'ok_test+token/789',
        'ok_test.token.abc',
      ];

      const hashes = tokens.map(token => hashToken(token));

      // All hashes should be valid hex strings of length 64
      hashes.forEach(hash => {
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[a-f0-9]+$/);
      });

      // All hashes should be unique
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(hashes.length);
    });

    it('should generate hex-encoded SHA-256 hash', () => {
      const token = 'ok_test-token';
      const hash = hashToken(token);

      // SHA-256 produces 256 bits = 32 bytes = 64 hex characters
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle empty token', () => {
      const hash = hashToken('');

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle very long tokens', () => {
      const longToken = 'ok_' + 'a'.repeat(1000);
      const hash = hashToken(longToken);

      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
