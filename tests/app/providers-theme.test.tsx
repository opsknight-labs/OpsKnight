import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import { THEME_STORAGE_KEY } from '@/lib/theme-preference';

const nav = vi.hoisted(() => ({ pathname: '/', segments: [] as string[] }));
const themes = vi.hoisted(() => ({
  forcedTheme: undefined as string | undefined,
  theme: 'system',
  setTheme: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSelectedLayoutSegments: () => nav.segments,
}));
vi.mock('next-themes', () => ({
  ThemeProvider: ({ forcedTheme, children }: { forcedTheme?: string; children: ReactNode }) => {
    themes.forcedTheme = forcedTheme;
    return children;
  },
  useTheme: () => ({ theme: themes.theme, setTheme: themes.setTheme }),
}));
vi.mock('@/hooks/use-effective-theme', () => ({ useEffectiveTheme: () => 'light' }));
vi.mock('@/components/ui/shadcn/sonner', () => ({ Toaster: () => null }));
vi.mock('@/components/ChunkLoadErrorHandler', () => ({ default: () => null }));

function renderAt(pathname: string, segments: string[]) {
  nav.pathname = pathname;
  nav.segments = segments;
  render(<Providers>content</Providers>);
  return themes.forcedTheme;
}

describe('Providers theme forcing', () => {
  beforeEach(() => {
    themes.forcedTheme = undefined;
    themes.theme = 'system';
    themes.setTheme.mockReset();
    localStorage.clear();
  });

  it('pins a custom-domain status page light even though the visible URL is /', () => {
    expect(renderAt('/', ['(public)', 'status', 'acme'])).toBe('light');
  });

  it('strips route groups so a grouped console route is not pinned', () => {
    expect(renderAt('/', ['(app)'])).toBeUndefined();
    expect(renderAt('/incidents/abc', ['(app)', 'incidents', 'abc'])).toBeUndefined();
  });

  it('still pins by the visible pathname', () => {
    expect(renderAt('/login', [])).toBe('light');
  });

  it('re-reads the stored theme when a page is restored from the back/forward cache', () => {
    renderAt('/incidents', ['(app)', 'incidents']);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    });
    expect(themes.setTheme).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(themes.setTheme).toHaveBeenCalledWith('dark');
  });

  it('ignores an unknown stored value on restore', () => {
    renderAt('/incidents', ['(app)', 'incidents']);
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(themes.setTheme).not.toHaveBeenCalled();
  });
});
