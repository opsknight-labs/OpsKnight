import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { getRealtimeChangeGeneration } from '@/lib/realtime-change-control-plane';
import { getLiveDashboardSnapshot } from '@/lib/dashboard/live-incidents';
import { liveQueryFromParams } from '@/lib/dashboard/live-incidents-shared';
import { logger } from '@/lib/logger';
import { LiveDashboardProvider } from '@/components/dashboard/live/LiveDashboardProvider';
import LiveWallboard from '@/components/dashboard/live/LiveWallboard';

export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Incident Wallboard · OpsKnight',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#050507', colorScheme: 'dark' };

/**
 * Always-on incident wallboard for office TVs and NOC screens.
 * Supports the live view/facet URL parameters (e.g. ?lteam=<id>&cycle=off&scale=1.25).
 */
export default async function WallboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const requestContext = await getRequestActorContext();
  if (!requestContext) redirect('/login?error=SessionExpired&callbackUrl=%2Fwallboard');
  const { actor, user } = requestContext;

  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string' && value.length > 0) urlParams.set(key, value);
  }
  const generation = await getRealtimeChangeGeneration().catch(() => null);
  const snapshot = await getLiveDashboardSnapshot(actor, liveQueryFromParams(urlParams), {
    generation,
  }).catch(error => {
    logger.warn('wallboard.live.initial_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  return (
    <LiveDashboardProvider initialSnapshot={snapshot} currentUserId={user.id} persistQuery={false}>
      <LiveWallboard timeZone={user.timeZone || 'UTC'} />
    </LiveDashboardProvider>
  );
}
