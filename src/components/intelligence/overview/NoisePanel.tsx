import type { OverviewNoise } from '@/lib/intelligence/overview/noise';
import { formatCount, formatPercent } from '@/lib/intelligence/overview/window';
import { FeatureOff, RankedBars, StatGrid, StatTile } from './primitives';

const NOISE_SETTINGS = '/settings/intelligence/noise-controls';

export default function NoisePanel({
  data,
  windowLabel,
  canManage,
}: {
  data: OverviewNoise;
  windowLabel: string;
  canManage: boolean;
}) {
  const controlsOff = data.modes.on === 0 && data.modes.shadow === 0;
  const shadowOnly = data.modes.on === 0 && data.modes.shadow > 0;
  return (
    <div className="space-y-4">
      <StatGrid label={`Noise, ${windowLabel.toLowerCase()}`}>
        <StatTile
          label="Alerts received"
          value={formatCount(data.alerts)}
          hint={`${formatCount(data.incidents)} incidents created`}
        />
        <StatTile
          label="Compression"
          value={`${data.compressionRatio.toLocaleString('en-US', { maximumFractionDigits: 1 })}×`}
          hint="Alerts per incident"
        />
        <StatTile
          label="Pages avoided"
          value={formatCount(data.pagesAvoided)}
          hint={
            data.downgraded > 0
              ? `Applied by noise controls · ${formatCount(data.downgraded)} downgraded`
              : 'Applied by noise controls'
          }
        />
        <StatTile
          label="Would have avoided"
          value={formatCount(data.shadowWouldAvoid)}
          hint="Shadow mode only: nothing was held back"
        />
        <StatTile
          label="False-group rate"
          value={data.grouped === 0 ? '—' : formatPercent(data.falseGroupRate)}
          hint={
            data.grouped === 0
              ? 'No alerts were grouped'
              : `${formatCount(data.ungrouped)} of ${formatCount(data.grouped)} groupings undone`
          }
        />
        {data.heartbeats.monitors > 0 && (
          <StatTile
            label="Heartbeats"
            value={`${formatCount(data.heartbeats.monitors)} monitors`}
            hint={`${formatCount(data.heartbeats.missing)} missing · ${formatCount(data.heartbeats.late)} late`}
          />
        )}
      </StatGrid>

      {controlsOff ? (
        <FeatureOff
          title="Noise controls are off"
          adminHint="Maintenance windows, suppression rules and grouping start in shadow mode, so you can see what they would avoid before anything is held back."
          href={NOISE_SETTINGS}
          canManage={canManage}
        />
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Suppressed by rule or maintenance window</h3>
          {shadowOnly && (
            <p className="text-xs text-muted-foreground">
              Every control is in shadow mode, so nothing is suppressed yet. See &ldquo;Would have
              avoided&rdquo; above.
            </p>
          )}
          {data.suppressedBySource.length > 0 ? (
            <RankedBars
              label="Alerts suppressed per rule or maintenance window"
              items={data.suppressedBySource.map(source => ({
                key: source.key,
                label: source.label,
                detail: source.control === 'MAINTENANCE' ? 'Maintenance' : 'Rule',
                value: source.count,
              }))}
            />
          ) : (
            !shadowOnly && (
              <p className="text-sm text-muted-foreground">
                No alerts were suppressed by a rule or maintenance window in this window.
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
