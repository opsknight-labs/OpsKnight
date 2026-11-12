import type { AcceptanceRate, OverviewSpeed } from '@/lib/intelligence/overview/speed';
import { formatCount, formatDuration, formatPercent } from '@/lib/intelligence/overview/window';
import { FeatureOff, StatGrid, StatTile } from './primitives';

function reviewedHint(rate: AcceptanceRate, noun: string): string {
  if (rate.reviewed === 0) return `None ${noun} yet`;
  return `${formatCount(rate.accepted)} of ${formatCount(rate.reviewed)} ${noun}`;
}

export default function SpeedPanel({
  data,
  windowLabel,
  triageEnabled,
  canManage,
}: {
  data: OverviewSpeed;
  windowLabel: string;
  triageEnabled: boolean;
  canManage: boolean;
}) {
  return (
    <div className="space-y-4">
      <StatGrid label={`Speed, ${windowLabel.toLowerCase()}`}>
        <StatTile
          label="First insight, median"
          value={formatDuration(data.firstInsightP50Seconds)}
          hint={
            data.incidents === 0
              ? 'No incidents in this window'
              : `${formatCount(data.incidentsWithInsight)} of ${formatCount(data.incidents)} incidents had an insight`
          }
        />
        <StatTile
          label="First insight, 90th percentile"
          value={formatDuration(data.firstInsightP90Seconds)}
          hint="From incident creation to the first suggestion"
        />
        <StatTile
          label="Related suggestions accepted"
          value={formatPercent(data.relatedSuggestions.rate)}
          hint={reviewedHint(data.relatedSuggestions, 'reviewed')}
        />
        <StatTile
          label="Findings rated helpful"
          value={formatPercent(data.findings.rate)}
          hint={reviewedHint(data.findings, 'rated')}
        />
        {triageEnabled && (
          <StatTile
            label="Triage chips accepted"
            value={formatPercent(data.triage.rate)}
            hint={reviewedHint(data.triage, 'decided')}
          />
        )}
      </StatGrid>
      {!triageEnabled && (
        <FeatureOff
          title="Triage suggestions are off"
          adminHint="Turn on triage in the global policy to suggest urgency, owner and duplicates from resolved precedents."
          href="/settings/intelligence"
          canManage={canManage}
        />
      )}
      {data.sampleTruncated && (
        <p className="text-xs text-muted-foreground">
          Based on the most recent 5,000 incidents and reviews in this window.
        </p>
      )}
    </div>
  );
}
