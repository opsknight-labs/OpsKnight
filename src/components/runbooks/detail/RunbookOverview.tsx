import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  FileClock,
  GitBranch,
  Layers,
  ListOrdered,
  PlayCircle,
  SlidersHorizontal,
} from 'lucide-react';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { EmptyHint, Pill, SectionCard, StatTile } from '@/components/runbooks/ui/primitives';

export type OverviewExecution = {
  id: string;
  status: string;
  createdAtLabel: string;
  incidentId: string | null;
  version: number | null;
};

export type OverviewService = { id: string; name: string; ruleCount: number };

export type OverviewInput = { key: string; label: string; type: string; required: boolean };

export type RunbookOverviewProps = {
  runbookId: string;
  publishedVersion: { version: number; publishedAtLabel: string | null } | null;
  draftVersion: { version: number; revision: number } | null;
  serviceCount: number;
  executionCount: number;
  lastExecution: OverviewExecution | null;
  successRate: { succeeded: number; completed: number; sampled: number };
  services: OverviewService[];
  recentExecutions: OverviewExecution[];
  definitionSummary?: {
    version: number;
    state: string;
    stepCount: number;
    inputs: OverviewInput[];
  } | null;
};

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT']);

export function computeSuccessRate(statuses: string[]) {
  const completed = statuses.filter(status => TERMINAL_STATUSES.has(status));
  return {
    succeeded: completed.filter(status => status === 'SUCCEEDED').length,
    completed: completed.length,
    sampled: statuses.length,
  };
}

const panelLinkClass =
  'inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const rowLinkClass =
  'flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none';

export function RunbookOverview({
  runbookId,
  publishedVersion,
  draftVersion,
  serviceCount,
  executionCount,
  lastExecution,
  successRate,
  services,
  recentExecutions,
  definitionSummary,
}: RunbookOverviewProps) {
  const rate =
    successRate.completed > 0
      ? Math.round((successRate.succeeded / successRate.completed) * 100)
      : null;
  const rateTone =
    rate === null ? 'neutral' : rate >= 90 ? 'success' : rate >= 60 ? 'warning' : 'danger';
  return (
    <div className="space-y-6">
      <section aria-labelledby="runbook-summary-heading">
        <h2 id="runbook-summary-heading" className="sr-only">
          Runbook summary
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Live version"
            icon={GitBranch}
            tone={publishedVersion ? 'success' : 'neutral'}
            value={publishedVersion ? `v${publishedVersion.version}` : 'None'}
            hint={
              publishedVersion
                ? publishedVersion.publishedAtLabel
                  ? `Since ${publishedVersion.publishedAtLabel}`
                  : 'Live for service rules'
                : 'Publish a draft to make it available'
            }
          />
          <StatTile
            label="Draft"
            icon={FileClock}
            tone={draftVersion ? 'warning' : 'neutral'}
            value={draftVersion ? `v${draftVersion.version} in progress` : 'No open draft'}
            hint={
              draftVersion
                ? `${draftVersion.revision} saved ${draftVersion.revision === 1 ? 'revision' : 'revisions'}`
                : 'Create the next draft to make changes'
            }
            href={draftVersion ? `/runbooks/${runbookId}?tab=builder` : undefined}
          />
          <StatTile
            label="Success rate"
            icon={CheckCircle2}
            tone={rateTone}
            value={rate === null ? '—' : `${rate}%`}
            hint={
              successRate.completed > 0
                ? `${successRate.succeeded} of ${successRate.completed} completed (last ${successRate.sampled})`
                : 'No completed runs yet'
            }
          />
          <StatTile
            label="Total runs"
            icon={PlayCircle}
            value={executionCount}
            hint={lastExecution ? `Last run ${lastExecution.createdAtLabel}` : 'Never run'}
            href={`/runbooks/executions?runbook=${runbookId}`}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Where it runs"
          description={
            serviceCount === 1
              ? '1 service has automation rules for this runbook.'
              : `${serviceCount} services have automation rules for this runbook.`
          }
          icon={Layers}
          bodyClassName="p-0"
          actions={
            <Link href={`/runbooks/${runbookId}?tab=bindings`} className={panelLinkClass}>
              View usage
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          }
        >
          {services.length ? (
            <ul className="divide-y">
              {services.map(service => (
                <li key={service.id}>
                  <Link href={`/services/${service.id}?tab=runbooks`} className={rowLinkClass}>
                    <span className="truncate font-medium">{service.name}</span>
                    <Pill className="tabular-nums">
                      {service.ruleCount} {service.ruleCount === 1 ? 'rule' : 'rules'}
                    </Pill>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5">
              <EmptyHint
                icon={Layers}
                title="Not used by any service yet"
                description="Attach the published version from a service’s Runbooks tab."
              />
            </div>
          )}
        </SectionCard>

        <div role="region" aria-label="Recent executions">
          <SectionCard
            title="Recent executions"
            description="The latest runs across every version."
            icon={PlayCircle}
            className="h-full"
            bodyClassName="p-0"
            actions={
              <Link href={`/runbooks/executions?runbook=${runbookId}`} className={panelLinkClass}>
                All executions
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            }
          >
            {recentExecutions.length ? (
              <ul className="divide-y">
                {recentExecutions.map(execution => (
                  <li key={execution.id}>
                    <Link href={`/runbooks/executions/${execution.id}`} className={rowLinkClass}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {execution.createdAtLabel}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {execution.version !== null
                            ? `Version ${execution.version}`
                            : 'Version unknown'}
                          {execution.incidentId ? ' · From an incident' : ''}
                        </span>
                      </span>
                      <RunbookStatusBadge status={execution.status} context="execution" size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-5">
                <EmptyHint
                  icon={PlayCircle}
                  title="No executions yet"
                  description="Run history appears here after responders start this runbook."
                />
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {definitionSummary && (
        <SectionCard
          title="Inputs"
          description={`What responders provide when running v${definitionSummary.version} (${definitionSummary.state.toLowerCase()}).`}
          icon={SlidersHorizontal}
          actions={
            <>
              <Pill icon={ListOrdered} className="tabular-nums">
                {definitionSummary.stepCount} {definitionSummary.stepCount === 1 ? 'step' : 'steps'}
              </Pill>
              <Link
                href={`/runbooks/${runbookId}?tab=builder&editor=inputs`}
                className={panelLinkClass}
              >
                Open workflow
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </>
          }
        >
          {definitionSummary.inputs.length ? (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {definitionSummary.inputs.map(input => (
                <li
                  key={input.key}
                  className="flex min-w-0 items-start justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {input.label || input.key}
                    </span>
                    <code className="block truncate font-mono text-[11px] text-muted-foreground">
                      {'${{ inputs.'}
                      {input.key}
                      {' }}'}
                    </code>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Pill>{input.type.replaceAll('_', ' ').toLowerCase()}</Pill>
                    {input.required && <Pill tone="warning">required</Pill>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyHint
              icon={SlidersHorizontal}
              title="No inputs"
              description="This runbook runs with fixed values. Add typed inputs to reuse it across services."
            />
          )}
        </SectionCard>
      )}
    </div>
  );
}
