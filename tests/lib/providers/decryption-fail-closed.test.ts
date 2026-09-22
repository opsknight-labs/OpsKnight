import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  decryptProviderConfig,
  ProviderDecryptionError,
  PROVIDER_ERROR_CODES,
} from '@/lib/encrypted-provider-config';
import {
  getAllConfiguredEmailProviders,
  getSMSConfig,
  getWhatsAppConfig,
  getPushConfig,
} from '@/lib/notification-providers';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    notificationProvider: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/encryption', () => ({
  getEncryptionKey: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Fail-Closed Secret Decryption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('decryptProviderConfig Direct Failure Modes', () => {
    it('throws ProviderDecryptionError when encryption key is missing and config has enc: secrets', async () => {
      const { getEncryptionKey } = await import('@/lib/encryption');
      vi.mocked(getEncryptionKey).mockResolvedValue(null);

      const corruptedConfig = {
        apiKey: 'enc:corrupted_ciphertext_abc123',
        fromEmail: 'alerts@opsknight.io',
      };

      await expect(
        decryptProviderConfig('resend', corruptedConfig)
      ).rejects.toThrow(ProviderDecryptionError);

      await expect(
        decryptProviderConfig('resend', corruptedConfig)
      ).rejects.toMatchObject({
        code: PROVIDER_ERROR_CODES.DECRYPTION_FAILED,
      });
    });

    it('throws ProviderDecryptionError when decryptValue encounters corrupted ciphertext', async () => {
      const { getEncryptionKey, decrypt } = await import('@/lib/encryption');
      vi.mocked(getEncryptionKey).mockResolvedValue('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      vi.mocked(decrypt).mockRejectedValue(new Error('Ciphertext authentication tag mismatch'));

      const corruptedTwilio = {
        accountSid: 'enc:bad_sid',
        authToken: 'enc:bad_token',
        fromNumber: '+15005550006',
      };

      await expect(
        decryptProviderConfig('twilio', corruptedTwilio)
      ).rejects.toThrow(ProviderDecryptionError);

      await expect(
        decryptProviderConfig('twilio', corruptedTwilio)
      ).rejects.toMatchObject({
        code: PROVIDER_ERROR_CODES.DECRYPTION_FAILED,
      });
    });

    it('preserves legacy plaintext configurations when no encryption key is available', async () => {
      const { getEncryptionKey } = await import('@/lib/encryption');
      vi.mocked(getEncryptionKey).mockResolvedValue(null);

      const legacyPlaintextConfig = {
        apiKey: 're_plain_legacy_key',
        fromEmail: 'alerts@opsknight.io',
      };

      const result = await decryptProviderConfig('resend', legacyPlaintextConfig);
      expect(result.apiKey).toBe('re_plain_legacy_key');
    });
  });

  describe('Notification Provider Loaders Fail Closed', () => {
    it('skips corrupted email providers without passing enc: ciphertext to caller', async () => {
      const { getEncryptionKey, decrypt } = await import('@/lib/encryption');
      vi.mocked(getEncryptionKey).mockResolvedValue('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      vi.mocked(decrypt).mockRejectedValue(new Error('Invalid padding / bad ciphertext'));

      vi.mocked(prisma.notificationProvider.findMany).mockResolvedValue([
        {
          id: 'prov-resend',
          provider: 'resend',
          enabled: true,
          config: { apiKey: 'enc:bad_resend_secret' },
        },
        {
          id: 'prov-sendgrid',
          provider: 'sendgrid',
          enabled: true,
          config: { apiKey: 'enc:bad_sendgrid_secret' },
        },
      ] as never);

      const emailProviders = await getAllConfiguredEmailProviders();

      // No corrupted provider should be in the returned list
      expect(emailProviders).toHaveLength(0);

      // Ciphertext must never be present in any returned provider config
      for (const provider of emailProviders) {
        expect(provider.apiKey).not.toContain('enc:');
      }
    });

    it('disables Twilio SMS when credentials fail decryption', async () => {
      const { getEncryptionKey, decrypt } = await import('@/lib/encryption');
      vi.mocked(getEncryptionKey).mockResolvedValue('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      vi.mocked(decrypt).mockRejectedValue(new Error('Corrupted IV'));

      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'prov-twilio',
        provider: 'twilio',
        enabled: true,
        config: {
          accountSid: 'enc:corrupted_sid',
          authToken: 'enc:corrupted_token',
          fromNumber: '+15005550006',
        },
      } as never);

      const smsConfig = await getSMSConfig();
      expect(smsConfig.enabled).toBe(false);
      expect(smsConfig.provider).toBeNull();
      expect(smsConfig.authToken).toBeUndefined();
    });

    it('disables Twilio WhatsApp when credentials fail decryption', async () => {
      const { getEncryptionKey, decrypt } = await import('@/lib/encryption');
      vi.mocked(getEncryptionKey).mockResolvedValue('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      vi.mocked(decrypt).mockRejectedValue(new Error('Corrupted auth tag'));

      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'prov-twilio',
        provider: 'twilio',
        enabled: true,
        config: {
          accountSid: 'enc:corrupted_sid',
          authToken: 'enc:corrupted_token',
          whatsappNumber: '+14155238886',
          whatsappEnabled: true,
        },
      } as never);

      const waConfig = await getWhatsAppConfig();
      expect(waConfig.enabled).toBe(false);
      expect(waConfig.provider).toBeNull();
      expect(waConfig.authToken).toBeUndefined();
    });

    it('disables Web Push when VAPID private key fails decryption', async () => {
      const { getEncryptionKey, decrypt } = await import('@/lib/encryption');
      vi.mocked(getEncryptionKey).mockResolvedValue('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      vi.mocked(decrypt).mockRejectedValue(new Error('Corrupted private key'));

      vi.mocked(prisma.notificationProvider.findUnique).mockResolvedValue({
        id: 'prov-push',
        provider: 'web-push',
        enabled: true,
        config: {
          vapidPublicKey: 'BN_MOCK_PUBLIC_KEY',
          vapidPrivateKey: 'enc:corrupted_private_key',
        },
      } as never);

      const pushConfig = await getPushConfig();
      expect(pushConfig.enabled).toBe(false);
      expect(pushConfig.provider).toBeNull();
      expect(pushConfig.vapidPrivateKey).toBeUndefined();
    });
  });

  describe('Zero-Leakage Security Invariant', () => {
    it('never logs raw ciphertext in error messages or logs', async () => {
      const { getEncryptionKey, decrypt } = await import('@/lib/encryption');
      vi.mocked(getEncryptionKey).mockResolvedValue('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      vi.mocked(decrypt).mockRejectedValue(new Error('Decryption failed'));

      const secretCiphertext = 'enc:SUPER_SECRET_PAYLOAD_CIPHERTEXT_999';

      try {
        await decryptProviderConfig('resend', { apiKey: secretCiphertext });
      } catch (err: unknown) {
        const error = err as Error;
        expect(error.message).not.toContain(secretCiphertext);
      }

      const allLogCalls = [
        ...vi.mocked(logger.error).mock.calls,
        ...vi.mocked(logger.warn).mock.calls,
      ];

      for (const call of allLogCalls) {
        const logStr = JSON.stringify(call);
        expect(logStr).not.toContain(secretCiphertext);
      }
    });
  });
});
