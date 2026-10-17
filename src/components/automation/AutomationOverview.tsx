'use client';

import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';

import { TraceDetail } from './TraceDetail';
import type { Data, Counts, Area } from './presentation-types';
const controlClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm max-w-full';
export function AutomationOverview({
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
  const candidateCounts = (data.candidateAggregates ?? []).reduce(
    (acc, cur) => ({
      evaluated: acc.evaluated + cur.evaluated,
      same: acc.same + cur.same,
      routes: acc.routes + cur.routeDifferent,
      priorities: acc.priorities + cur.priorityDifferent,
      skips: acc.skips + cur.noEscalationDifferent,
      errors: acc.errors + cur.errors + cur.fallbacks,
    }),
    { evaluated: 0, same: 0, routes: 0, priorities: 0, skips: 0, errors: 0 }
  );

  return (
    <>
      {data.candidateVersion && (
        <div className="rounded-xl border border-primary/40 bg-muted/20 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-primary">
                Pending candidate · Version {data.candidateVersion.versionNumber}
              </h3>
              <p className="text-xs text-muted-foreground">
                Published {new Date(data.candidateVersion.publishedAt).toLocaleString()} · Checksum{' '}
                {data.candidateVersion.checksum.slice(0, 8)}
              </p>
            </div>
            {data.canPublish && (
              <div className="flex gap-2">
                <Button size="sm" onClick={onActivateCandidate}>
                  Activate candidate (LIVE cutover)
                </Button>
                <Button size="sm" variant="outline" onClick={onDiscardCandidate}>
                  Discard candidate
                </Button>
              </div>
            )}
          </div>
          <p className="text-sm">
            This candidate is evaluating live incident traffic in parallel shadow mode without applying side effects.
          </p>
          <div className="grid gap-2 sm:grid-cols-3 text-sm">
            <div className="rounded border bg-background p-2">
              <span className="text-muted-foreground block text-xs">Evaluations</span>
              <span className="text-lg font-bold">{candidateCounts.evaluated}</span>
            </div>
            <div className="rounded border bg-background p-2">
              <span className="text-muted-foreground block text-xs">Agreement</span>
              <span className="text-lg font-bold">
                {candidateCounts.evaluated
                  ? `${((candidateCounts.same / candidateCounts.evaluated) * 100).toFixed(1)}%`
                  : '—'}
              </span>
            </div>
            <div className="rounded border bg-background p-2">
              <span className="text-muted-foreground block text-xs">Errors / Fallbacks</span>
              <span className="text-lg font-bold">{candidateCounts.errors}</span>
            </div>
          </div>
        </div>
      )}
      <div className="rounded-xl border p-4 space-y-2">
        <h3 className="font-semibold">LIVE readiness · active version</h3>
        <p>{data.enabled ? '✓ Global automation enabled' : '⚠ Global automation OFF'}</p>
        <p>
          {data.activeVersion
            ? `✓ Published version ${data.activeVersion.versionNumber}`
            : '⚠ Publish a version first'}
        </p>
        <p>
          {counts?.evaluated
            ? `✓ ${counts.evaluated} Shadow evaluations · ${((counts.same / counts.evaluated) * 100).toFixed(1)}% same behavior`
            : '⚠ No Shadow traffic for this version'}
        </p>
        <p>
          {counts?.errors
            ? `⚠ ${counts.errors} fallbacks/errors require review`
            : 'No recorded Shadow fallbacks/errors'}
        </p>
        <p className="text-sm text-muted-foreground">
          Queue health and capacity approval require deployment review. A successful sample test is
          not a capacity approval. Shadow counts update asynchronously.
        </p>
        <p>
          {data.unmappedCount
            ? `⚠ ${data.unmappedCount} unmapped context values require review`
            : '✓ No recorded unmapped context values'}
        </p>
        {!!data.unmappedCount && (
          <Button variant="outline" onClick={() => setArea('context')}>
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
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Evaluated · 7 days', counts?.evaluated],
          ['Same behavior', counts?.same],
          ['Different routes', counts?.routes],
          ['Fallbacks / errors', counts?.errors],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <CardHeader>
              <CardTitle className="text-sm">{label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{value ?? 0}</CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm">
        Different priority: {counts?.priorities ?? 0} · Would skip escalation: {counts?.skips ?? 0}
      </p>
      <div className="rounded-xl border p-4 space-y-2">
        <h3 className="font-semibold">Recent Shadow differences</h3>
        {data.traces
          .filter(
            trace =>
              trace.mode === 'SHADOW' &&
              (trace.detail as { shadowDifferent?: boolean }).shadowDifferent
          )
          .slice(0, 5)
          .map(trace => {
            const detail = trace.detail as {
              policyName?: string;
              fallbackReason?: string;
              result?: { matchedRule?: { name: string }; outcome?: { type: string } };
            };
            return (
              <p key={trace.id} className="text-sm">
                {detail.result?.matchedRule?.name ?? 'Service fallback'} →{' '}
                {detail.fallbackReason ??
                  (detail.result?.outcome?.type === 'NO_ESCALATION'
                    ? 'No responder paging'
                    : (detail.policyName ?? 'Service default'))}
              </p>
            );
          })}
        {!data.traces.some(
          trace =>
            trace.mode === 'SHADOW' &&
            (trace.detail as { shadowDifferent?: boolean }).shadowDifferent
        ) && (
          <p className="text-sm text-muted-foreground">
            No differences in the latest 25 evaluations. Review the seven-day totals above for the
            wider window.
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => setArea('rules')}>Edit automation</Button>
        <Button variant="outline" onClick={() => setArea('test')}>
          Test an event
        </Button>
      </div>
      <h3 className="font-semibold">Recent evaluations</h3>
      {data.traces.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Enable shadow mode after publishing to compare behavior.
        </p>
      )}
      <label className="block text-sm">
        Filter evaluations
        <select
          className={`${controlClass} ml-2`}
          value={traceFilter}
          onChange={event => setTraceFilter(event.target.value)}
        >
          <option value="ALL">All recent evaluations</option>
          <option value="NO_ESCALATION">Would skip escalation</option>
          <option value="ESCALATION_POLICY">Selected policy</option>
          <option value="ERROR">Fallbacks / errors</option>
        </select>
      </label>
      {data.traces
        .filter(trace => {
          const detail = trace.detail as {
            result?: { outcome?: { type?: string } };
            fallbackReason?: string;
          };
          return (
            traceFilter === 'ALL' ||
            (traceFilter === 'ERROR'
              ? !!detail.fallbackReason
              : detail.result?.outcome?.type === traceFilter)
          );
        })
        .map(trace => (
          <details key={trace.id} className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm">
              <Link className="underline" href={`/incidents/${trace.incidentId}`}>
                Incident
              </Link>{' '}
              · {trace.mode} · {trace.fallbackReason ?? 'Evaluated'} · {trace.durationMs.toFixed(2)}{' '}
              ms
            </summary>
            <TraceDetail detail={trace.detail} />
          </details>
        ))}
    </>
  );
}
