// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  accountThemeSyncScript,
  chromeThemeBootstrapScript,
  preferenceFromThemeChoice,
  themeChoiceFromPreference,
} from '@/lib/theme-preference';
import { LIGHT_PINNED_PREFIXES, isLightPinnedRoute } from '@/lib/theme-routes';

function mockSystemDark(dark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function run(script: string) {
  new Function(script)();
}

describe('theme preference mapping', () => {
  it('round-trips every account preference', () => {
    for (const pref of ['SYSTEM', 'LIGHT', 'DARK'] as const) {
      expect(preferenceFromThemeChoice(themeChoiceFromPreference(pref))).toBe(pref);
    }
    expect(themeChoiceFromPreference(null)).toBe('system');
  });
});

describe('light-pinned routes', () => {
  it('pins public and pre-sign-in pages but not the console or mobile app', () => {
    expect(isLightPinnedRoute('/status/acme')).toBe(true);
    expect(isLightPinnedRoute('/login')).toBe(true);
    expect(isLightPinnedRoute('/oauth/mcp/consent')).toBe(true);
    expect(isLightPinnedRoute('/')).toBe(false);
    expect(isLightPinnedRoute('/incidents/abc')).toBe(false);
    expect(isLightPinnedRoute('/m/login')).toBe(false);
    expect(isLightPinnedRoute('/statuses')).toBe(false);
  });
});

describe('pre-paint scripts', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.head.innerHTML =
      '<meta id="opsknight-runtime-theme-color" name="theme-color" content="#f8fafc">';
  });
  afterEach(() => vi.restoreAllMocks());

  it('applies a preference saved on another device before paint', () => {
    mockSystemDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run(accountThemeSyncScript('dark'));

    const root = document.documentElement;
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.colorScheme).toBe('dark');
    expect(document.getElementById('opsknight-runtime-theme-color')?.getAttribute('content')).toBe(
      '#09090b'
    );
  });

  it('resolves System from the OS and leaves a matching stored value untouched', () => {
    mockSystemDark(true);
    run(accountThemeSyncScript('system'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    document.documentElement.className = 'light';
    run(accountThemeSyncScript('system'));
    expect(document.documentElement.className).toBe('light');
  });

  it('keeps browser chrome light on pinned routes even when the user prefers dark', () => {
    mockSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.history.replaceState(null, '', '/status/acme');
    run(chromeThemeBootstrapScript(LIGHT_PINNED_PREFIXES));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    window.history.replaceState(null, '', '/incidents');
    run(chromeThemeBootstrapScript(LIGHT_PINNED_PREFIXES));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('survives blocked storage', () => {
    mockSystemDark(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => run(accountThemeSyncScript('dark'))).not.toThrow();
    expect(() => run(chromeThemeBootstrapScript(LIGHT_PINNED_PREFIXES))).not.toThrow();
  });
});
