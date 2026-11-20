// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  ACCOUNT_THEME_SYNC_SCRIPT,
  CHROME_THEME_BOOTSTRAP_SCRIPT,
  FORCE_LIGHT_THEME_SCRIPT,
  THEME_CHROME_COLORS,
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

function run(script: string, attrs: Record<string, string>) {
  const el = document.createElement('script');
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => el });
  try {
    new Function(script)();
  } finally {
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => null });
  }
}
const account = (pref: string) => run(ACCOUNT_THEME_SYNC_SCRIPT, { 'data-theme-pref': pref });
const chrome = () =>
  run(CHROME_THEME_BOOTSTRAP_SCRIPT, { 'data-light-routes': LIGHT_PINNED_PREFIXES.join(',') });

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
    account('dark');

    const root = document.documentElement;
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.colorScheme).toBe('dark');
    expect(document.getElementById('opsknight-runtime-theme-color')?.getAttribute('content')).toBe(
      '#09090b'
    );
  });

  it('resolves System from the OS', () => {
    mockSystemDark(true);
    account('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');

    mockSystemDark(false);
    account('system');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('keeps browser chrome light on pinned routes even when the user prefers dark', () => {
    mockSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.history.replaceState(null, '', '/status/acme');
    chrome();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    window.history.replaceState(null, '', '/incidents');
    chrome();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('still applies the account preference when storage is blocked', () => {
    mockSystemDark(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    account('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(() => chrome()).not.toThrow();
  });

  it('ignores an unknown preference value', () => {
    mockSystemDark(false);
    document.documentElement.className = 'light';
    account('<img src=x>');
    expect(document.documentElement.className).toBe('light');
  });

  it('forces a rewritten light-only surface back to light', () => {
    const root = document.documentElement;
    root.className = 'dark';
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
    document
      .getElementById('opsknight-runtime-theme-color')
      ?.setAttribute('content', THEME_CHROME_COLORS.dark);

    run(FORCE_LIGHT_THEME_SCRIPT, {});

    expect(root.classList.contains('dark')).toBe(false);
    expect(root.classList.contains('light')).toBe(true);
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(document.getElementById('opsknight-runtime-theme-color')?.getAttribute('content')).toBe(
      '#f8fafc'
    );
  });

  it('keeps the inline scripts in sync with the shared constants', () => {
    for (const script of [ACCOUNT_THEME_SYNC_SCRIPT, CHROME_THEME_BOOTSTRAP_SCRIPT]) {
      expect(script).toContain(`"${THEME_STORAGE_KEY}"`);
      expect(script).toContain(THEME_CHROME_COLORS.dark);
      expect(script).toContain(THEME_CHROME_COLORS.light);
    }
  });
});
