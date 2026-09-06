import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateHmacSignature,
  verifyHmacSignature,
  verifyGitHubSignature,
  verifySentrySignature,
  verifySlackSignature,
  verifyWebhookSignature,
  isTimestampValid,
} from '@/lib/integrations/signature-verification';

describe('Signature Verification', () => {
  const testSecret = 'test-webhook-secret-key-12345';
  const testPayload = '{"event":"test","data":"value"}';

  describe('generateHmacSignature', () => {
    it('should generate consistent SHA-256 HMAC signatures', () => {
      const sig1 = generateHmacSignature(testPayload, testSecret);
      const sig2 = generateHmacSignature(testPayload, testSecret);
      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate different signatures for different payloads', () => {
      const sig1 = generateHmacSignature('payload1', testSecret);
      const sig2 = generateHmacSignature('payload2', testSecret);
      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different secrets', () => {
      const sig1 = generateHmacSignature(testPayload, 'secret1');
      const sig2 = generateHmacSignature(testPayload, 'secret2');
      expect(sig1).not.toBe(sig2);
    });

    it('should support SHA-1 algorithm', () => {
      const sha1 = generateHmacSignature(testPayload, testSecret, 'sha1');
      expect(sha1).toMatch(/^[a-f0-9]{40}$/);
    });
  });

  describe('verifyHmacSignature', () => {
    it('should verify valid signature', () => {
      const signature = generateHmacSignature(testPayload, testSecret);
      expect(verifyHmacSignature(testPayload, signature, testSecret)).toBe(true);
    });

    it('should reject invalid signature', () => {
      expect(verifyHmacSignature(testPayload, 'invalid', testSecret)).toBe(false);
    });

    it('should reject signature from wrong payload', () => {
      const signature = generateHmacSignature('other-payload', testSecret);
      expect(verifyHmacSignature(testPayload, signature, testSecret)).toBe(false);
    });

    it('should support prefix in signature', () => {
      const signature = generateHmacSignature(testPayload, testSecret);
      expect(
        verifyHmacSignature(testPayload, 'sha256=' + signature, testSecret, 'sha256', 'sha256=')
      ).toBe(true);
    });
  });

  describe('verifyGitHubSignature', () => {
    it('should verify valid GitHub signature with sha256 prefix', () => {
      const signature = 'sha256=' + generateHmacSignature(testPayload, testSecret);
      expect(verifyGitHubSignature(testPayload, signature, testSecret)).toBe(true);
    });

    it('should reject signature without prefix', () => {
      const signature = generateHmacSignature(testPayload, testSecret);
      expect(verifyGitHubSignature(testPayload, signature, testSecret)).toBe(false);
    });

    it('should reject invalid signature', () => {
      expect(verifyGitHubSignature(testPayload, 'sha256=invalid', testSecret)).toBe(false);
    });

    it('should return false for empty signature', () => {
      expect(verifyGitHubSignature(testPayload, '', testSecret)).toBe(false);
    });
  });

  describe('verifySentrySignature', () => {
    it('should verify valid Sentry HMAC signature', () => {
      const signature = generateHmacSignature(testPayload, testSecret);
      expect(verifySentrySignature(testPayload, signature, testSecret)).toBe(true);
    });

    it('should reject invalid signature', () => {
      expect(verifySentrySignature(testPayload, 'wrong', testSecret)).toBe(false);
    });
  });

  describe('verifySlackSignature', () => {
    it('should verify valid Slack signature with timestamp', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const baseString = `v0:${timestamp}:${testPayload}`;
      const expected = 'v0=' + generateHmacSignature(baseString, testSecret);

      expect(verifySlackSignature(testPayload, timestamp, expected, testSecret)).toBe(true);
    });

    it('should reject expired timestamp', () => {
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes ago
      const baseString = `v0:${oldTimestamp}:${testPayload}`;
      const signature = 'v0=' + generateHmacSignature(baseString, testSecret);

      expect(verifySlackSignature(testPayload, oldTimestamp, signature, testSecret)).toBe(false);
    });
  });

  describe('isTimestampValid', () => {
    it('should accept recent Unix timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(isTimestampValid(now)).toBe(true);
      expect(isTimestampValid(now - 60)).toBe(true); // 1 minute ago
    });

    it('should reject old timestamp', () => {
      const old = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      expect(isTimestampValid(old)).toBe(false);
    });

    it('should accept custom max age', () => {
      const old = Math.floor(Date.now() / 1000) - 600;
      expect(isTimestampValid(old, 700)).toBe(true); // Allow 11+ minutes
    });

    it('should handle string timestamps', () => {
      const now = String(Math.floor(Date.now() / 1000));
      expect(isTimestampValid(now)).toBe(true);
    });

    it('should handle ISO string timestamps', () => {
      const isoNow = new Date().toISOString();
      expect(isTimestampValid(isoNow)).toBe(true);
    });

    it('should reject invalid timestamp', () => {
      expect(isTimestampValid('not-a-number')).toBe(false);
    });
  });

  describe('verifyWebhookSignature (unified)', () => {
    const headers: Record<string, string | null> = {};

    beforeEach(() => {
      Object.keys(headers).forEach(key => {
        // eslint-disable-next-line security/detect-object-injection
        delete headers[key];
      });
    });

    it('should verify GitHub provider', () => {
      const signature = 'sha256=' + generateHmacSignature(testPayload, testSecret);
      headers['x-hub-signature-256'] = signature;

      const result = verifyWebhookSignature('github', testPayload, headers, testSecret);
      expect(result.valid).toBe(true);
    });

    it('should return error for missing GitHub signature', () => {
      const result = verifyWebhookSignature('github', testPayload, headers, testSecret);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('MISSING_SIGNATURE');
    });

    it('should return error for missing secret', () => {
      headers['x-hub-signature-256'] = 'sha256=abc';
      const result = verifyWebhookSignature('github', testPayload, headers, '');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('MISSING_SECRET');
    });

    it('should verify generic provider with x-signature header', () => {
      const signature = generateHmacSignature(testPayload, testSecret);
      headers['x-signature'] = signature;

      const result = verifyWebhookSignature('generic', testPayload, headers, testSecret);
      expect(result.valid).toBe(true);
    });
  });
});
