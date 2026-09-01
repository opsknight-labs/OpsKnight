import prisma from '@/lib/prisma';
import OperationalStatus from '@/components/OperationalStatus';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';

import Sidebar from '@/components/Sidebar';
import DatabaseOffline from '@/components/DatabaseOffline';

import TopbarUserMenu from '@/components/TopbarUserMenu';
import SidebarSearch from '@/components/SidebarSearch';
import QuickActions from '@/components/QuickActions';
import TopbarNotifications from '@/components/TopbarNotifications';
import TopbarBreadcrumbs from '@/components/TopbarBreadcrumbs';
import GlobalKeyboardHandlerWrapper from '@/components/GlobalKeyboardHandlerWrapper';
import AppErrorBoundary from './error-boundary';
import SkipLinks from '@/components/SkipLinks';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { UserAvatarProvider } from '@/contexts/UserAvatarContext';
import { logger } from '@/lib/logger';
import SessionTimeoutWarning from '@/components/auth/SessionTimeoutWarning';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { IncidentCreationModalProvider } from '@/contexts/IncidentCreationModalContext';
import CreateIncidentModal from '@/components/incident/CreateIncidentModal';
import { getCurrentUser } from '@/lib/rbac';
import { resolveUserActor } from '@/lib/authorization-actors';
import { incidentReadWhere } from '@/lib/authorization-filters';

const isNextRedirectError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Keep the lightweight session lookup only for setup/offline routing. Protected identity,
  // role, status and tokenVersion are resolved through getCurrentUser below.
  const session = await getServerSession(await getAuthOptions());

  if (!session?.user?.id && !session?.user?.email) {
    let userCount = 0;
    let userCountError: unknown = null;
    try {
      userCount = await prisma.user.count();
    } catch (error) {
      if (!isNextRedirectError(error)) {
        logger.error('[App Layout] Failed to check user count', { component: 'layout', error });
        userCountError = error;
      }
    }
    if (userCountError) {
      return (
        <DatabaseOffline
          errorMessage={
            userCountError instanceof Error ? userCountError.message : String(userCountError)
          }
        />
      );
    }
    if (userCount === 0) redirect('/setup');
    redirect('/login?error=SessionExpired');
  }

  let dbUser;
  let dbError: unknown = null;
  try {
    dbUser = await getCurrentUser();
  } catch (error) {
    dbError = error;
  }

  if (dbError || !dbUser) {
    let databaseReachable = true;
    let userCount = 0;
    try {
      userCount = await prisma.user.count();
    } catch (error) {
      databaseReachable = false;
      if (!isNextRedirectError(error)) {
        logger.error('[App Layout] Database connection error', { component: 'layout', error });
      }
      return (
        <DatabaseOffline errorMessage={error instanceof Error ? error.message : String(error)} />
      );
    }

    if (databaseReachable && userCount === 0) redirect('/setup');
    redirect('/api/auth/signout?callbackUrl=/login?error=SessionExpired');
  }

  const userName = dbUser.name || null;
  const userEmail = dbUser.email;
  const userRole = dbUser.role;
  const userAvatar = dbUser.avatarUrl || null;
  const userGender = dbUser.gender || null;
  const userId = dbUser.id;
  const canCreate = hasCapability(userRole, CAPABILITIES.OPERATIONS_MANAGE);

  let criticalOpenCount = 0;
  let mediumOpenCount = 0;
  let lowOpenCount = 0;

  try {
    const actor = await resolveUserActor(dbUser.id);
    if (actor) {
      const openUrgencyCounts = await prisma.incident.groupBy({
        by: ['urgency'],
        where: {
          status: { in: activeIncidentStatuses() },
          ...incidentReadWhere(actor),
        },
        _count: { _all: true },
      });

      for (const entry of openUrgencyCounts) {
        if (entry.urgency === 'HIGH') criticalOpenCount = entry._count._all;
        else if (entry.urgency === 'MEDIUM') mediumOpenCount = entry._count._all;
        else if (entry.urgency === 'LOW') lowOpenCount = entry._count._all;
      }
    }
  } catch (error) {
    logger.error('[App Layout] Failed to load incident counts', { component: 'layout', error });
  }

  let statusTone: 'ok' | 'warning' | 'danger' = 'ok';
  let statusLabel = 'Green Corridor';
  let statusDetail = 'All systems fully operational';

  if (criticalOpenCount > 0) {
    statusTone = 'danger';
    statusLabel = 'Red Alert';
    statusDetail = `${criticalOpenCount} critical incidents active`;
  } else if (mediumOpenCount > 0) {
    statusTone = 'warning';
    statusLabel = 'Yellow Alert';
    statusDetail = `${mediumOpenCount} warning signs detected`;
  } else if (lowOpenCount > 0) {
    statusTone = 'ok';
    statusLabel = 'Systems Normal';
    statusDetail = `${lowOpenCount} low urgency items`;
  }

  const userTimeZone = dbUser.timeZone || 'UTC';

  return (
    <AppErrorBoundary>
      <TimezoneProvider initialTimeZone={userTimeZone}>
        <UserAvatarProvider
          currentUserId={userId}
          currentUserAvatar={userAvatar}
          currentUserGender={userGender}
          currentUserName={userName}
        >
          <SidebarProvider>
            <IncidentCreationModalProvider>
              <GlobalKeyboardHandlerWrapper />
              <SkipLinks />
              <div className="app-shell">
                <Sidebar
                  userName={userName}
                  userEmail={userEmail}
                  userRole={userRole}
                  userAvatar={userAvatar}
                  userGender={userGender}
                  userId={userId}
                />
                <div className="content-shell">
                  <header className="fixed top-0 right-0 left-[var(--sidebar-width)] z-30 flex h-14 items-center gap-3 border-b bg-background px-4">
                    <div className="flex items-center gap-4">
                      <OperationalStatus
                        tone={statusTone}
                        label={statusLabel}
                        detail={statusDetail}
                        criticalCount={criticalOpenCount}
                        mediumCount={mediumOpenCount}
                        lowCount={lowOpenCount}
                      />
                      <TopbarBreadcrumbs />
                    </div>
                    <div className="flex flex-1 items-center justify-center px-4">
                      <SidebarSearch />
                    </div>
                    <div className="flex items-center gap-4 ml-auto">
                      <TopbarNotifications />
                      <QuickActions canCreate={canCreate} />
                      <TopbarUserMenu
                        name={userName}
                        email={userEmail}
                        role={userRole}
                        avatarUrl={userAvatar}
                        gender={userGender}
                        userId={userId}
                      />
                    </div>
                  </header>
                  <main id="main-content" className="page-shell pt-14">
                    {children}
                  </main>
                </div>
              </div>
              <CreateIncidentModal />
            </IncidentCreationModalProvider>
          </SidebarProvider>
        </UserAvatarProvider>
      </TimezoneProvider>
      <SessionTimeoutWarning warningMinutes={5} />
    </AppErrorBoundary>
  );
}
