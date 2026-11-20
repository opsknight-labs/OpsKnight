'use client';

import { ThemeProvider, useTheme } from 'next-themes';
import { usePathname, useSelectedLayoutSegments } from 'next/navigation';
import { useEffect } from 'react';
import { Toaster } from '@/components/ui/shadcn/sonner';
import ChunkLoadErrorHandler from '@/components/ChunkLoadErrorHandler';
import { useEffectiveTheme } from '@/hooks/use-effective-theme';
import { THEME_CHROME_COLORS, THEME_STORAGE_KEY, isThemeChoice } from '@/lib/theme-preference';
import { isLightPinnedRoute } from '@/lib/theme-routes';

// In React 19 / Next.js 16, next-themes renders an inline <script> tag for noflash theme
// initialization which triggers a harmless development console warning.
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Encountered a script tag while rendering React component')
    ) {
      return;
    }
    origError(...args);
  };
}

function ThemeAttributeBridge() {
  const effectiveTheme = useEffectiveTheme();
  const { theme, setTheme } = useTheme();

  // Pages restored from the back/forward cache missed any `storage` events, so a
  // theme changed in another tab meanwhile would not show. Re-read it on restore.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (isThemeChoice(stored) && stored !== theme) setTheme(stored);
      } catch {
        // Storage can be blocked; the painted theme stays as it was.
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [theme, setTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = effectiveTheme;
    root.style.colorScheme = effectiveTheme;

    // This node is declared once by RootLayout and is exclusively reserved for
    // the runtime browser-chrome color. Update its content only; never remove,
    // replace, or create framework-owned head nodes from a client effect.
    // Keep browser/PWA chrome aligned with an explicit in-app theme override,
    // not only with the OS media query used during the initial HTML response.
    const nextThemeColor =
      effectiveTheme === 'dark' ? THEME_CHROME_COLORS.dark : THEME_CHROME_COLORS.light;
    const runtimeThemeColor = document.getElementById('opsknight-runtime-theme-color');
    if (runtimeThemeColor instanceof HTMLMetaElement) {
      runtimeThemeColor.content = nextThemeColor;
    } else {
      // Fallback path retained for contract compatibility: query the canonical
      // meta[name="theme-color"] node when the runtime node is absent.
      const fallbackThemeColor = document.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]'
      );
      if (fallbackThemeColor) fallbackThemeColor.content = nextThemeColor;
    }
  }, [effectiveTheme]);

  return null;
}

function AppThemeProvider({ children }: { children: React.ReactNode }) {
  // The console and mobile app follow the user's appearance preference
  // (System by default). Public and pre-sign-in pages stay light; see
  // isLightPinnedRoute. The class attribute is canonical for Tailwind's dark:
  // variant; ThemeAttributeBridge mirrors it to data-theme for legacy CSS.
  const pathname = usePathname();
  // Middleware rewrites (custom status domains) keep the visible URL at `/`;
  // the selected segments reflect the route actually rendered.
  const renderedPath = `/${useSelectedLayoutSegments()
    .filter(segment => !segment.startsWith('('))
    .join('/')}`;
  const forcedTheme =
    isLightPinnedRoute(pathname) || isLightPinnedRoute(renderedPath)
      ? ('light' as const)
      : undefined;

  return (
    <ThemeProvider
      attribute="class"
      storageKey={THEME_STORAGE_KEY}
      defaultTheme="system"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
      forcedTheme={forcedTheme}
    >
      <ThemeAttributeBridge />
      {children}
    </ThemeProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChunkLoadErrorHandler />
      <AppThemeProvider>
        {children}
        <Toaster />
      </AppThemeProvider>
    </>
  );
}
