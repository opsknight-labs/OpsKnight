import { describe, expect, it } from 'vitest';
import {
  assertProviderConfigReady,
  notificationProviderConfigSchema,
  notificationProviderConfigurationInput,
} from '@/lib/notifications/provider-schema';

describe('notification provider REST configuration schemas', () => {
  it('accepts only known provider-specific fields and bounds credential inputs', () => {
    expect(
      notificationProviderConfigSchema('resend').safeParse({
        apiKey: 'secret',
        fromEmail: 'alerts@example.com',
      }).success
    ).toBe(true);
    expect(
      notificationProviderConfigSchema('resend').safeParse({
        apiKey: 'secret',
        fromEmail: 'alerts@example.com',
        unexpected: true,
      }).success
    ).toBe(false);
    expect(
      notificationProviderConfigSchema('smtp').safeParse({ password: 'x'.repeat(2049) }).success
    ).toBe(false);
  });

  it('does not accept provider enablement with incomplete credentials', () => {
    expect(() => assertProviderConfigReady('smtp', { host: 'smtp.example.com' })).toThrow(
      /configuration is incomplete/
    );
    expect(() =>
      assertProviderConfigReady('smtp', {
        host: 'smtp.example.com',
        port: 587,
        user: 'mailer',
        password: 'secret',
        fromEmail: 'alerts@example.com',
      })
    ).not.toThrow();
  });

  it('does not accept Web Push private key material in ordinary configuration requests', () => {
    const schema = notificationProviderConfigurationInput();
    expect(
      schema.safeParse({
        provider: 'web-push',
        enabled: true,
        config: {
          vapidPublicKey: 'public',
          vapidPrivateKey: 'private',
          vapidSubject: 'mailto:admin@example.com',
        },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        provider: 'web-push',
        enabled: true,
        config: { vapidPublicKey: 'public', vapidSubject: 'mailto:admin@example.com' },
      }).success
    ).toBe(true);
  });
});
