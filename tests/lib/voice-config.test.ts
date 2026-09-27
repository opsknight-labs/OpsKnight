import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    notificationProvider: {
      findUnique: mocks.findUnique,
    },
  },
}));

vi.mock('@/lib/encrypted-provider-config', () => ({
  decryptProviderConfig: vi.fn(async (_provider, raw) => raw),
  ProviderDecryptionError: class ProviderDecryptionError extends Error {},
  PROVIDER_ERROR_CODES: { DECRYPTION_FAILED: 'DECRYPTION_FAILED' },
}));

import { getVoiceConfig, isChannelAvailable } from '@/lib/notification-providers';

describe('Voice provider configuration and enabled state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns enabled: false when provider row exists but enabled is false, even if voiceEnabled is true', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-1',
      provider: 'twilio',
      enabled: false, // Administratively disabled
      config: {
        voiceEnabled: true,
        accountSid: 'FAKE_SID_FOR_UNIT_TEST',
        authToken: 'secret_token_value_here',
        fromNumber: '+14155550100',
      },
    });

    const voiceConfig = await getVoiceConfig();
    expect(voiceConfig.enabled).toBe(false);
    expect(voiceConfig.provider).toBeNull();

    const channelAvailable = await isChannelAvailable('VOICE');
    expect(channelAvailable).toBe(false);
  });

  it('returns enabled: false when provider row does not exist', async () => {
    mocks.findUnique.mockResolvedValue(null);

    const voiceConfig = await getVoiceConfig();
    expect(voiceConfig.enabled).toBe(false);
    expect(voiceConfig.provider).toBeNull();
  });

  it('returns enabled: false when voiceEnabled is false, even if provider is enabled', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-1',
      provider: 'twilio',
      enabled: true,
      config: {
        voiceEnabled: false,
        accountSid: 'FAKE_SID_FOR_UNIT_TEST',
        authToken: 'secret_token_value_here',
        fromNumber: '+14155550100',
      },
    });

    const voiceConfig = await getVoiceConfig();
    expect(voiceConfig.enabled).toBe(false);
  });

  it('returns enabled: true only when both provider.enabled and config.voiceEnabled are true with valid credentials', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-1',
      provider: 'twilio',
      enabled: true,
      config: {
        voiceEnabled: true,
        accountSid: 'FAKE_SID_FOR_UNIT_TEST',
        authToken: 'secret_token_value_here',
        fromNumber: '+14155550100',
      },
    });

    const voiceConfig = await getVoiceConfig();
    expect(voiceConfig).toEqual({
      enabled: true,
      provider: 'twilio',
      accountSid: 'FAKE_SID_FOR_UNIT_TEST',
      authToken: 'secret_token_value_here',
      fromNumber: '+14155550100',
    });

    const channelAvailable = await isChannelAvailable('VOICE');
    expect(channelAvailable).toBe(true);
  });
});
