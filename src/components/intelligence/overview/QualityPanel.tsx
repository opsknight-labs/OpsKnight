import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import EmptyState from '@/components/patterns/EmptyState';
import type { AlertQualityRow } from '@/lib/intelligence/triage/alert-quality';
import type { OverviewQuality } from '@/lib/intelligence/overview/quality';
import { formatPercent } from '@/lib/intelligence/overview/window';
import { Button, buttonVariants } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import JiraIssueButton from './JiraIssueButton';

const actionButton = 'h-11 sm:h-9';

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
          <Button asChild size="sm" variant="outline" className={actionButton}>
            <Link
              href={`/settings/intelligence/noise-controls?service=${encodeURIComponent(row.serviceId)}`}
              aria-label={`Create suppression rule for ${row.serviceName}`}
            >
              Create suppression rule
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className={actionButton}>
            <Link
              href={`/services/${encodeURIComponent(row.serviceId)}/automation`}
              aria-label={`Lower severity for ${row.serviceName}`}
            >
              Lower severity
            </Link>
          </Button>
          {jiraConfigured && (
            <JiraIssueButton
              serviceId={row.serviceId}
              serviceName={row.serviceName}
              className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), actionButton)}
            />
          )}
        </>
      ) : (
        <Button asChild size="sm" variant="outline" className={actionButton}>
          <Link
            href={`/services/${encodeURIComponent(row.serviceId)}`}
            aria-label={`View service ${row.serviceName}`}
          >
            View service
          </Link>
        </Button>
      )}
    </div>
  );
}

function ServiceList({
  title,
  rows,
  metric,
  canManage,
  jiraConfigured,
}: {
  title: string;
  rows: AlertQualityRow[];
  metric: (row: AlertQualityRow) => string;
  canManage: boolean;
  jiraConfigured: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <ul aria-label={title} className="divide-y divide-border">
        {rows.map(row => (
          <li
            key={row.serviceId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 last:pb-0"
          >
            <div className="min-w-0 flex-[1_1_16rem] space-y-0.5">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                <span className="min-w-0 break-words">{row.serviceName}</span>
                {row.teamName && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-2xs font-medium text-muted-foreground">
                    <span className="sr-only">, team </span>
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
    </div>
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
      <EmptyState
        size="sm"
        variant="simple"
        icon={<CheckCircle2 aria-hidden="true" />}
        title="No noisy or flapping services"
        description={`Nothing stood out in the last ${data.windowDays} days. Services need at least five incidents before they are ranked.`}
        primaryAction={
          <Button asChild size="sm" variant="outline" className={actionButton}>
            <Link href="/services">View services</Link>
          </Button>
        }
      />
    );
  const lists = { canManage, jiraConfigured: data.jiraConfigured };
  const noisy = data.noisy.length > 0 && (
    <ServiceList
      title="Noisiest services"
      rows={data.noisy}
      metric={row =>
        `${row.incidents} incidents · ${formatPercent(row.quickResolvedRatio)} self-cleared · ${formatPercent(row.neverAcknowledgedRatio)} never acknowledged`
      }
      {...lists}
    />
  );
  const flapping = data.flapping.length > 0 && (
    <ServiceList
      title="Flapping services"
      rows={data.flapping}
      metric={row =>
        `${formatPercent(row.flappingRatio)} of ${row.incidents} incidents opened as flapping`
      }
      {...lists}
    />
  );
  // Only split into columns when both lists have rows; an empty one is a single line, not a column.
  if (noisy && flapping)
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        {noisy}
        {flapping}
      </div>
    );
  return (
    <div className="space-y-3">
      {noisy || flapping}
      <p className="text-xs text-muted-foreground">
        {noisy ? 'No flapping services' : 'No noisy services'} in the last {data.windowDays} days.
      </p>
    </div>
  );
}
