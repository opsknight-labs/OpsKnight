import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  getEncryptionKey: vi.fn(),
}));

import {
  maskSensitiveFields,
  SECRET_MASK,
  stripMaskedPresenceFlags,
} from '@/lib/encrypted-provider-config';
import {
  notificationProviderConfigSchema,
  type NotificationProviderKey,
} from '@/lib/notifications/provider-schema';

const savedConfigs: Record<NotificationProviderKey, Record<string, unknown>> = {
  twilio: {
    accountSid: 'AC123',
    authToken: 'token',
    fromNumber: '+15550100',
    whatsappAccountSid: 'AC456',
    whatsappAuthToken: 'wa-token',
  },
  'aws-sns': { region: 'us-east-1', accessKeyId: 'AKIA', secretAccessKey: 'secret' },
  resend: { apiKey: 're_key', fromEmail: 'ops@example.com' },
  sendgrid: { apiKey: 'SG.key', fromEmail: 'ops@example.com' },
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    user: 'ops',
    password: 'pw',
    secure: false,
    fromEmail: 'ops@example.com',
  },
  ses: {
    region: 'eu-west-1',
    accessKeyId: 'AKIA',
    secretAccessKey: 'secret',
    fromEmail: 'ops@example.com',
  },
  'web-push': {
    vapidPublicKey: 'pub',
    vapidPrivateKey: 'priv',
    vapidSubject: 'mailto:ops@example.com',
    vapidKeyHistory: [{ publicKey: 'old-pub', privateKey: 'old-priv' }],
  },
};

describe('stripMaskedPresenceFlags', () => {
  it.each(Object.keys(savedConfigs) as NotificationProviderKey[])(
    'lets the masked %s view the settings form sends back pass the strict schema',
    provider => {
      // eslint-disable-next-line security/detect-object-injection -- closed test table
      const masked = maskSensitiveFields(provider, savedConfigs[provider]);
      const schema = notificationProviderConfigSchema(provider);

      // Regression: before the fix, re-saving the masked view failed validation.
      expect(schema.safeParse(masked).success).toBe(false);
      expect(schema.safeParse(stripMaskedPresenceFlags(provider, masked)).success).toBe(true);
    }
  );

  it('removes presence flags but keeps masked secrets for the merge step', () => {
    const stripped = stripMaskedPresenceFlags('smtp', {
      host: 'smtp.example.com',
      password: SECRET_MASK,
      hasPassword: true,
    });
    expect(stripped).toEqual({ host: 'smtp.example.com', password: SECRET_MASK });
  });

  it('still lets the strict schema reject unrelated unknown keys', () => {
    const stripped = stripMaskedPresenceFlags('smtp', { host: 'h', hasHost: true, extra: 1 });
    expect(stripped).toEqual({ host: 'h', hasHost: true, extra: 1 });
    expect(notificationProviderConfigSchema('smtp').safeParse(stripped).success).toBe(false);
  });

  it('only removes boolean flags', () => {
    expect(stripMaskedPresenceFlags('resend', { hasApiKey: 'yes' })).toEqual({ hasApiKey: 'yes' });
  });

  it('keeps real Web Push history and drops only the masked form of it', () => {
    const real = [{ publicKey: 'p', privateKey: 'k' }];
    expect(stripMaskedPresenceFlags('web-push', { vapidKeyHistory: real })).toEqual({
      vapidKeyHistory: real,
    });
    expect(
      stripMaskedPresenceFlags('web-push', {
        vapidKeyHistory: [{ publicKey: 'p', hasPrivateKey: true }],
      })
    ).toEqual({});
  });

  it('passes non-object input through for the schema to reject', () => {
    expect(stripMaskedPresenceFlags('smtp', null)).toBeNull();
    expect(stripMaskedPresenceFlags('smtp', ['x'])).toEqual(['x']);
  });
});
