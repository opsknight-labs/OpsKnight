'use client';

import { SessionProvider } from 'next-auth/react';
import { ThemeProvider, useTheme } from 'next-themes';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { Toaster } from '@/components/ui/shadcn/sonner';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { KeyboardShortcutsProvider } from '@/components/KeyboardShortcutsProvider';
import ChunkLoadErrorHandler from '@/components/ChunkLoadErrorHandler';
import ActivityTracker from '@/components/auth/ActivityTracker';

function ThemeAttributeBridge() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    const effectiveTheme = resolvedTheme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = effectiveTheme;
    root.style.colorScheme = effectiveTheme;

    // Keep browser/PWA chrome aligned with an explicit in-app theme override,
    // not only with the OS media query used during the initial HTML response.
    const themeColor = effectiveTheme === 'dark' ? '#09090b' : '#f8fafc';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = themeColor;
  }, [resolvedTheme]);

  return null;
}

function AppThemeProvider({ children }: { children: React.ReactNode }) {
  // Mobile/PWA follows the user/system theme. Desktop intentionally remains
  // light until the authenticated desktop surface has completed its own dark
  // mode migration. The class attribute is canonical for Tailwind's dark:
  // variant; ThemeAttributeBridge mirrors it to data-theme for legacy CSS that
  // has not yet migrated to semantic utilities.
  const pathname = usePathname();
  const isMobileRoute = pathname?.startsWith('/m');
  const themeProps = isMobileRoute
    ? { defaultTheme: 'system' as const, enableSystem: true }
    : { forcedTheme: 'light' as const, defaultTheme: 'light' as const, enableSystem: false };

  return (
    <ThemeProvider
      attribute="class"
      disableTransitionOnChange
      enableColorScheme
      {...themeProps}
    >
      <ThemeAttributeBridge />
      {children}
    </ThemeProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={true}>
      <ActivityTracker />
      <ChunkLoadErrorHandler />
      <AppThemeProvider>
        <TimezoneProvider>
          <KeyboardShortcutsProvider>{children}</KeyboardShortcutsProvider>
          <Toaster />
        </TimezoneProvider>
      </AppThemeProvider>
    </SessionProvider>
  );
}
