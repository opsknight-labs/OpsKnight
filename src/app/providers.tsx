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
  }, [resolvedTheme]);

  return null;
}

function AppThemeProvider({ children }: { children: React.ReactNode }) {
  // Mobile/PWA follows the user/system theme. Desktop intentionally remains
  // light until the authenticated desktop surface has completed its own dark
  // mode migration. The class attribute is canonical for Tailwind's dark:
  // variant; ThemeAttributeBridge mirrors it to data-theme for legacy CSS.
  //
  // Browser theme-color metadata remains declaratively owned by Next in the
  // root layout. Never remove/create framework-owned <head> nodes from effects:
  // doing so can invalidate React's reconciliation bookkeeping during navigation.
  const pathname = usePathname();
  const isMobileRoute = pathname?.startsWith('/m');
  const themeProps = isMobileRoute
    ? { defaultTheme: 'system' as const, enableSystem: true }
    : { forcedTheme: 'light' as const, defaultTheme: 'light' as const, enableSystem: false };

  return (
    <ThemeProvider attribute="class" disableTransitionOnChange enableColorScheme {...themeProps}>
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
