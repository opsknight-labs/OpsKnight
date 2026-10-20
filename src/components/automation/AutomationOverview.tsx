'use client';

import { memo, useId, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  GitCompare,
  ListChecks,
  Pencil,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

import { TraceDetail } from './TraceDetail';
import type { Data, Counts, Area } from './presentation-types';
import { controlClass } from './workspace/constants';
import { toneClasses } from './workspace/status';

type TraceDetailShape = {
  shadowDifferent?: boolean;
  policyName?: string;
  fallbackReason?: string;
  result?: { matchedRule?: { name: string }; outcome?: { type?: string } };
};

function Panel({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3 sm:px-5">
        <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {title}
        </h3>
        {action}
      </div>
      <div className="space-y-3 p-4 sm:p-5">{children}</div>
    </section>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <li className="flex gap-2 text-sm">
      <Icon
        className={cn('mt-0.5 h-4 w-4 shrink-0', ok ? toneClasses.ok : toneClasses.warn)}
        aria-hidden="true"
      />
      <span>
        <span className="sr-only">{ok ? 'Ready: ' : 'Needs attention: '}</span>
        {children}
      </span>
    </li>
  );
}

export const AutomationOverview = memo(function AutomationOverview({
  data,
  counts,
  traceFilter,
  setTraceFilter,
  setArea,
  onActivateCandidate,
  onDiscardCandidate,
}: {
  data: Data;
  counts?: Counts;
  traceFilter: string;
  setTraceFilter: (value: string) => void;
  setArea: (area: Area) => void;
  onActivateCandidate?: () => void;
  onDiscardCandidate?: () => void;
}) {
  const filterId = useId();
  const differences = useMemo(
    () =>
      data.traces.filter(
        trace => trace.mode === 'SHADOW' && (trace.detail as TraceDetailShape).shadowDifferent
      ),
    [data.traces]
  );
  const visibleTraces = useMemo(
    () =>
      data.traces.filter(trace => {
        const detail = trace.detail as TraceDetailShape;
        return (
          traceFilter === 'ALL' ||
          (traceFilter === 'ERROR'
            ? !!detail.fallbackReason
            : detail.result?.outcome?.type === traceFilter)
        );
      }),
    [data.traces, traceFilter]
  );
  const stats: Array<[string, number | undefined]> = [
    ['Evaluated · 7 days', counts?.evaluated],
    ['Same behavior', counts?.same],
    ['Different routes', counts?.routes],
    ['Fallbacks / errors', counts?.errors],
  ];
  return (
    <>
      {data.candidateVersion && (
        <Panel icon={GitCompare} title={`Pending candidate · Version ${data.candidateVersion.versionNumber}`}
          action={data.canPublish ? <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onActivateCandidate}>Activate candidate (LIVE cutover)</Button>
            <Button size="sm" variant="outline" onClick={onDiscardCandidate}>Discard candidate</Button>
          </div> : undefined}>
          <p className="text-sm">This candidate is evaluating live incident traffic in parallel shadow mode without applying side effects.</p>
          <p className="text-sm font-medium tabular-nums">
            Errors / fallbacks: <span>{(data.candidateAggregates ?? []).reduce((sum, row) => sum + row.errors, 0)} / {(data.candidateAggregates ?? []).reduce((sum, row) => sum + row.fallbacks, 0)}</span>
          </p>
        </Panel>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel icon={ListChecks} title="LIVE readiness · active version">
            <ul className="space-y-2">
              <Check ok={data.enabled}>
                {data.enabled ? 'Global automation enabled' : 'Global automation OFF'}
              </Check>
              <Check ok={!!data.activeVersion}>
                {data.activeVersion
                  ? `Published version ${data.activeVersion.versionNumber}`
                  : 'Publish a version first'}
              </Check>
              <Check ok={!!counts?.evaluated}>
                {counts?.evaluated
                  ? `${counts.evaluated} Shadow evaluations · ${((counts.same / counts.evaluated) * 100).toFixed(1)}% same behavior`
                  : 'No Shadow traffic for this version'}
              </Check>
              <Check ok={!counts?.errors}>
                {counts?.errors
                  ? `${counts.errors} fallbacks/errors require review`
                  : 'No recorded Shadow fallbacks/errors'}
              </Check>
              <Check ok={!data.unmappedCount}>
                {data.unmappedCount
                  ? `${data.unmappedCount} unmapped context values require review`
                  : 'No recorded unmapped context values'}
              </Check>
            </ul>
            {!!data.unmappedCount && (
              <Button variant="outline" className="h-10" onClick={() => setArea('context')}>
                Review unmapped values
              </Button>
            )}
            <p className="text-sm">
              {data.mode === 'LIVE'
                ? 'New incidents apply the published routing policy. Existing incidents keep their pinned decisions.'
                : data.mode === 'SHADOW'
                  ? 'Automation compares outcomes; incidents continue using the service route.'
                  : 'Automation is disabled for this service.'}
            </p>
            <p className="text-xs text-muted-foreground">
              Queue health and capacity approval require deployment review. A successful sample test
              is not a capacity approval. Shadow counts update asynchronously.
            </p>
          </Panel>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-5">
          <p className="text-sm font-semibold">Next steps</p>
          <p className="text-xs text-muted-foreground">
            Change the draft, then verify it against a sample before publishing.
          </p>
          <Button className="h-10 justify-start" onClick={() => setArea('rules')}>
            <Pencil aria-hidden="true" />
            Edit automation
          </Button>
          <Button variant="outline" className="h-10 justify-start" onClick={() => setArea('test')}>
            <FlaskConical aria-hidden="true" />
            Test an event
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value ?? 0}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        Different priority: {counts?.priorities ?? 0} · Would skip escalation: {counts?.skips ?? 0}
      </p>
      <Panel icon={GitCompare} title="Recent Shadow differences">
        {differences.length ? (
          <ul className="divide-y text-sm">
            {differences.slice(0, 5).map(trace => {
              const detail = trace.detail as TraceDetailShape;
              return (
                <li key={trace.id} className="py-2 first:pt-0 last:pb-0">
                  <span className="font-medium">
                    {detail.result?.matchedRule?.name ?? 'Service fallback'}
                  </span>{' '}
                  →{' '}
                  {detail.fallbackReason ??
                    (detail.result?.outcome?.type === 'NO_ESCALATION'
                      ? 'No responder paging'
                      : (detail.policyName ?? 'Service default'))}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No differences in the latest 25 evaluations. Review the seven-day totals above for the
            wider window.
          </p>
        )}
      </Panel>
      <Panel
        icon={Activity}
        title="Recent evaluations"
        action={
          <div className="flex items-center gap-2">
            <label htmlFor={filterId} className="text-xs text-muted-foreground">
              Filter evaluations
            </label>
            <select
              id={filterId}
              className={controlClass}
              value={traceFilter}
              onChange={event => setTraceFilter(event.target.value)}
            >
              <option value="ALL">All recent evaluations</option>
              <option value="NO_ESCALATION">Would skip escalation</option>
              <option value="ESCALATION_POLICY">Selected policy</option>
              <option value="ERROR">Fallbacks / errors</option>
            </select>
          </div>
        }
      >
        {data.traces.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No evaluations yet. Enable shadow mode after publishing to compare behavior.
          </p>
        )}
        {data.traces.length > 0 && visibleTraces.length === 0 && (
          <p className="text-sm text-muted-foreground">No recent evaluations match this filter.</p>
        )}
        {visibleTraces.map(trace => (
          <details key={trace.id} className="rounded-lg border bg-background">
            <summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Link
                className="font-medium underline underline-offset-2"
                href={`/incidents/${trace.incidentId}`}
              >
                Incident
              </Link>{' '}
              · {trace.mode} · {trace.fallbackReason ?? 'Evaluated'} ·{' '}
              <span className="tabular-nums">{trace.durationMs.toFixed(2)} ms</span>
            </summary>
            <div className="border-t px-3 py-2">
              <TraceDetail detail={trace.detail} />
            </div>
          </details>
        ))}
      </Panel>
    </>
  );
});
