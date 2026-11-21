import Link from 'next/link';
import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import type { OverviewHealth } from '@/lib/intelligence/overview/health';
import { formatCount } from '@/lib/intelligence/overview/window';
import { cn } from '@/lib/utils';
import { actionLinkClass, StatGrid, StatTile } from './primitives';

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
          lane.status === 'healthy' &&
            'border-status-ok-border/40 bg-status-ok-soft dark:bg-status-ok/10',
          lane.status === 'degraded' &&
            'border-status-elevated-border/40 bg-status-elevated-soft dark:bg-status-elevated/10',
          lane.status === 'disabled' && 'border-border bg-muted/40'
        )}
      >
        <view.Icon
          className={cn(
            'mt-0.5 h-5 w-5 shrink-0',
            lane.status === 'healthy' && 'text-status-ok-deep dark:text-status-ok',
            lane.status === 'degraded' && 'text-status-elevated-deep dark:text-status-elevated',
            lane.status === 'disabled' && 'text-muted-foreground'
          )}
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-semibold text-foreground">Lane: {view.label}</p>
          <p className="text-xs text-muted-foreground">{view.detail}</p>
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
