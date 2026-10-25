import { redirect } from 'next/navigation';
import { getRequestActorContext } from '@/lib/request-actor-context';
import AuthenticatedClientProviders from '@/components/auth/AuthenticatedClientProviders';
import { TimezoneProvider } from '@/contexts/TimezoneContext';
import { RealtimeProvider } from '@/hooks/useRealtime';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Chrome-free shell for always-on displays (office TVs, NOC screens). No sidebar, top bar or
 * global banners: the page owns the entire viewport, so fullscreen shows only the board.
 */
export default async function KioskLayout({ children }: { children: React.ReactNode }) {
  const requestContext = await getRequestActorContext();
  if (!requestContext) redirect('/login?error=SessionExpired&callbackUrl=%2Fwallboard');

  return (
    <AuthenticatedClientProviders initialSession={requestContext.session}>
      <TimezoneProvider initialTimeZone={requestContext.user.timeZone || 'UTC'}>
        <RealtimeProvider>{children}</RealtimeProvider>
      </TimezoneProvider>
    </AuthenticatedClientProviders>
  );
}
