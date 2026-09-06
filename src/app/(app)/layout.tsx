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
import { CAPABILITIES, hasCapability, isAppRole } from '@/lib/authorization';
import { IncidentCreationModalProvider } from '@/contexts/IncidentCreationModalContext';
import CreateIncidentModal from '@/components/incident/CreateIncidentModal';
import BrandLockup from '@/components/layout/BrandLockup';
import SidebarTrigger from '@/components/layout/SidebarTrigger';
import AppHeader from '@/components/layout/AppHeader';
import type { Prisma } from '@prisma/client';
import { RealtimeProvider } from '@/hooks/useRealtime';
import { IncidentAlertProvider, type CriticalIncidentSummary } from '@/contexts/IncidentAlertContext';
import GlobalIncidentBanner from '@/components/layout/GlobalIncidentBanner';

const isNextRedirectError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
};

// Force all app routes to be dynamic - prevents static generation during build
// This is necessary because the app requires database access via middleware/auth
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(await getAuthOptions());

  logger.warn('[App Layout Debug] Session State:', {
    component: 'layout',
    hasSession: !!session,
    hasUser: !!session?.user,
    email: session?.user?.email,
  });

  if (!session?.user?.email) {
    logger.warn('[App Layout] No session or email found', {
      component: 'layout',
      hasSession: !!session,
      hasUser: !!session?.user,
      email: session?.user?.email,
    });
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
    if (userCount === 0) {
      redirect('/setup');
    }
    // Force re-login with error flag to bypass middleware redirect loop
    redirect('/login?error=SessionExpired');
  } else {
    logger.info('[App Layout] Session valid', { email: session.user.email });
  }

  // Verify user still exists in database (handle DB resets)
  let dbUser;
  let dbError: unknown = null;
  try {
    dbUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        role: true,
        name: true,
        email: true,
        timeZone: true,
        avatarUrl: true,
        gender: true,
      },
    });
  } catch (error) {
    dbError = error;
    // Database connection error - allow app to load with session data
    // This prevents complete app failure when DB is temporarily unavailable
    if (!isNextRedirectError(error)) {
      logger.error('[App Layout] Database connection error', { component: 'layout', error });
    }
    dbUser = null;
  }

  if (dbError) {
    return (
      <DatabaseOffline
        errorMessage={dbError instanceof Error ? dbError.message : String(dbError)}
      />
    );
  }

  // Record active session heartbeat (debounced per device)
  if (dbUser?.id) {
    try {
      const { headers } = await import('next/headers');
      const headerList = await headers();
      const userAgent = headerList.get('user-agent') || '';
      const ip =
        headerList.get('x-forwarded-for')?.split(',')[0].trim() ||
        headerList.get('x-real-ip') ||
        '127.0.0.1';
      const { recordSessionHeartbeat } = await import('@/lib/active-sessions');
      void recordSessionHeartbeat({ userId: dbUser.id, userAgent, ip }).catch(() => {});
    } catch {
      // Non-critical background heartbeat
    }
  }

  if (!dbError && !dbUser) {
    // Check if system is uninitialized
    let userCount = 0;
    let verifyUserCountError: unknown = null;
    try {
      userCount = await prisma.user.count();
    } catch (error) {
      if (!isNextRedirectError(error)) {
        logger.error('[App Layout] Failed to verify user count', { component: 'layout', error });
        verifyUserCountError = error;
      }
    }
    if (verifyUserCountError) {
      return (
        <DatabaseOffline
          errorMessage={
            verifyUserCountError instanceof Error
              ? verifyUserCountError.message
              : String(verifyUserCountError)
          }
        />
      );
    }
    if (userCount === 0) {
      redirect('/setup');
    }
    // Rare condition: User deleted or DB reset but others exist
    // Force signout to clear stale session
    redirect('/api/auth/signout?callbackUrl=/login?error=SessionExpired');
  }

  // Fetch latest user data from database to ensure name is always current
  // This ensures name changes reflect immediately in the topbar
  const userName = dbUser?.name || session?.user?.name || null;
  const userEmail = session?.user?.email ?? null;
  const userRole = dbUser?.role || (session?.user as any)?.role || null; // eslint-disable-line @typescript-eslint/no-explicit-any
  const userAvatar = dbUser?.avatarUrl || null;
  const userGender = dbUser?.gender || null;
  const userId = dbUser?.id || 'user';

  const canCreate = isAppRole(userRole) && hasCapability(userRole, CAPABILITIES.OPERATIONS_MANAGE);

  let criticalOpenCount = 0;
  let mediumOpenCount = 0;
  let lowOpenCount = 0;

  try {
    const openUrgencyCounts = await prisma.incident.groupBy({
      by: ['urgency'],
      where: {
        status: { in: activeIncidentStatuses() },
      },
      _count: { _all: true },
    });

    for (const entry of openUrgencyCounts) {
      if (entry.urgency === 'HIGH') criticalOpenCount = entry._count._all;
      else if (entry.urgency === 'MEDIUM') mediumOpenCount = entry._count._all;
      else if (entry.urgency === 'LOW') lowOpenCount = entry._count._all;
    }
  } catch (error) {
    logger.error('[App Layout] Failed to load incident counts', { component: 'layout', error });
  }

  let initialCriticalIncidents: CriticalIncidentSummary[] = [];
  try {
    const isPrivileged = isAppRole(userRole) && hasCapability(userRole, CAPABILITIES.INCIDENT_READ_ALL);
    const whereScope: Prisma.IncidentWhereInput = {
      status: { in: activeIncidentStatuses() },
      OR: [
        { priority: { in: ['P1', 'P2'] } },
        { urgency: 'HIGH' },
      ],
    };
    if (!isPrivileged && dbUser?.id) {
      whereScope.AND = [
        {
          OR: [
            { assigneeId: dbUser.id },
            { service: { team: { members: { some: { userId: dbUser.id } } } } },
          ],
        },
      ];
    }

    const fetched = await prisma.incident.findMany({
      where: whereScope,
      select: {
        id: true,
        title: true,
        status: true,
        urgency: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        acknowledgedAt: true,
        service: {
          select: {
            id: true,
            name: true,
          },
        },
        assignee: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' },
      ],
      take: 5,
    });

    initialCriticalIncidents = fetched.map(inc => ({
      id: inc.id,
      title: inc.title,
      status: inc.status,
      urgency: inc.urgency,
      priority: inc.priority,
      createdAt: inc.createdAt.toISOString(),
      updatedAt: inc.updatedAt?.toISOString() ?? null,
      acknowledgedAt: inc.acknowledgedAt?.toISOString() ?? null,
      service: inc.service ? { id: inc.service.id, name: inc.service.name } : null,
      assignee: inc.assignee ? { id: inc.assignee.id, name: inc.assignee.name ?? null } : null,
    }));
  } catch (error) {
    logger.error('[App Layout] Failed to load initial critical incidents', { component: 'layout', error });
  }

  // Status Logic
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
    statusTone = 'ok'; // Keep green for low, but maybe detailed
    statusLabel = 'Systems Normal';
    statusDetail = `${lowOpenCount} low urgency items`;
  }

  const userTimeZone = dbUser?.timeZone || 'UTC';
  const initialActiveIncidentsCount = criticalOpenCount + mediumOpenCount + lowOpenCount;

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
              <RealtimeProvider>
                <IncidentAlertProvider initialIncidents={initialCriticalIncidents}>
                  <GlobalKeyboardHandlerWrapper />
                  <SkipLinks />
                  <div className="app-shell flex flex-col min-h-screen">
                    <AppHeader>
                      <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
                        <BrandLockup variant="header" />
                        <div className="h-4 w-px bg-slate-800 mx-0.5 sm:mx-1" />
                        <SidebarTrigger />
                        <div className="hidden sm:block">
                          <OperationalStatus
                            tone={statusTone}
                            label={statusLabel}
                            detail={statusDetail}
                            criticalCount={criticalOpenCount}
                            mediumCount={mediumOpenCount}
                            lowCount={lowOpenCount}
                          />
                        </div>
                        <div className="hidden xl:block">
                          <TopbarBreadcrumbs />
                        </div>
                      </div>
                      <div className="hidden md:flex flex-1 items-center justify-center max-w-md mx-auto px-2">
                        <SidebarSearch />
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 ml-auto shrink-0">
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
                    </AppHeader>
                    <div className="flex flex-1 min-h-0 relative pt-14">
                      <Sidebar
                        userName={userName}
                        userEmail={userEmail}
                        userRole={userRole}
                        userAvatar={userAvatar}
                        userGender={userGender}
                        userId={userId}
                        initialActiveCount={initialActiveIncidentsCount}
                      />
                      <div className="content-shell flex-1">
                        <GlobalIncidentBanner />
                        <main id="main-content" className="page-shell">
                          {children}
                        </main>
                      </div>
                    </div>
                  </div>
                  <CreateIncidentModal />
                </IncidentAlertProvider>
              </RealtimeProvider>
            </IncidentCreationModalProvider>
          </SidebarProvider>
        </UserAvatarProvider>
      </TimezoneProvider>
      <SessionTimeoutWarning warningMinutes={5} />
    </AppErrorBoundary>
  );
}
