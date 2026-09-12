import { describe, it, expect } from 'vitest';
import {
  CHAT_PROVIDERS,
  isChatProvider,
  chatProviderLabel,
  chatProviderBadge,
  type ChatProvider,
} from '@/lib/chatops/provider';

describe('ChatProvider', () => {
  it('exposes SLACK and MICROSOFT_TEAMS providers', () => {
    expect([...CHAT_PROVIDERS]).toEqual(['SLACK', 'MICROSOFT_TEAMS']);
  });

  it('guards valid provider values', () => {
    expect(isChatProvider('SLACK')).toBe(true);
    expect(isChatProvider('MICROSOFT_TEAMS')).toBe(true);
    expect(isChatProvider('TEAMS' as string)).toBe(false);
    expect(isChatProvider('slack' as string)).toBe(false);
    expect(isChatProvider(null)).toBe(false);
    expect(isChatProvider(undefined)).toBe(false);
    expect(isChatProvider(42)).toBe(false);
  });

  it('labels providers for display', () => {
    expect(chatProviderLabel('SLACK')).toBe('Slack');
    expect(chatProviderLabel('MICROSOFT_TEAMS')).toBe('Microsoft Teams');
  });

  it('returns stable badge keys', () => {
    const slack: ChatProvider = 'SLACK';
    const teams: ChatProvider = 'MICROSOFT_TEAMS';
    expect(chatProviderBadge(slack)).toBe('SLACK');
    expect(chatProviderBadge(teams)).toBe('MICROSOFT_TEAMS');
    // Badge is suitable as an enum-like tag (no spaces, upper-cased).
    expect(chatProviderBadge(teams)).not.toContain(' ');
  });
});
