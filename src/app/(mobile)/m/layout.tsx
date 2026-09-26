import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import MobileNav from '@/components/mobile/MobileNav';
import { appRoutes, forcedSignOutUrl } from '@/lib/app-routes';
import MobileHeader from '@/components/mobile/MobileHeader';
import '@/styles/pages/mobile.css';
import './mobile-shell.css';
import PullToRefresh from '@/components/mobile/PullToRefresh';
import MobileSwipeNavigator from '@/components/mobile/MobileSwipeNavigator';
import MobileNetworkBanner from '@/components/mobile/MobileNetworkBanner';
import MobilePwaCoordinator from '@/components/mobile/MobilePwaCoordinator';
import MobileRealtimeInvalidator from '@/components/mobile/MobileRealtimeInvalidator';
import { MobileRefreshEpochProvider } from '@/components/mobile/MobileRefreshContext';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { UserAvatarProvider } from '@/contexts/UserAvatarContext';
import MobileBiometricGuard from '@/components/mobile/MobileBiometricGuard';
import { getAppShellContext } from '@/lib/app-shell-context';
import { RealtimeProvider } from '@/hooks/useRealtime';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { MOBILE_PRINCIPAL_MARKER_ID } from '@/lib/mobile-principal';
import AuthenticatedClientProviders from '@/components/auth/AuthenticatedClientProviders';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const requestContext = await getRequestActorContext();
  if (!requestContext) redirect(appRoutes.login('mobile', '/m'));

  const shell = await getAppShellContext(requestContext);
  if (!shell) redirect(forcedSignOutUrl('mobile', { error: 'SessionExpired', callbackUrl: '/m' }));

  const authGeneration = String(shell.user.tokenVersion);
  const refreshEpoch = randomUUID();

  return (
    <AuthenticatedClientProviders initialSession={requestContext.session}>
      <TimezoneProvider initialTimeZone={shell.user.timeZone || 'UTC'}>
        <UserAvatarProvider
          currentUserId={shell.user.id}
          currentUserAvatar={shell.user.avatarUrl}
          currentUserGender={shell.user.gender}
          currentUserName={shell.user.name || 'User'}
        >
          <RealtimeProvider>
            <MobileRefreshEpochProvider epoch={refreshEpoch}>
              <MobileBiometricGuard>
                <div className="mobile-app" data-system-status={shell.systemStatus}>
                  <div
                    id={MOBILE_PRINCIPAL_MARKER_ID}
                    data-principal-id={shell.user.id}
                    data-auth-generation={authGeneration}
                    hidden
                    aria-hidden="true"
                  />
                  <MobileHeader
                    systemStatus={shell.systemStatus}
                    canCreateIncident={shell.accessContext.canOperate}
                  />
                  <main id="main-content" className="mobile-content">
                    <MobileNetworkBanner />
                    <MobileSwipeNavigator>
                      <PullToRefresh>{children}</PullToRefresh>
                    </MobileSwipeNavigator>
                  </main>
                  <MobileNav />
                  <MobilePwaCoordinator
                    principalId={shell.user.id}
                    authGeneration={authGeneration}
                  />
                  <MobileRealtimeInvalidator />
                </div>
              </MobileBiometricGuard>
            </MobileRefreshEpochProvider>
          </RealtimeProvider>
        </UserAvatarProvider>
      </TimezoneProvider>
    </AuthenticatedClientProviders>
  );
}
