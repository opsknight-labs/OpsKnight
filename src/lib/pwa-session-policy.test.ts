import { describe, expect, it } from 'vitest';
import { resolveResponderSessionPolicy } from './pwa-session-policy';

describe('responder PWA session policy', () => {
  it('keeps a normal browser on the standard session policy', () => {
    expect(
      resolveResponderSessionPolicy({ displayModeStandalone: false, iosStandalone: false })
    ).toBe('STANDARD');
  });

  it('trusts standards-based standalone PWA display mode', () => {
    expect(
      resolveResponderSessionPolicy({ displayModeStandalone: true, iosStandalone: false })
    ).toBe('TRUSTED_PWA');
  });

  it('trusts iOS home-screen standalone mode', () => {
    expect(
      resolveResponderSessionPolicy({ displayModeStandalone: false, iosStandalone: true })
    ).toBe('TRUSTED_PWA');
  });
});
