'use client';

import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import ActivityTracker from '@/components/auth/ActivityTracker';

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
      {children}
    </SessionProvider>
  );
}
