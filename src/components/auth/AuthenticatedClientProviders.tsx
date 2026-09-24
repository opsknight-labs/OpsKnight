'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import ActivityTracker from '@/components/auth/ActivityTracker';
import { onSessionExpired } from '@/lib/client-auth-recovery';

function SessionExpirationWatcher() {
  const router = useRouter();

  useEffect(() => {
    return onSessionExpired(targetUrl => {
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
  return (
    <SessionProvider session={initialSession} refetchInterval={0} refetchOnWindowFocus={false}>
      <ActivityTracker />
      <SessionExpirationWatcher />
      {children}
    </SessionProvider>
  );
}
