'use client';

import { memo, useId, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  GitCompare,
  ListChecks,
  Pencil,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';

import { TraceDetail } from './TraceDetail';
import type { Data, Counts, Area } from './presentation-types';
import { toneClasses } from './workspace/status';
import { NativeSelect } from './authoring/primitives';

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
      className="overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/20 px-3.5 py-2.5 sm:px-4">
        <h3
          id={headingId}
          className="flex items-center gap-2 text-xs font-semibold tracking-tight text-foreground"
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {title}
        </h3>
        {action}
      </div>
      <div className="p-3.5 sm:p-4">{children}</div>
    </section>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <li className="flex items-start gap-2.5 text-xs text-foreground/90">
      <Icon
        className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', ok ? toneClasses.ok : toneClasses.warn)}
        aria-hidden="true"
      />
      <span className="leading-relaxed">
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

  const evaluated = counts?.evaluated ?? 0;
  const same = counts?.same ?? 0;
  const parityPct = evaluated > 0 ? ((same / evaluated) * 100).toFixed(1) : null;
  const diffRoutes = counts?.routes ?? 0;
  const errors = counts?.errors ?? 0;

  return (
    <div className="space-y-3.5">
      {/* Pending candidate alert if evaluating in parallel */}
      {data.candidateVersion && (
        <section
          aria-label="Pending candidate"
          className="overflow-hidden rounded-xl border border-primary/40 bg-primary/5 p-3.5 shadow-xs"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-primary" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-foreground">
                  Pending candidate · Version {data.candidateVersion.versionNumber}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Evaluating live incident traffic in parallel shadow mode without applying side
                  effects.
                </p>
                <p className="mt-1 text-xs font-medium tabular-nums text-muted-foreground">
                  Errors / fallbacks:{' '}
                  <span className="font-semibold text-foreground">
                    {(data.candidateAggregates ?? []).reduce((sum, row) => sum + row.errors, 0)} /{' '}
                    {(data.candidateAggregates ?? []).reduce((sum, row) => sum + row.fallbacks, 0)}
                  </span>
                </p>
              </div>
            </div>
            {data.canPublish && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" className="h-8 text-xs font-medium" onClick={onActivateCandidate}>
                  Activate candidate (LIVE cutover)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={onDiscardCandidate}
                >
                  Discard candidate
                </Button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Top Stats Strip */}
      <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-xl border border-border/80 bg-card p-3 shadow-xs">
          <dt className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Evaluated · 7 days</span>
            <Activity className="h-3.5 w-3.5 text-sky-500/70" aria-hidden="true" />
          </dt>
          <dd className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold tracking-tight tabular-nums text-foreground">
              {evaluated.toLocaleString()}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">7d window</span>
          </dd>
        </div>

        <div className="rounded-xl border border-border/80 bg-card p-3 shadow-xs">
          <dt className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Same behavior</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/70" aria-hidden="true" />
          </dt>
          <dd className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold tracking-tight tabular-nums text-foreground">
              {same.toLocaleString()}
            </span>
            {parityPct && (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
              >
                {parityPct}% parity
              </Badge>
            )}
          </dd>
        </div>

        <div className="rounded-xl border border-border/80 bg-card p-3 shadow-xs">
          <dt className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Different routes</span>
            <GitCompare className="h-3.5 w-3.5 text-indigo-500/70" aria-hidden="true" />
          </dt>
          <dd className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold tracking-tight tabular-nums text-foreground">
              {diffRoutes.toLocaleString()}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">
              {counts?.priorities ?? 0} priority diffs
            </span>
          </dd>
        </div>

        <div className="rounded-xl border border-border/80 bg-card p-3 shadow-xs">
          <dt className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
            <span>Fallbacks / errors</span>
            {errors === 0 ? (
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/70" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500/70" aria-hidden="true" />
            )}
          </dt>
          <dd className="mt-1 flex items-baseline justify-between">
            <span className="text-xl font-bold tracking-tight tabular-nums text-foreground">
              {errors}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">
              {errors === 0 ? 'Zero failures' : 'Action required'}
            </span>
          </dd>
        </div>
      </dl>

      {/* Comparative Parity / Alignment Bar */}
      {evaluated > 0 && (
        <section
          aria-label="Behavior alignment and routing parity"
          className="rounded-xl border border-border/80 bg-card p-3.5 shadow-xs space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <GitCompare className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Routing Parity &amp; Behavior Alignment
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {parityPct ?? '0'}% aligned · {same.toLocaleString()} identical /{' '}
              {diffRoutes.toLocaleString()} divergent routes
            </span>
          </div>

          <div
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/80"
            role="progressbar"
            aria-valuenow={parseFloat(parityPct ?? '0')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Routing parity: ${parityPct ?? '0'}%`}
          >
            <div
              className="bg-emerald-500 transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, (same / evaluated) * 100))}%` }}
              title={`Identical: ${same} (${parityPct}%)`}
            />
            <div
              className="bg-indigo-500 transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, (diffRoutes / evaluated) * 100))}%` }}
              title={`Divergent routes: ${diffRoutes}`}
            />
            {errors > 0 && (
              <div
                className="bg-amber-500 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, (errors / evaluated) * 100))}%` }}
                title={`Errors/fallbacks: ${errors}`}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                <span>Identical routes ({same.toLocaleString()})</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-indigo-500 inline-block" />
                <span>Divergent routes ({diffRoutes.toLocaleString()})</span>
              </span>
              {errors > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" />
                  <span>Errors / fallbacks ({errors})</span>
                </span>
              )}
            </div>
            <span>Based on {evaluated.toLocaleString()} shadow evaluations</span>
          </div>
        </section>
      )}

      {/* Main Split: Readiness & Governance vs Action Hub */}
      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            icon={ListChecks}
            title="LIVE readiness · active version"
            action={
              <Badge
                variant="outline"
                className={cn(
                  'gap-1 text-[10px] font-semibold',
                  data.enabled &&
                    !!data.activeVersion &&
                    !!counts?.evaluated &&
                    !counts?.errors &&
                    !data.unmappedCount
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    data.enabled &&
                      !!data.activeVersion &&
                      !!counts?.evaluated &&
                      !counts?.errors &&
                      !data.unmappedCount
                      ? 'bg-emerald-500'
                      : 'bg-amber-500'
                  )}
                  aria-hidden="true"
                />
                {
                  [
                    data.enabled,
                    !!data.activeVersion,
                    !!counts?.evaluated,
                    !counts?.errors,
                    !data.unmappedCount,
                  ].filter(Boolean).length
                }{' '}
                / 5 checks ready
              </Badge>
            }
          >
            <div className="space-y-3">
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
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-medium"
                  onClick={() => setArea('context')}
                >
                  Review unmapped values
                </Button>
              )}

              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground/90">
                  {data.mode === 'LIVE'
                    ? 'New incidents apply the published routing policy. Existing incidents keep their pinned decisions.'
                    : data.mode === 'SHADOW'
                      ? 'Automation compares outcomes; incidents continue using the service route.'
                      : 'Automation is disabled for this service.'}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  Queue health and capacity approval require deployment review. A successful sample
                  test is not a capacity approval. Shadow counts update asynchronously.
                </p>
              </div>
            </div>
          </Panel>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-3.5 shadow-xs sm:p-4">
          <div className="space-y-2.5">
            <div>
              <p className="text-xs font-semibold tracking-tight text-foreground">Next steps</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Change the draft, then verify it against a sample before publishing.
              </p>
            </div>
            <div className="space-y-1.5 pt-1">
              <Button
                className="group h-8.5 w-full justify-between px-3 text-xs font-medium shadow-xs"
                onClick={() => setArea('rules')}
              >
                <span className="flex items-center gap-2">
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit automation
                </span>
                <ArrowRight className="h-3 w-3 opacity-60 transition-transform group-hover:translate-x-0.5" />
              </Button>
              <Button
                variant="outline"
                className="group h-8.5 w-full justify-between px-3 text-xs font-medium"
                onClick={() => setArea('test')}
              >
                <span className="flex items-center gap-2">
                  <FlaskConical className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  Test an event
                </span>
                <ArrowRight className="h-3 w-3 opacity-60 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </div>
          </div>

          <div className="mt-4 border-t border-border/60 pt-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Skipped escalations</span>
              <span className="font-mono font-medium text-foreground">{counts?.skips ?? 0}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Priority overrides</span>
              <span className="font-mono font-medium text-foreground">
                {counts?.priorities ?? 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Shadow Differences & Evaluation Log */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        <Panel icon={GitCompare} title="Recent Shadow differences">
          {differences.length ? (
            <ul className="divide-y divide-border/60 text-xs">
              {differences.slice(0, 5).map(trace => {
                const detail = trace.detail as TraceDetailShape;
                return (
                  <li
                    key={trace.id}
                    className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="font-medium text-foreground">
                      {detail.result?.matchedRule?.name ?? 'Service fallback'}
                    </span>
                    <div className="inline-flex items-center gap-1.5">
                      <ArrowRight className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
                      <Badge
                        variant="secondary"
                        className="px-1.5 py-0 text-[10px] font-mono text-muted-foreground font-normal"
                      >
                        {detail.fallbackReason ??
                          (detail.result?.outcome?.type === 'NO_ESCALATION'
                            ? 'No responder paging'
                            : (detail.policyName ?? 'Service default'))}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No differences in the latest 25 evaluations. Review the seven-day totals above for the
              wider window.
            </p>
          )}
        </Panel>

        <Panel
          icon={Activity}
          title="Recent evaluations"
          action={
            <div className="flex items-center gap-1.5">
              <label htmlFor={filterId} className="sr-only">
                Filter evaluations
              </label>
              <NativeSelect
                id={filterId}
                wrapperClassName="w-auto"
                className="h-7 text-[11px] font-medium pr-7 pl-2"
                iconClassName="right-2 h-3 w-3"
                value={traceFilter}
                onChange={event => setTraceFilter(event.target.value)}
              >
                <option value="ALL">All evaluations</option>
                <option value="NO_ESCALATION">Would skip</option>
                <option value="ESCALATION_POLICY">Selected policy</option>
                <option value="ERROR">Fallbacks / errors</option>
              </NativeSelect>
            </div>
          }
        >
          {data.traces.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No evaluations yet. Enable shadow mode after publishing to compare behavior.
            </p>
          )}
          {data.traces.length > 0 && visibleTraces.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No recent evaluations match this filter.
            </p>
          )}
          <div className="space-y-1.5">
            {visibleTraces.slice(0, 5).map(trace => (
              <details
                key={trace.id}
                className="overflow-hidden rounded-lg border border-border/70 bg-background text-xs transition-colors hover:border-border"
              >
                <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <div className="flex items-center gap-2">
                    <Link
                      className="font-medium text-primary hover:underline"
                      href={`/incidents/${trace.incidentId}`}
                    >
                      Incident
                    </Link>
                    <Badge
                      variant="outline"
                      className={cn(
                        'px-1.5 py-0 font-mono text-[9px] font-bold uppercase tracking-wide',
                        trace.mode === 'LIVE'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      )}
                    >
                      {trace.mode}
                    </Badge>
                    <span className="text-foreground/80">
                      {trace.fallbackReason ?? 'Evaluated'}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'font-mono text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded',
                      trace.durationMs < 5
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {trace.durationMs.toFixed(2)} ms
                  </span>
                </summary>
                <div className="border-t border-border/60 bg-muted/10 px-3 py-2">
                  <TraceDetail detail={trace.detail} />
                </div>
              </details>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
});
