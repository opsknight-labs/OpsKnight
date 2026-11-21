import { Flame, ShieldCheck, Wrench } from 'lucide-react';
import type { ServiceListBadges } from '@/lib/intelligence/surfaces/service-list-badges';
import { NOISE_DECISION_LABELS } from '@/lib/intelligence/incident-ux/explain';
import { cn } from '@/lib/utils';

export type ServiceIntelligenceBadgeData = ServiceListBadges;

const chip =
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium leading-4';

/**
 * Up to three small badges on a service row: in maintenance, SLO burning, noise controls on or in
 * shadow. Each carries an icon and words, so the colour is never the only signal. Renders nothing at all
 * when the service has none, which is the common case.
 */
export default function ServiceIntelligenceBadges({
  serviceId,
  badges,
}: {
  serviceId: string;
  badges?: ServiceIntelligenceBadgeData;
}) {
  if (!badges || (!badges.maintenance && !badges.sloBurning && !badges.noiseMode)) return null;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-1.5"
      data-testid={`service-intelligence-badges-${serviceId}`}
    >
      {badges.maintenance && (
        <span
          className={cn(
            chip,
            'border-status-info-border/40 bg-status-info-soft text-status-info-deep dark:bg-status-info/15 dark:text-status-info-soft'
          )}
          title={`Maintenance window: ${badges.maintenance.name}`}
        >
          <Wrench className="h-3 w-3 shrink-0" aria-hidden="true" />
          {NOISE_DECISION_LABELS.maintenance}
        </span>
      )}
      {badges.sloBurning && (
        <span
          className={cn(
            chip,
            badges.sloBurning === 'critical'
              ? 'border-status-critical-border/40 bg-status-critical-soft text-status-critical-deep dark:bg-status-critical/15 dark:text-status-critical-soft'
              : 'border-status-elevated-border/40 bg-status-elevated-soft text-status-elevated-deep dark:bg-status-elevated/15 dark:text-status-elevated-soft'
          )}
          title={
            badges.sloBurning === 'critical'
              ? 'The availability error budget is burning at a paging rate'
              : 'The availability error budget is burning faster than planned'
          }
        >
          <Flame className="h-3 w-3 shrink-0" aria-hidden="true" />
          {badges.sloBurning === 'critical' ? 'SLO burning fast' : 'SLO burning'}
        </span>
      )}
      {badges.noiseMode && (
        <span
          className={cn(
            chip,
            'border-status-shift-border/40 bg-status-shift-soft text-status-shift-deep dark:bg-status-shift/15 dark:text-status-shift-soft'
          )}
          title={
            badges.noiseMode === 'ON'
              ? 'Noise controls are on for this service'
              : 'Noise controls are in shadow: decisions are recorded but nothing is held back'
          }
        >
          <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
          {badges.noiseMode === 'ON' ? 'Noise controls on' : 'Noise controls: shadow'}
        </span>
      )}
    </span>
  );
}
