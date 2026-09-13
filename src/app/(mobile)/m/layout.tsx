import { redirect } from 'next/navigation';
import MobileNav from '@/components/mobile/MobileNav';
import MobileHeader from '@/components/mobile/MobileHeader';
import '@/app/globals.css';
import './mobile.css';
import './mobile-shell.css';
import PullToRefresh from '@/components/mobile/PullToRefresh';
import MobileSwipeNavigator from '@/components/mobile/MobileSwipeNavigator';
import MobileNetworkBanner from '@/components/mobile/MobileNetworkBanner';
import MobilePwaCoordinator from '@/components/mobile/MobilePwaCoordinator';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { UserAvatarProvider } from '@/contexts/UserAvatarContext';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import MobileBiometricGuard from '@/components/mobile/MobileBiometricGuard';
import { getAppShellContext } from '@/lib/app-shell-context';
import { RealtimeProvider } from '@/hooks/useRealtime';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { MOBILE_PRINCIPAL_MARKER_ID } from '@/lib/mobile-principal';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const requestContext = await getRequestActorContext();
  if (!requestContext) redirect('/login?callbackUrl=/m');

  const shell = await getAppShellContext(requestContext);
  if (!shell) redirect('/api/auth/signout?callbackUrl=/login?error=SessionExpired');

  try {
    const { headers } = await import('next/headers');
    const headerList = await headers();
    const userAgent = headerList.get('user-agent') || '';
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0].trim() ||
      headerList.get('x-real-ip') ||
      '127.0.0.1';
    const { recordSessionHeartbeat } = await import('@/lib/active-sessions');
    void recordSessionHeartbeat({ userId: shell.user.id, userAgent, ip }).catch(() => {});
  } catch {}

  const authGeneration = String(shell.user.tokenVersion);
  return (
    <TimezoneProvider initialTimeZone={shell.user.timeZone || 'UTC'}>
      <UserAvatarProvider
        currentUserId={shell.user.id}
        currentUserAvatar={shell.user.avatarUrl}
        currentUserGender={shell.user.gender}
        currentUserName={shell.user.name || 'User'}
      >
        <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem>
          <RealtimeProvider>
            <MobileBiometricGuard>
              <div
                id={MOBILE_PRINCIPAL_MARKER_ID}
                data-principal-id={shell.user.id}
                data-auth-generation={authGeneration}
                hidden
                aria-hidden="true"
              />
              <MobileHeader systemStatus={shell.systemStatus} />
              <div className="mobile-shell" data-status={shell.systemStatus}>
                <main id="main-content" className="mobile-content">
                  <MobileNetworkBanner />
                  <MobileSwipeNavigator>
                    <PullToRefresh>{children}</PullToRefresh>
                  </MobileSwipeNavigator>
                </main>
              </div>
              <MobileNav />
              <MobilePwaCoordinator
                principalId={shell.user.id}
                authGeneration={authGeneration}
              />
            </MobileBiometricGuard>
          </RealtimeProvider>
        </ThemeProvider>
      </UserAvatarProvider>
    </TimezoneProvider>
  );
}
