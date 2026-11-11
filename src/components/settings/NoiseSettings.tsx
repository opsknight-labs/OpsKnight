import { logger } from '@/lib/logger';
import { loadNoiseOverview } from '@/lib/notification-noise/loader';
import NoiseSection from '@/components/settings/NoiseSection';
import MobileNoiseCard from '@/components/mobile/MobileNoiseCard';

/**
 * Server entry for the personal "Noise" section. Renders nothing while the Notifications area is off,
 * and never takes the settings page down with it.
 */
export default async function NoiseSettings({
  viewer,
  variant = 'desktop',
}: {
  viewer: { id: string; role: string };
  variant?: 'desktop' | 'mobile';
}) {
  const overview = await loadNoiseOverview(viewer, viewer.id).catch(error => {
    logger.warn('notification_noise.overview_failed', { component: 'notification-noise', error });
    return null;
  });
  if (!overview) return null;
  return variant === 'mobile' ? (
    <MobileNoiseCard overview={overview} />
  ) : (
    <NoiseSection overview={overview} />
  );
}
