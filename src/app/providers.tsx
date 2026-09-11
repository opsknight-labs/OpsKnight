'use client';

import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from 'next-themes';
import { usePathname } from 'next/navigation';
import { Toaster } from '@/components/ui/shadcn/sonner';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { KeyboardShortcutsProvider } from '@/components/KeyboardShortcutsProvider';
import ChunkLoadErrorHandler from '@/components/ChunkLoadErrorHandler';

function AppThemeProvider({ children }: { children: React.ReactNode }) {
  // Enterprise contract: Light / Dark / System on all surfaces. next-themes
  // persists the resolved choice in localStorage; desktop no longer forces light.
  const pathname = usePathname();
  const isMobileRoute = pathname?.startsWith('/m');

  // Keep the prop shape stable to avoid remount churn on navigation.
  const themeProps = isMobileRoute
    ? { defaultTheme: 'system' as const, enableSystem: true }
    : { defaultTheme: 'system' as const, enableSystem: true };

  return (
    <ThemeProvider
      attribute="class"
      disableTransitionOnChange
      enableColorScheme={true}
      {...themeProps}
    >
      {children}
    </ThemeProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={300} refetchOnWindowFocus={true}>
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
