import Link from 'next/link';
import { AlertTriangle, CircleDot, Info } from 'lucide-react';
import type { OverviewChange } from '@/lib/intelligence/overview/change';
import { formatCount, formatPercent } from '@/lib/intelligence/overview/window';
import { cn } from '@/lib/utils';
import { FeatureOff, StatGrid, StatTile } from './primitives';

/** Risk is a ranking signal, never a verdict; the band label always accompanies its colour. */
export function riskBand(score: number): { label: string; tone: 'high' | 'medium' | 'low' } {
  if (score >= 0.6) return { label: 'High risk', tone: 'high' };
  if (score >= 0.35) return { label: 'Medium risk', tone: 'medium' };
  return { label: 'Low risk', tone: 'low' };
}

const formatWhen = (date: Date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function RiskMeter({ score }: { score: number }) {
  const band = riskBand(score);
  const Icon = band.tone === 'high' ? AlertTriangle : band.tone === 'medium' ? CircleDot : Info;
  return (
    <div className="flex min-w-[9rem] items-center gap-2">
      <div
        aria-hidden="true"
        className={cn(
          'h-2 w-16 overflow-hidden rounded-full',
          band.tone === 'high' && 'bg-status-critical/15',
          band.tone === 'medium' && 'bg-status-elevated/15',
          band.tone === 'low' && 'bg-muted'
        )}
      >
        <div
          className={cn(
            'h-2 rounded-full',
            band.tone === 'high' && 'bg-status-critical',
            band.tone === 'medium' && 'bg-status-elevated',
            band.tone === 'low' && 'bg-muted-foreground'
          )}
          style={{ width: `${Math.max(4, Math.round(score * 100))}%` }}
        />
      </div>
      <span className="flex items-center gap-1 text-xs font-medium text-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {band.label} · {Math.round(score * 100)}%
      </span>
    </div>
  );
}

export default function ChangePanel({
  data,
  windowLabel,
  responseEnabled,
  canManage,
}: {
  data: OverviewChange;
  windowLabel: string;
  responseEnabled: boolean;
  canManage: boolean;
}) {
  const nothing = data.changes === 0 && data.changeLinked === 0;
  return (
    <div className="space-y-4">
      <StatGrid label={`Changes, ${windowLabel.toLowerCase()}`}>
        <StatTile
          label="Change-linked incidents"
          value={formatCount(data.changeLinked)}
          hint={
            data.incidents === 0
              ? 'No incidents in this window'
              : `${formatPercent(data.changeLinked / data.incidents)} of ${formatCount(data.incidents)} incidents`
          }
        />
        <StatTile
          label="Changes recorded"
          value={formatCount(data.changes)}
          hint={`${formatCount(data.scoredChanges)} risk-scored`}
        />
      </StatGrid>

      {!responseEnabled ? (
        <FeatureOff
          title="Change correlation is off"
          adminHint="Turn on response intelligence in the global policy to link incidents to recent changes."
          href="/settings/intelligence"
          canManage={canManage}
        />
      ) : nothing ? (
        <FeatureOff
          title="No changes recorded in this window"
          adminHint="Send deploys, config changes and feature flags to the change events webhook so incidents can be linked to them."
          href="/settings/intelligence/response"
          canManage={canManage}
        />
      ) : null}

      {data.riskiest.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Riskiest recent changes</h3>
          <ul aria-label="Riskiest recent changes" className="divide-y divide-border">
            {data.riskiest.map(change => (
              <li
                key={change.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
              >
                <div className="min-w-0 space-y-0.5">
                  <Link
                    href={`/changes/${encodeURIComponent(change.id)}`}
                    className="inline-flex min-h-11 items-center break-words text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                  >
                    {change.summary}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {change.serviceName ?? 'No service'} ·{' '}
                    {change.kind.toLowerCase().replace('_', ' ')} · {change.source} ·{' '}
                    {formatWhen(change.occurredAt)}
                  </p>
                </div>
                <RiskMeter score={change.riskScore} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.recentLinked.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Recent change-linked incidents</h3>
          <ul aria-label="Recent change-linked incidents" className="divide-y divide-border">
            {data.recentLinked.map(row => (
              <li key={row.incidentId} className="space-y-0.5 py-2">
                <Link
                  href={`/incidents/${encodeURIComponent(row.incidentId)}`}
                  className="inline-flex min-h-11 items-center break-words text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                >
                  {row.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {row.change
                    ? `Possible change: ${row.change.summary}`
                    : 'Linked change not visible to you'}{' '}
                  · {formatWhen(row.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.sampleTruncated && (
        <p className="text-xs text-muted-foreground">
          Based on the most recent 5,000 incidents in this window.
        </p>
      )}
    </div>
  );
}
