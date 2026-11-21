import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Flame } from 'lucide-react';
import {
  FAST_BURN_CRITICAL,
  SLOW_BURN_CRITICAL,
  type BurnSeverity,
  type ServiceBurn,
} from '@/lib/slo/burn';
import type { RecurringProblem } from '@/lib/intelligence/insights/service';
import type {
  ServiceAlertQuality,
  ServiceAutoGate,
  ServiceChangeRow,
  ServiceDependencyNeighbourhood,
  ServiceNoiseStatus,
} from '@/lib/intelligence/surfaces/service-intelligence';
import { formatPercent } from '@/lib/intelligence/overview/window';
import { formatDateTime } from '@/lib/timezone';
import {
  OVERVIEW_CHART_VARS,
  OverviewSection,
  StatGrid,
  StatTile,
  actionLinkClass,
} from '@/components/intelligence/overview/primitives';
import { riskBand } from '@/components/intelligence/overview/ChangePanel';
import JiraIssueButton from '@/components/intelligence/overview/JiraIssueButton';
import { cn } from '@/lib/utils';
import DependencyReviewButtons from './DependencyReviewButtons';
import ServiceDependencyGraph from './ServiceDependencyGraph';

/**
 * Presentational panels of the service page's Intelligence tab. Each returns null when it has nothing to
 * show, so the tab never renders an empty card. All are server-renderable; the only client island is the
 * approve/reject form on a suggested dependency.
 */

const count = (value: number) => value.toLocaleString('en-US');
const plural = (value: number, word: string) => `${count(value)} ${word}${value === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------------

export function DependenciesPanel({
  data,
  canManage,
}: {
  data: ServiceDependencyNeighbourhood;
  canManage: boolean;
}) {
  if (data.edges.length === 0) return null;
  const names = new Map(data.neighbours.map(node => [node.id, node]));
  const sentence = (edge: ServiceDependencyNeighbourhood['edges'][number]) => {
    const neighbour = names.get(edge.neighbourId)?.name ?? 'Unknown service';
    return edge.direction === 'UPSTREAM'
      ? `${data.focus.name} depends on ${neighbour}`
      : `${neighbour} depends on ${data.focus.name}`;
  };
  const active = data.edges.filter(edge => edge.status === 'ACTIVE');
  const suggested = data.edges.filter(edge => edge.status === 'SUGGESTED');
  return (
    <OverviewSection
      id="service-dependencies"
      title="Dependencies"
      description="What this service depends on and what depends on it. Suggested links were observed from incidents that keep happening together and affect nothing until someone approves them."
    >
      <ServiceDependencyGraph data={data} />
      {active.length > 0 && (
        <ul aria-label="Dependencies" className="divide-y divide-border">
          {active.map(edge => {
            const neighbour = names.get(edge.neighbourId);
            return (
              <li
                key={edge.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="min-w-0 break-words">
                  {edge.direction === 'UPSTREAM' ? 'Depends on ' : 'Depended on by '}
                  <Link
                    href={`/services/${encodeURIComponent(edge.neighbourId)}?tab=intelligence`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {neighbour?.name}
                  </Link>
                </span>
                <span className="text-xs text-muted-foreground">
                  {edge.origin === 'OBSERVED' ? 'Observed, approved' : 'Declared'}
                  {neighbour && neighbour.openIncidents > 0
                    ? ` · ${plural(neighbour.openIncidents, 'open incident')}`
                    : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {suggested.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Suggested dependencies</h3>
          <ul aria-label="Suggested dependencies" className="divide-y divide-border">
            {suggested.map(edge => (
              <li
                key={edge.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2"
              >
                <p className="min-w-0 text-sm">
                  <span className="break-words">{sentence(edge)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    Suggested · {formatPercent(edge.confidence)} confidence
                  </span>
                </p>
                {canManage && (
                  <DependencyReviewButtons
                    serviceId={data.focus.id}
                    dependencyId={edge.id}
                    label={sentence(edge)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.truncated && (
        <p className="text-xs text-muted-foreground">
          Only the most recent dependencies are shown.
          {canManage && (
            <>
              {' '}
              <Link
                href="/settings/intelligence/services#dependencies"
                className="underline underline-offset-2"
              >
                See all dependencies
              </Link>
            </>
          )}
        </p>
      )}
    </OverviewSection>
  );
}

// ---------------------------------------------------------------------------------------------------
// SLO burn
// ---------------------------------------------------------------------------------------------------

const burnLabel = (severity: BurnSeverity) =>
  severity === 'critical' ? 'Burning fast' : severity === 'warning' ? 'Burning' : 'Within budget';

function BurnStatus({ severity }: { severity: BurnSeverity }) {
  const Icon =
    severity === 'critical' ? Flame : severity === 'warning' ? AlertTriangle : CheckCircle2;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        severity === 'critical' && 'text-status-critical-deep dark:text-status-critical-soft',
        severity === 'warning' && 'text-status-elevated-deep dark:text-status-elevated-soft',
        severity === 'none' && 'text-status-ok-deep dark:text-status-ok-soft'
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {burnLabel(severity)}
    </span>
  );
}

/** One burn rate against its paging threshold. The number is printed; the bar is decorative. */
function BurnMeter({ label, rate, threshold }: { label: string; rate: number; threshold: number }) {
  const width = Math.max(2, Math.min(100, (rate / threshold) * 100));
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">
          {rate}× <span className="font-normal text-muted-foreground">of {threshold}× limit</span>
        </span>
      </div>
      <div aria-hidden="true" className="h-2 w-full rounded-r bg-muted">
        <div className="h-2 rounded-r bg-[var(--overview-accent)]" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function SloBurnPanel({ burn }: { burn: ServiceBurn | null }) {
  if (!burn || burn.objectives.length === 0) return null;
  return (
    <OverviewSection
      id="service-slo-burn"
      title="SLO burn"
      description="How fast the availability error budget is being spent over the last hour and the last six hours. 1× spends the budget exactly on schedule."
    >
      <StatGrid label="Downtime in the burn windows">
        <StatTile label="Downtime, last hour" value={`${burn.downtimeMinutes.fast} min`} />
        <StatTile label="Downtime, last 6 hours" value={`${burn.downtimeMinutes.slow} min`} />
      </StatGrid>
      <ul aria-label="Objectives" className={cn('divide-y divide-border', OVERVIEW_CHART_VARS)}>
        {burn.objectives.map(objective => (
          <li key={objective.objectiveId} className="space-y-2 py-3 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 break-words text-sm font-medium">
                {objective.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  target {objective.targetPercent}%
                  {objective.budgetMinutes !== null
                    ? ` · ${objective.budgetMinutes} min budget`
                    : ''}
                </span>
              </p>
              <BurnStatus severity={objective.severity} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <BurnMeter
                label="Last hour"
                rate={objective.fastBurn}
                threshold={FAST_BURN_CRITICAL}
              />
              <BurnMeter
                label="Last 6 hours"
                rate={objective.slowBurn}
                threshold={SLOW_BURN_CRITICAL}
              />
            </div>
          </li>
        ))}
      </ul>
    </OverviewSection>
  );
}

// ---------------------------------------------------------------------------------------------------
// Alert quality
// ---------------------------------------------------------------------------------------------------

export function AlertQualityPanel({
  quality,
  serviceId,
  serviceName,
  canManage,
  jiraConfigured,
}: {
  quality: ServiceAlertQuality | null;
  serviceId: string;
  serviceName: string;
  canManage: boolean;
  jiraConfigured: boolean;
}) {
  if (!quality) return null;
  const id = encodeURIComponent(serviceId);
  return (
    <OverviewSection
      id="service-alert-quality"
      title="Alert quality"
      description={`How much of this service's alerting looked like noise over the last ${quality.windowDays} days. This only flags; nothing is suppressed from here.`}
    >
      <StatGrid label="Alert quality">
        <StatTile
          label="Noise score"
          value={formatPercent(quality.noiseScore)}
          hint={
            quality.flagged
              ? 'Flagged as noisy'
              : `${plural(quality.incidents, 'incident')} sampled`
          }
        />
        <StatTile
          label="Resolved within 5 min"
          value={formatPercent(quality.quickResolvedRatio)}
          hint="Usually self-clearing"
        />
        <StatTile
          label="Never acknowledged"
          value={formatPercent(quality.neverAcknowledgedRatio)}
        />
        <StatTile
          label="Flapping"
          value={formatPercent(quality.flappingRatio)}
          hint="Opened as suppressed by the flapping detector"
        />
      </StatGrid>
      {canManage && (quality.flagged || quality.flappingRatio > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/settings/intelligence/noise-controls?service=${id}`}
            className={actionLinkClass}
            aria-label={`Create suppression rule for ${serviceName}`}
          >
            Create suppression rule
          </Link>
          <Link
            href={`/services/${id}?tab=automation`}
            className={actionLinkClass}
            aria-label={`Lower severity for ${serviceName}`}
          >
            Lower severity
          </Link>
          {jiraConfigured && quality.flagged && (
            <JiraIssueButton
              serviceId={serviceId}
              serviceName={serviceName}
              className={actionLinkClass}
            />
          )}
        </div>
      )}
    </OverviewSection>
  );
}

// ---------------------------------------------------------------------------------------------------
// Recent changes
// ---------------------------------------------------------------------------------------------------

const CHANGE_KIND: Record<string, string> = {
  DEPLOY: 'Deploy',
  CONFIG: 'Config',
  FEATURE_FLAG: 'Feature flag',
  INFRA: 'Infrastructure',
};

export function ChangesPanel({
  changes,
  timeZone,
  windowDays,
}: {
  changes: ServiceChangeRow[];
  timeZone: string;
  windowDays: number;
}) {
  if (changes.length === 0) return null;
  return (
    <OverviewSection
      id="service-changes"
      title="Recent changes"
      description={`The latest changes to this service in the last ${windowDays} days. Risk is a ranking signal from history, blast radius, timing and size, never a verdict.`}
    >
      <ul aria-label="Recent changes" className="divide-y divide-border">
        {changes.map(change => {
          const band = change.riskScore === null ? null : riskBand(change.riskScore);
          return (
            <li
              key={change.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2"
            >
              <p className="min-w-0 text-sm">
                <Link
                  href={`/changes/${encodeURIComponent(change.id)}`}
                  className="break-words font-medium underline-offset-4 hover:underline"
                >
                  {change.summary}
                </Link>
                <span className="ml-2 text-xs text-muted-foreground">
                  {CHANGE_KIND[change.kind] ?? change.kind}
                  {change.version ? ` ${change.version}` : ''} · {change.source} ·{' '}
                  {formatDateTime(change.occurredAt, timeZone, { format: 'short' })}
                </span>
              </p>
              {band && (
                <span
                  className={cn(
                    'shrink-0 text-xs font-medium tabular-nums',
                    band.tone === 'high' &&
                      'text-status-critical-deep dark:text-status-critical-soft',
                    band.tone === 'medium' &&
                      'text-status-elevated-deep dark:text-status-elevated-soft',
                    band.tone === 'low' && 'text-muted-foreground'
                  )}
                >
                  {band.label} · {Math.round((change.riskScore ?? 0) * 100)}%
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </OverviewSection>
  );
}

// ---------------------------------------------------------------------------------------------------
// Noise controls
// ---------------------------------------------------------------------------------------------------

const NOISE_MODE: Record<ServiceNoiseStatus['mode'], string> = {
  ON: 'On',
  SHADOW: 'Shadow',
  OFF: 'Off',
};

export function NoiseStatusPanel({
  status,
  serviceId,
  timeZone,
  canManage,
}: {
  status: ServiceNoiseStatus;
  serviceId: string;
  timeZone: string;
  canManage: boolean;
}) {
  const quiet =
    status.mode === 'OFF' &&
    status.activeWindows.length === 0 &&
    status.heartbeats.monitors === 0 &&
    status.pagesAvoided === 0 &&
    status.shadowWouldAvoid === 0;
  // Off and nothing to report: only someone who can turn it on is told so.
  if (quiet && !canManage) return null;
  const source =
    status.source === 'service'
      ? 'Set for this service'
      : status.source === 'global'
        ? 'Inherited from all services'
        : 'No policy yet';
  return (
    <OverviewSection
      id="service-noise"
      title="Noise controls"
      description="What is held back before anyone is paged: suppression, maintenance windows, grouping and heartbeat checks."
    >
      <StatGrid label="Noise controls">
        <StatTile label="Mode" value={NOISE_MODE[status.mode]} hint={source} />
        {status.mode !== 'OFF' && (
          <>
            <StatTile
              label={status.mode === 'SHADOW' ? 'Would avoid (shadow)' : 'Pages avoided'}
              value={count(
                status.mode === 'SHADOW' ? status.shadowWouldAvoid : status.pagesAvoided
              )}
              hint={`Last ${status.days} days`}
            />
            <StatTile
              label="Alerts → incidents"
              value={`${count(status.alerts)} → ${count(status.incidents)}`}
              hint={`Last ${status.days} days`}
            />
          </>
        )}
        {status.heartbeats.monitors > 0 && (
          <StatTile
            label="Heartbeats"
            value={
              status.heartbeats.missing.length > 0
                ? `${count(status.heartbeats.missing.length)} missing`
                : 'All healthy'
            }
            hint={plural(status.heartbeats.monitors, 'monitor')}
          />
        )}
      </StatGrid>
      {status.activeWindows.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">In maintenance now</h3>
          <ul aria-label="Active maintenance windows" className="divide-y divide-border">
            {status.activeWindows.map(window => (
              <li
                key={window.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="min-w-0 break-words font-medium">{window.name}</span>
                <span className="text-xs text-muted-foreground">
                  {window.effect === 'SUPPRESS' ? 'Suppresses alerts' : 'Lowers urgency'} ·{' '}
                  {window.scope === 'SERVICE'
                    ? 'this service'
                    : window.scope === 'TEAM'
                      ? 'owning team'
                      : 'all services'}
                  {window.recurring
                    ? ' · recurring'
                    : ` · until ${formatDateTime(window.endsAt, timeZone, { format: 'short' })}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {status.heartbeats.missing.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Missing heartbeats</h3>
          <ul aria-label="Missing heartbeats" className="divide-y divide-border">
            {status.heartbeats.missing.map(monitor => (
              <li
                key={monitor.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="min-w-0 break-words font-medium">{monitor.name}</span>
                {monitor.missingSince && (
                  <span className="text-xs text-muted-foreground">
                    since {formatDateTime(monitor.missingSince, timeZone, { format: 'short' })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {canManage && (
        <Link
          href={`/settings/intelligence/noise-controls?service=${encodeURIComponent(serviceId)}`}
          className={cn(actionLinkClass, 'w-fit')}
        >
          {status.mode === 'OFF' ? 'Turn on noise controls' : 'Open noise controls'}
        </Link>
      )}
    </OverviewSection>
  );
}

// ---------------------------------------------------------------------------------------------------
// Grouping mode and AUTO certification
// ---------------------------------------------------------------------------------------------------

const MODE_LABEL: Record<ServiceAutoGate['mode'], string> = {
  OFF: 'Off',
  SHADOW: 'Shadow',
  SUGGEST: 'Suggest',
  AUTO: 'Automatic',
};

export function AutoGatePanel({
  gate,
  serviceName,
  canManage,
}: {
  gate: ServiceAutoGate;
  serviceName: string;
  canManage: boolean;
}) {
  // With intelligence off there is no certification to speak of; managers still get the way in.
  if (gate.mode === 'OFF' && !canManage) return null;
  return (
    <OverviewSection
      id="service-auto-gate"
      title="Grouping mode"
      description="Automatic grouping is only allowed after a recent quality certification of the exact policy this service runs."
    >
      <StatGrid label="Grouping mode">
        <StatTile
          label="Mode"
          value={MODE_LABEL[gate.mode]}
          hint={
            gate.source === 'service'
              ? 'Set for this service'
              : gate.source === 'global'
                ? 'Inherited from the global policy'
                : 'No policy published'
          }
        />
        {gate.mode !== 'OFF' && (
          <StatTile
            label="Automatic mode"
            value={gate.allowed ? 'Certified' : 'Not certified'}
            hint={gate.reason}
          />
        )}
      </StatGrid>
      {canManage && (
        <Link
          href={`/settings/intelligence/services?q=${encodeURIComponent(serviceName)}`}
          className={cn(actionLinkClass, 'w-fit')}
        >
          {gate.mode === 'OFF' ? 'Turn on Intelligence for this service' : 'Open service policy'}
        </Link>
      )}
    </OverviewSection>
  );
}

// ---------------------------------------------------------------------------------------------------
// Recurring problems and learned facts
// ---------------------------------------------------------------------------------------------------

export function RecurringProblemsPanel({
  problems,
  timeZone,
  windowDays,
}: {
  problems: RecurringProblem[];
  timeZone: string;
  windowDays: number;
}) {
  if (problems.length === 0) return null;
  return (
    <OverviewSection
      id="service-recurring"
      title="Recurring problems"
      description={`Incidents with the same shape that came back on several days in the last ${windowDays} days.`}
    >
      <ul aria-label="Recurring problems" className="divide-y divide-border">
        {problems.map(problem => (
          <li
            key={problem.template}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2"
          >
            <p className="min-w-0 text-sm">
              <Link
                href={`/incidents/${encodeURIComponent(problem.latestIncidentId)}`}
                className="break-words font-medium underline-offset-4 hover:underline"
              >
                {problem.template}
              </Link>
              {!problem.hasRunbook && (
                <span className="ml-2 text-xs text-muted-foreground">No runbook attached</span>
              )}
            </p>
            <span className="text-xs tabular-nums text-muted-foreground">
              {count(problem.occurrences)} times on {plural(problem.distinctDays, 'day')} · last{' '}
              {formatDateTime(problem.lastSeenAt, timeZone, { format: 'short' })}
            </span>
          </li>
        ))}
      </ul>
    </OverviewSection>
  );
}

export function LearnedFactsPanel({ facts, serviceId }: { facts: number; serviceId: string }) {
  if (facts === 0) return null;
  return (
    <OverviewSection
      id="service-learned-facts"
      title="Learned facts"
      description="Facts people confirmed about this service. Squire uses them when it answers."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">{plural(facts, 'confirmed fact')}</p>
        <Link
          href={`/settings/intelligence/services/${encodeURIComponent(serviceId)}/squire`}
          className={actionLinkClass}
        >
          Open Squire memory
        </Link>
      </div>
    </OverviewSection>
  );
}
