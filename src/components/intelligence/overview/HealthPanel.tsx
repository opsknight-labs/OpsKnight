import Link from 'next/link';
import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import type { OverviewHealth } from '@/lib/intelligence/overview/health';
import { formatCount } from '@/lib/intelligence/overview/window';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { StatGrid, StatTile } from './primitives';

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
      <div className="flex items-start gap-3">
        <view.Icon
          className={cn('mt-0.5 h-5 w-5 shrink-0', toneClasses(LANE_TONE[lane.status]).text)}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Lane: {view.label}</p>
          <p className="break-words text-xs text-muted-foreground">{view.detail}</p>
        </div>
      </div>
      <StatGrid flush columns={4} label="Intelligence work backlog">
        <StatTile label="Ready" value={formatCount(backlog.ready)} hint="Waiting to run" />
        <StatTile label="Running" value={formatCount(backlog.leased)} />
        <StatTile label="Oldest waiting" value={formatAge(backlog.oldestReadyAgeMs)} />
        <StatTile
          label="Failed work"
          value={formatCount(backlog.deadLetters)}
          hint={`${formatCount(backlog.quarantined)} quarantined`}
        />
      </StatGrid>
      <Button asChild size="sm" variant="outline" className="h-11 sm:h-9">
        <Link href="/settings/intelligence">Open Intelligence settings</Link>
      </Button>
    </div>
  );
}
