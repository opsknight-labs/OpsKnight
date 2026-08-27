import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import MobileNav from '@/components/mobile/MobileNav';
import MobileHeader from '@/components/mobile/MobileHeader';
import '@/app/globals.css';
import './mobile.css';
import './mobile-premium.css';
import PullToRefresh from '@/components/mobile/PullToRefresh';
import MobileSwipeNavigator from '@/components/mobile/MobileSwipeNavigator';
import MobileNetworkBanner from '@/components/mobile/MobileNetworkBanner';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { UserAvatarProvider } from '@/contexts/UserAvatarContext';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import MobileBiometricGuard from '@/components/mobile/MobileBiometricGuard';
import { activeIncidentStatuses } from '@/lib/incident-status';

// Force all app routes to be dynamic
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(await getAuthOptions());

  if (!session?.user?.email) {
    redirect('/m/login');
  }

  // Fetch full user details to handle avatar/timezone
  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      avatarUrl: true,
      gender: true,
      timeZone: true,
    },
  });

  if (!dbUser) {
    // Session is stale or user was deleted
    redirect('/api/auth/signout?callbackUrl=/m/login');
  }

  // Fetch incident counts for system status
  let systemStatus: 'ok' | 'warning' | 'danger' = 'ok';

  try {
    const openUrgencyCounts = await prisma.incident.groupBy({
      by: ['urgency'],
      where: {
        status: { in: activeIncidentStatuses() },
      },
      _count: { _all: true },
    });

    let criticalOpenCount = 0;
    let mediumOpenCount = 0;

    for (const entry of openUrgencyCounts) {
      if (entry.urgency === 'HIGH') criticalOpenCount = entry._count._all;
      else if (entry.urgency === 'MEDIUM') mediumOpenCount = entry._count._all;
    }

    if (criticalOpenCount > 0) systemStatus = 'danger';
    else if (mediumOpenCount > 0) systemStatus = 'warning';
  } catch (error) {
    console.error('Failed to load system status for mobile layout', error);
  }

  return (
    <TimezoneProvider initialTimeZone={dbUser.timeZone || 'UTC'}>
      <UserAvatarProvider
        currentUserId={dbUser.id}
        currentUserAvatar={dbUser.avatarUrl}
        currentUserGender={dbUser.gender}
        currentUserName={dbUser.name || 'User'}
      >
        <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
          <MobileBiometricGuard>
            <MobileHeader systemStatus={systemStatus} />
            <div className="mobile-shell" data-status={systemStatus}>
              <main className="mobile-content">
                <MobileNetworkBanner />
                <MobileSwipeNavigator>
                  <PullToRefresh>{children}</PullToRefresh>
                </MobileSwipeNavigator>
              </main>
            </div>
            <MobileNav />
          </MobileBiometricGuard>
        </ThemeProvider>
      </UserAvatarProvider>
    </TimezoneProvider>
  );
}
