import Link from 'next/link';
import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import type { OverviewHealth } from '@/lib/intelligence/overview/health';
import { formatCount } from '@/lib/intelligence/overview/window';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { actionLinkClass, StatGrid, StatTile } from './primitives';

const LANE_TONE = { healthy: 'ok', degraded: 'elevated', disabled: 'neutral' } as const;

const formatAge = (ms: number | null) => {
  if (ms === null) return 'None waiting';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
};

export default function HealthPanel({ data }: { data: OverviewHealth }) {
  const { lane, backlog } = data;
  const view =
    lane.status === 'healthy'
      ? {
          Icon: CheckCircle2,
          label: 'Healthy',
          detail: 'The lane on this instance is completing cycles.',
        }
      : lane.status === 'degraded'
        ? { Icon: AlertTriangle, label: 'Degraded', detail: lane.error }
        : {
            Icon: MinusCircle,
            label: 'Not running here',
            detail:
              'This instance does not run the Intelligence lane, or Intelligence is off. A dedicated worker may still be processing the backlog.',
          };
  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-start gap-3 rounded-lg border p-3',
          toneClasses(LANE_TONE[lane.status]).soft
        )}
      >
        <view.Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">Lane: {view.label}</p>
          <p className="text-xs opacity-90">{view.detail}</p>
        </div>
      </div>
      <StatGrid label="Intelligence work backlog">
        <StatTile label="Ready" value={formatCount(backlog.ready)} hint="Waiting to run" />
        <StatTile label="Running" value={formatCount(backlog.leased)} />
        <StatTile label="Oldest waiting" value={formatAge(backlog.oldestReadyAgeMs)} />
        <StatTile
          label="Failed work"
          value={formatCount(backlog.deadLetters)}
          hint={`${formatCount(backlog.quarantined)} quarantined`}
        />
      </StatGrid>
      <Link href="/settings/intelligence" className={actionLinkClass}>
        Open Intelligence settings
      </Link>
    </div>
  );
}
