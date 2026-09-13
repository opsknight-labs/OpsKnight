import { describe, expect, it } from 'vitest';
import { __isBotSigningKeyEndorsedForTests } from '@/lib/microsoft-teams/auth';

describe('Microsoft Teams Bot Connector signing-key endorsements', () => {
  const jwks = {
    keys: [
      { kid: 'teams-key', endorsements: ['msteams', 'webchat'] },
      { kid: 'webchat-key', endorsements: ['webchat'] },
    ],
  };

  it('accepts only the channel endorsed by the key that verified the JWT', () => {
    expect(__isBotSigningKeyEndorsedForTests(jwks, 'teams-key', 'msteams')).toBe(true);
    expect(__isBotSigningKeyEndorsedForTests(jwks, 'webchat-key', 'msteams')).toBe(false);
  });

  it('fails closed for missing keys, channel IDs, or endorsement metadata', () => {
    expect(__isBotSigningKeyEndorsedForTests(jwks, 'missing', 'msteams')).toBe(false);
    expect(__isBotSigningKeyEndorsedForTests(jwks, 'teams-key', '')).toBe(false);
    expect(__isBotSigningKeyEndorsedForTests({ keys: [{ kid: 'teams-key' }] }, 'teams-key', 'msteams')).toBe(false);
  });
});
