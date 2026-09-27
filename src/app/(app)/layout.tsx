import prisma from '@/lib/prisma';
import OperationalStatus from '@/components/OperationalStatus';
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
import { RealtimeProvider } from '@/hooks/useRealtime';
import { IncidentAlertProvider } from '@/contexts/IncidentAlertContext';
import GlobalIncidentBanner from '@/components/layout/GlobalIncidentBanner';
import ContentScrollReset from '@/components/layout/ContentScrollReset';
import { getAppShellContext, type AppShellContext } from '@/lib/app-shell-context';
import { getRequestActorContext } from '@/lib/request-actor-context';
import AuthenticatedClientProviders from '@/components/auth/AuthenticatedClientProviders';

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
  if (!shell) redirect('/api/auth/signout?callbackUrl=/login?error=SessionExpired');
  const activeShell: AppShellContext = shell;

  const userName = activeShell.user.name;
  const userEmail = activeShell.user.email;
  const userRole = activeShell.user.role;
  const userAvatar = activeShell.user.avatarUrl;
  const userGender = activeShell.user.gender;
  const userId = activeShell.user.id;
  const userTimeZone = activeShell.user.timeZone || 'UTC';
  const canCreate = isAppRole(userRole) && hasCapability(userRole, CAPABILITIES.OPERATIONS_MANAGE);

  return (
    <AuthenticatedClientProviders initialSession={requestContext.session}>
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
                  <IncidentAlertProvider>
                    <GlobalKeyboardHandlerWrapper />
                    <SkipLinks />
                    <div className="app-shell flex min-h-screen flex-col">
                      <AppHeader>
                        <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
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
                          <div className="hidden xl:block">
                            <TopbarBreadcrumbs />
                          </div>
                        </div>
                        <div className="mx-auto hidden max-w-md flex-1 items-center justify-center px-2 md:flex">
                          <SidebarSearch />
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
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
    </AuthenticatedClientProviders>
  );
}
