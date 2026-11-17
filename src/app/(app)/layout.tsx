import { Suspense } from 'react';
import prisma from '@/lib/prisma';
import OperationalStatus from '@/components/OperationalStatus';
import { redirect } from 'next/navigation';
import { forcedSignOutUrl } from '@/lib/app-routes';

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
import LegalSourceNotice from '@/components/LegalSourceNotice';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { UserAvatarProvider } from '@/contexts/UserAvatarContext';
import { logger } from '@/lib/logger';
import SessionTimeoutWarning from '@/components/auth/SessionTimeoutWarning';
import { CAPABILITIES, hasCapability, isAppRole } from '@/lib/authorization';
import { IncidentCreationModalProvider } from '@/contexts/IncidentCreationModalContext';
import CreateIncidentModal from '@/components/incident/CreateIncidentModal';
import BrandLockup from '@/components/layout/BrandLockup';
import SidebarTrigger from '@/components/layout/SidebarTrigger';
import AppHeader from '@/components/layout/AppHeader';
import { RouteAwareRealtimeProvider } from '@/hooks/useRealtime';
import { IncidentAlertProvider } from '@/contexts/IncidentAlertContext';
import GlobalIncidentBanner from '@/components/layout/GlobalIncidentBanner';
import ContentScrollReset from '@/components/layout/ContentScrollReset';
import ConnectionIndicator from '@/components/layout/ConnectionIndicator';
import ListReturnTracker from '@/components/layout/ListReturnTracker';
import { getAppShellContext, type AppShellContext } from '@/lib/app-shell-context';
import { getRequestActorContext } from '@/lib/request-actor-context';
import AuthenticatedClientProviders from '@/components/auth/AuthenticatedClientProviders';
import { AccessProvider } from '@/components/access/AccessProvider';
import ElevatedAccessBanner from '@/components/access/ElevatedAccessBanner';
import { getAccessSnapshot } from '@/lib/access/server';
import AccountThemeSync from '@/components/theme/AccountThemeSync';

const isNextRedirectError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const requestContext = await getRequestActorContext();

  if (!requestContext) {
    logger.warn('[App Layout] No authenticated actor context', { component: 'layout' });
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

  let shell: AppShellContext | null = null;
  let shellError: unknown = null;
  try {
    shell = await getAppShellContext(requestContext);
  } catch (error) {
    if (!isNextRedirectError(error)) {
      shellError = error;
      logger.error('[App Layout] Failed to load shell context', { component: 'layout', error });
    } else {
      throw error;
    }
  }
  if (shellError) {
    return (
      <DatabaseOffline
        errorMessage={shellError instanceof Error ? shellError.message : String(shellError)}
      />
    );
  }
  if (!shell) redirect(forcedSignOutUrl('desktop', { error: 'SessionExpired' }));
  const activeShell: AppShellContext = shell;

  const userName = activeShell.user.name;
  const userEmail = activeShell.user.email;
  const userRole = activeShell.user.role;
  const userAvatar = activeShell.user.avatarUrl;
  const userGender = activeShell.user.gender;
  const userId = activeShell.user.id;
  const userTimeZone = activeShell.user.timeZone || 'UTC';
  const access = await getAccessSnapshot();
  const canCreate = access
    ? access.capabilities.includes(CAPABILITIES.OPERATIONS_MANAGE)
    : isAppRole(userRole) && hasCapability(userRole, CAPABILITIES.OPERATIONS_MANAGE);

  return (
    <AuthenticatedClientProviders initialSession={requestContext.session}>
      <AccountThemeSync preference={activeShell.user.themePreference} />
      <AccessProvider snapshot={access}>
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
                  <RouteAwareRealtimeProvider>
                    <IncidentAlertProvider>
                      <GlobalKeyboardHandlerWrapper />
                      <Suspense fallback={null}>
                        <ListReturnTracker />
                      </Suspense>
                      <SkipLinks />
                      <div className="app-shell flex min-h-screen flex-col">
                        <AppHeader>
                          {/* Only the breadcrumbs give way when the bar is tight. */}
                          <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3 lg:shrink">
                            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                              <BrandLockup variant="header" />
                              <div className="mx-0.5 h-4 w-px bg-slate-800 sm:mx-1" />
                              <SidebarTrigger />
                              <div className="hidden sm:block">
                                <OperationalStatus
                                  tone={activeShell.systemStatus}
                                  label={activeShell.statusLabel}
                                  detail={activeShell.statusDetail}
                                  criticalCount={activeShell.incidentCounts.high}
                                  mediumCount={activeShell.incidentCounts.medium}
                                  lowCount={activeShell.incidentCounts.low}
                                />
                              </div>
                            </div>
                            <div className="-m-1 hidden min-w-0 overflow-hidden p-1 lg:block">
                              <TopbarBreadcrumbs />
                            </div>
                          </div>
                          <div className="mx-auto hidden min-w-[10rem] max-w-md flex-1 items-center justify-center px-2 md:flex">
                            <SidebarSearch role={userRole} />
                          </div>
                          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
                            <ConnectionIndicator />
                            <TopbarNotifications />
                            <QuickActions canCreate={canCreate} />
                            <TopbarUserMenu
                              name={userName}
                              email={userEmail}
                              role={userRole}
                              avatarUrl={userAvatar}
                              gender={userGender}
                              userId={userId}
                              legalNotice={<LegalSourceNotice />}
                            />
                          </div>
                        </AppHeader>
                        <div className="relative flex min-h-0 flex-1 pt-14">
                          <Sidebar
                            userName={userName}
                            userEmail={userEmail}
                            userRole={userRole}
                            userAvatar={userAvatar}
                            userGender={userGender}
                            userId={userId}
                            initialActiveCount={activeShell.incidentCounts.active}
                            initialStatusPages={activeShell.statusPages}
                            initialIsStatusPageAdmin={activeShell.isStatusPageAdmin}
                          />
                          <div className="content-shell flex-1">
                            <ContentScrollReset />
                            <ElevatedAccessBanner />
                            <GlobalIncidentBanner />
                            <main
                              id="main-content"
                              tabIndex={-1}
                              className="page-shell focus:outline-none"
                            >
                              {children}
                            </main>
                          </div>
                        </div>
                      </div>
                      <CreateIncidentModal />
                    </IncidentAlertProvider>
                  </RouteAwareRealtimeProvider>
                </IncidentCreationModalProvider>
              </SidebarProvider>
            </UserAvatarProvider>
          </TimezoneProvider>
          <SessionTimeoutWarning warningMinutes={5} />
        </AppErrorBoundary>
      </AccessProvider>
    </AuthenticatedClientProviders>
  );
}
