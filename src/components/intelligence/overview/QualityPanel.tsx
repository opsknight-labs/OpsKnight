import Link from 'next/link';
import type { AlertQualityRow } from '@/lib/intelligence/triage/alert-quality';
import type { OverviewQuality } from '@/lib/intelligence/overview/quality';
import { formatPercent } from '@/lib/intelligence/overview/window';
import JiraIssueButton from './JiraIssueButton';
import { actionLinkClass } from './primitives';

function Actions({
  row,
  canManage,
  jiraConfigured,
}: {
  row: AlertQualityRow;
  canManage: boolean;
  jiraConfigured: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canManage ? (
        <>
          <Link
            href={`/settings/intelligence/noise-controls?service=${encodeURIComponent(row.serviceId)}`}
            className={actionLinkClass}
            aria-label={`Create suppression rule for ${row.serviceName}`}
          >
            Create suppression rule
          </Link>
          <Link
            href={`/services/${encodeURIComponent(row.serviceId)}/automation`}
            className={actionLinkClass}
            aria-label={`Lower severity for ${row.serviceName}`}
          >
            Lower severity
          </Link>
          {jiraConfigured && (
            <JiraIssueButton
              serviceId={row.serviceId}
              serviceName={row.serviceName}
              className={actionLinkClass}
            />
          )}
        </>
      ) : (
        <Link
          href={`/services/${encodeURIComponent(row.serviceId)}`}
          className={actionLinkClass}
          aria-label={`View service ${row.serviceName}`}
        >
          View service
        </Link>
      )}
    </div>
  );
}

function ServiceList({
  label,
  rows,
  metric,
  canManage,
  jiraConfigured,
}: {
  label: string;
  rows: AlertQualityRow[];
  metric: (row: AlertQualityRow) => string;
  canManage: boolean;
  jiraConfigured: boolean;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-border">
      {rows.map(row => (
        <li key={row.serviceId} className="space-y-2 py-3 first:pt-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 text-sm font-medium">
              <span className="break-words">{row.serviceName}</span>
              {row.teamName && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {row.teamName}
                </span>
              )}
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">{metric(row)}</p>
          </div>
          <Actions row={row} canManage={canManage} jiraConfigured={jiraConfigured} />
        </li>
      ))}
    </ul>
  );
}

export default function QualityPanel({
  data,
  canManage,
}: {
  data: OverviewQuality;
  canManage: boolean;
}) {
  const empty = data.noisy.length === 0 && data.flapping.length === 0;
  if (empty)
    return (
      <p className="text-sm text-muted-foreground">
        No noisy or flapping services in the last {data.windowDays} days. Services need at least
        five incidents before they are ranked.
      </p>
    );
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium">Noisiest services</h3>
        {data.noisy.length > 0 ? (
          <ServiceList
            label="Noisiest services"
            rows={data.noisy}
            metric={row =>
              `${row.incidents} incidents · ${formatPercent(row.quickResolvedRatio)} self-cleared · ${formatPercent(row.neverAcknowledgedRatio)} never acknowledged`
            }
            canManage={canManage}
            jiraConfigured={data.jiraConfigured}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No noisy services.</p>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium">Flapping services</h3>
        {data.flapping.length > 0 ? (
          <ServiceList
            label="Flapping services"
            rows={data.flapping}
            metric={row =>
              `${formatPercent(row.flappingRatio)} of ${row.incidents} incidents opened as flapping`
            }
            canManage={canManage}
            jiraConfigured={data.jiraConfigured}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No flapping services.</p>
        )}
      </div>
    </div>
  );
}
