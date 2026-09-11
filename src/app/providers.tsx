'use client';

import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from 'next-themes';
import { usePathname } from 'next/navigation';
import { Toaster } from '@/components/ui/shadcn/sonner';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { KeyboardShortcutsProvider } from '@/components/KeyboardShortcutsProvider';
import ChunkLoadErrorHandler from '@/components/ChunkLoadErrorHandler';

function AppThemeProvider({ children }: { children: React.ReactNode }) {
  // Save-feedback PR keeps the existing product theme behavior: mobile routes
  // may follow the system theme, desktop remains forced light. Toast/InlineNotice
  // tokens are dark-capable (see globals.css .dark / --toast-*), but enabling
  // global desktop dark mode is a separate product change that requires a full
  // authenticated-surface audit. Do not broaden scope here.
  const pathname = usePathname();
  const isMobileRoute = pathname?.startsWith('/m');
  const themeProps = isMobileRoute
    ? { defaultTheme: 'system' as const, enableSystem: true }
    : { forcedTheme: 'light' as const, defaultTheme: 'light' as const, enableSystem: false };

  return (
    <ThemeProvider
      attribute="class"
      disableTransitionOnChange
      enableColorScheme={false}
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
