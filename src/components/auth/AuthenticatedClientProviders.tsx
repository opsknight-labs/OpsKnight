'use client';

import { SessionProvider } from 'next-auth/react';
import ActivityTracker from '@/components/auth/ActivityTracker';

export default function AuthenticatedClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus>
      <ActivityTracker />
      {children}
    </SessionProvider>
  );
}
