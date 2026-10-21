'use client';

import { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Layers,
  Minus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

export type StepChange = 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';

export type StepDiffSide = {
  name?: string;
  type?: string;
  risk?: string | null;
  description?: string;
  summary: string;
  configuration: string;
} | null;

export type StepDiffItem = {
  key: string;
  change: StepChange;
  before: StepDiffSide;
  after: StepDiffSide;
};

const CHANGE_CONFIG = {
  ADDED: {
    card: 'border-emerald-500/30 bg-emerald-500/[0.02] dark:border-emerald-500/20',
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: Plus,
    label: 'Added',
  },
  REMOVED: {
    card: 'border-rose-500/30 bg-rose-500/[0.02] dark:border-rose-500/20',
    badge: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    icon: Minus,
    label: 'Removed',
  },
  CHANGED: {
    card: 'border-amber-500/30 bg-amber-500/[0.02] dark:border-amber-500/20',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    icon: RefreshCw,
    label: 'Changed',
  },
  UNCHANGED: {
    card: 'border-border/80 dark:border-border/60 bg-card/60',
    badge: 'border-border text-muted-foreground bg-muted/40',
    icon: Check,
    label: 'Unchanged',
  },
} as const;

function getRiskTone(risk?: string | null) {
  if (!risk) return 'border-border text-muted-foreground bg-muted/30';
  switch (risk.toUpperCase()) {
    case 'READ_ONLY':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300';
    case 'REVERSIBLE_CHANGE':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    case 'IRREVERSIBLE_ACTION':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300';
    default:
      return 'border-border text-muted-foreground bg-muted/30';
  }
}

function DiffPane({
  heading,
  side,
  emptyLabel,
  tone,
  versionNumber,
  stepKey,
}: {
  heading: string;
  side: StepDiffSide;
  emptyLabel: string;
  tone?: 'before' | 'after';
  versionNumber: number;
  stepKey: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!side?.configuration) return;
    navigator.clipboard.writeText(side.configuration);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!side) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/15 p-6 text-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
          {tone === 'before' ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </div>
        <p className="mt-2 text-xs font-medium text-muted-foreground">{emptyLabel}</p>
        <p className="text-[11px] text-muted-foreground/70">
          {tone === 'before'
            ? `Not defined in version v${versionNumber}`
            : `Removed from version v${versionNumber}`}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col min-w-0 rounded-xl border p-3.5 transition-colors',
        tone === 'before' &&
          'border-rose-500/30 bg-rose-500/[0.03] dark:border-rose-500/20 dark:bg-rose-950/10',
        tone === 'after' &&
          'border-emerald-500/30 bg-emerald-500/[0.03] dark:border-emerald-500/20 dark:bg-emerald-950/10',
        !tone && 'border-border/80 bg-card/60'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              tone === 'before'
                ? 'bg-rose-500'
                : tone === 'after'
                  ? 'bg-emerald-500'
                  : 'bg-muted-foreground'
            )}
            aria-hidden="true"
          />
          <h3 className="text-xs font-semibold text-foreground tracking-tight">{heading}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {side.type && (
            <span className="rounded-md border border-border/80 bg-background/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground">
              {side.type}
            </span>
          )}
          {side.risk && (
            <span
              className={cn(
                'rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium',
                getRiskTone(side.risk)
              )}
            >
              {side.risk}
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground break-words">{side.summary}</div>

      <div className="mt-2.5 flex flex-col min-w-0">
        <div className="flex items-center justify-between gap-2 bg-zinc-900/95 px-3 py-1.5 rounded-t-lg border-x border-t border-zinc-800 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1.5 font-mono text-[10px]">
            <Code2 className="h-3 w-3 text-zinc-500" />
            step-config.json
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            title="Copy step JSON"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-b-lg bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300 border border-zinc-800 ring-1 ring-inset ring-black/40">
          {side.configuration}
        </pre>
      </div>
    </div>
  );
}

function StepDiffCard({
  step,
  baseVersion,
  nextVersion,
}: {
  step: StepDiffItem;
  baseVersion: number;
  nextVersion: number;
}) {
  const [isExpanded, setIsExpanded] = useState(step.change !== 'UNCHANGED');
  const config = CHANGE_CONFIG[step.change];
  const Icon = config.icon;
  const isChanged = step.change === 'CHANGED';

  // Check if risk or type changed
  const riskChanged =
    isChanged && step.before?.risk && step.after?.risk && step.before.risk !== step.after.risk;
  const typeChanged =
    isChanged && step.before?.type && step.after?.type && step.before.type !== step.after.type;

  return (
    <article
      data-change={step.change}
      className={cn(
        'group rounded-2xl border bg-card/90 dark:bg-card/50 backdrop-blur-xs p-4 sm:p-5 shadow-xs transition-all hover:shadow-md',
        config.card
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <Badge
            variant="outline"
            className={cn('inline-flex items-center gap-1 font-mono text-[10px]', config.badge)}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {step.change}
          </Badge>
          <h2 className="break-all font-mono text-sm font-semibold text-foreground tracking-tight">
            {step.key}
          </h2>
          {(step.after?.name || step.before?.name) && (
            <span className="text-xs text-muted-foreground truncate max-w-sm">
              · {step.after?.name || step.before?.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {step.change === 'UNCHANGED' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronRight className="h-3.5 w-3.5" />
                  Inspect config
                </>
              )}
            </Button>
          )}
        </div>
      </header>

      {/* Specific field diff callout if risk or type modified */}
      {isChanged && (riskChanged || typeChanged) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
          <div className="flex flex-wrap items-center gap-2">
            {riskChanged && (
              <span>
                Risk level modified from <code className="font-bold">{step.before?.risk}</code> to{' '}
                <code className="font-bold">{step.after?.risk}</code>
              </span>
            )}
            {typeChanged && (
              <span>
                Step type changed from <code className="font-bold">{step.before?.type}</code> to{' '}
                <code className="font-bold">{step.after?.type}</code>
              </span>
            )}
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="mt-4 grid gap-3.5 md:grid-cols-2">
          <DiffPane
            heading={`Before · v${baseVersion}`}
            side={step.before}
            emptyLabel="Not in this version"
            tone={isChanged || step.change === 'REMOVED' ? 'before' : undefined}
            versionNumber={baseVersion}
            stepKey={step.key}
          />
          <DiffPane
            heading={`After · v${nextVersion}`}
            side={step.after}
            emptyLabel="Removed"
            tone={isChanged || step.change === 'ADDED' ? 'after' : undefined}
            versionNumber={nextVersion}
            stepKey={step.key}
          />
        </div>
      )}
    </article>
  );
}

export function VersionStepDiff({
  steps,
  baseVersion,
  nextVersion,
}: {
  steps: StepDiffItem[];
  baseVersion: number;
  nextVersion: number;
}) {
  const [filter, setFilter] = useState<'ALL' | 'CHANGED' | 'UNCHANGED'>('ALL');
  const [showUnchanged, setShowUnchanged] = useState(false);

  const changed = steps.filter(step => step.change !== 'UNCHANGED');
  const unchanged = steps.filter(step => step.change === 'UNCHANGED');

  const addedCount = steps.filter(s => s.change === 'ADDED').length;
  const removedCount = steps.filter(s => s.change === 'REMOVED').length;
  const changedCount = steps.filter(s => s.change === 'CHANGED').length;
  const unchangedCount = unchanged.length;

  const filteredSteps = filter === 'CHANGED' ? changed : filter === 'UNCHANGED' ? unchanged : steps;

  return (
    <section aria-label="Workflow changes" className="space-y-4">
      {/* Overview Metric Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-4 sm:p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-border/80 bg-background/80 px-2.5 py-1 text-xs font-semibold text-foreground">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            {steps.length} {steps.length === 1 ? 'step' : 'steps'} analyzed
          </span>

          <span
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums',
              addedCount > 0
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-border text-muted-foreground bg-muted/30'
            )}
          >
            <Plus className="h-3 w-3" />
            {addedCount} added
          </span>

          <span
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums',
              removedCount > 0
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : 'border-border text-muted-foreground bg-muted/30'
            )}
          >
            <Minus className="h-3 w-3" />
            {removedCount} removed
          </span>

          <span
            className={cn(
              'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums',
              changedCount > 0
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-border text-muted-foreground bg-muted/30'
            )}
          >
            <RefreshCw className="h-3 w-3" />
            {changedCount} changed
          </span>

          <span className="flex items-center gap-1 rounded-full border border-border text-muted-foreground bg-muted/30 px-2.5 py-1 text-xs font-medium tabular-nums">
            <Check className="h-3 w-3 text-muted-foreground/80" />
            {unchangedCount} unchanged
          </span>
        </div>

        {/* View Filter segmented toggles */}
        <div className="flex items-center gap-1 w-full sm:w-auto rounded-xl border border-border/70 bg-muted/30 p-1 text-xs">
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={cn(
              'flex-1 sm:flex-none rounded-lg px-2.5 py-1 font-medium transition-colors text-center',
              filter === 'ALL'
                ? 'bg-background text-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All ({steps.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('CHANGED')}
            className={cn(
              'flex-1 sm:flex-none rounded-lg px-2.5 py-1 font-medium transition-colors text-center',
              filter === 'CHANGED'
                ? 'bg-background text-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Changed ({changed.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('UNCHANGED')}
            className={cn(
              'flex-1 sm:flex-none rounded-lg px-2.5 py-1 font-medium transition-colors text-center',
              filter === 'UNCHANGED'
                ? 'bg-background text-foreground shadow-2xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Unchanged ({unchanged.length})
          </button>
        </div>
      </div>

      {/* Identical State Message when no step differences exist */}
      {changed.length === 0 && (
        <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-6 shadow-xs text-center space-y-2">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">
            No step differences between v{baseVersion} and v{nextVersion}.
          </h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Execution steps, risk levels, and configurations are identical between these two
            versions.
          </p>
        </div>
      )}

      {/* When filtering by ALL, list changed steps first, then provide unchanged steps accordion */}
      {filter === 'ALL' && (
        <>
          {changed.map(step => (
            <StepDiffCard
              key={step.key}
              step={step}
              baseVersion={baseVersion}
              nextVersion={nextVersion}
            />
          ))}

          {unchanged.length > 0 && (
            <details className="group rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs overflow-hidden [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex w-full cursor-pointer select-none items-center justify-between px-5 py-3.5 text-left text-xs font-medium text-foreground hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                  </span>
                  <span>
                    Show {unchanged.length} unchanged {unchanged.length === 1 ? 'step' : 'steps'}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">
                  v{baseVersion} = v{nextVersion}
                </span>
              </summary>

              <div className="border-t border-border/60 p-4 space-y-3 bg-muted/10">
                {unchanged.map(step => (
                  <StepDiffCard
                    key={step.key}
                    step={step}
                    baseVersion={baseVersion}
                    nextVersion={nextVersion}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {/* When filter is CHANGED or UNCHANGED, list direct filtered items */}
      {filter !== 'ALL' && (
        <div className="space-y-3">
          {filteredSteps.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-card/60 p-6 text-center text-xs text-muted-foreground">
              No steps found for this filter.
            </p>
          ) : (
            filteredSteps.map(step => (
              <StepDiffCard
                key={step.key}
                step={step}
                baseVersion={baseVersion}
                nextVersion={nextVersion}
              />
            ))
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed px-1">
        Changes include configuration, prechecks, verification and approval settings; credential
        fields are masked. This comparison performs no operation.
      </p>
    </section>
  );
}
