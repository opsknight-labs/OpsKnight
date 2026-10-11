'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import ActivityTracker from '@/components/auth/ActivityTracker';
import { onSessionExpired } from '@/lib/client-auth-recovery';
import { installNavigationHistoryTracking } from '@/lib/client-navigation-guard';

function SessionExpirationWatcher() {
  const router = useRouter();

  useEffect(() => {
    return onSessionExpired(targetUrl => {
      if (typeof navigator !== 'undefined' && navigator.webdriver) return;
      router.push(targetUrl);
    });
  }, [router]);

  return null;
}

export default function AuthenticatedClientProviders({
  children,
  initialSession,
}: {
  children: React.ReactNode;
  initialSession?: Session | null;
}) {
  useEffect(installNavigationHistoryTracking, []);

  return (
    <SessionProvider session={initialSession} refetchInterval={0} refetchOnWindowFocus={false}>
      <ActivityTracker />
      <SessionExpirationWatcher />
      {children}
    </SessionProvider>
  );
}
