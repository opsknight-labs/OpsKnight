import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { resolveUserActor } from '@/lib/authorization-actors';
import { loadNoiseOverview } from '@/lib/notification-noise/loader';
import InsightsPanel from '@/components/intelligence/insights/InsightsPanel';
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
  viewer: { id: string };
  variant?: 'desktop' | 'mobile';
}) {
  const loaded = await resolveUserActor(viewer.id)
    .then(async actor => {
      const overview = actor ? await loadNoiseOverview(actor, viewer.id) : null;
      return actor && overview ? { actor, overview } : null;
    })
    .catch(error => {
      logger.warn('notification_noise.overview_failed', { component: 'notification-noise', error });
      return null;
    });
  if (!loaded) return null;
  const { actor, overview } = loaded;
  const suggestions =
    overview.insights.length > 0 ? (
      <InsightsPanel
        insights={overview.insights}
        canDecide={hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK)}
        draftLabel="Review"
        label="Noise suggestions"
      />
    ) : null;
  return variant === 'mobile' ? (
    <MobileNoiseCard overview={overview} suggestions={suggestions} />
  ) : (
    <NoiseSection overview={overview} suggestions={suggestions} />
  );
}
