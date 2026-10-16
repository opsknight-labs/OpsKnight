/* eslint-disable security/detect-object-injection -- StepChange is a closed enum */
import { Minus, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';

export type StepChange = 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';

export type StepDiffSide = { summary: string; configuration: string } | null;

export type StepDiffItem = {
  key: string;
  change: StepChange;
  before: StepDiffSide;
  after: StepDiffSide;
};

const CHANGE_STYLES: Record<StepChange, { card: string; badge: string; label: string }> = {
  ADDED: {
    card: 'border-emerald-500/30',
    badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    label: 'Added',
  },
  REMOVED: {
    card: 'border-rose-500/30',
    badge: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    label: 'Removed',
  },
  CHANGED: {
    card: 'border-amber-500/30',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    label: 'Changed',
  },
  UNCHANGED: {
    card: '',
    badge: 'text-muted-foreground',
    label: 'Unchanged',
  },
};

function DiffPane({
  heading,
  side,
  emptyLabel,
  tone,
}: {
  heading: string;
  side: StepDiffSide;
  emptyLabel: string;
  tone?: 'before' | 'after';
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border p-3.5',
        !side && 'border-dashed bg-muted/20',
        side && tone === 'before' && 'border-rose-500/20 bg-rose-500/[0.03]',
        side && tone === 'after' && 'border-emerald-500/20 bg-emerald-500/[0.03]',
        side && !tone && 'bg-muted/20'
      )}
    >
      <h3 className="flex items-center gap-1.5 !text-xs !leading-normal font-medium text-muted-foreground">
        {tone === 'before' && side && (
          <Minus className="h-3 w-3 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        )}
        {tone === 'after' && side && (
          <Plus className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        )}
        {heading}
      </h3>
      <p className={cn('mt-1 break-words text-sm', !side && 'text-muted-foreground italic')}>
        {side ? side.summary : emptyLabel}
      </p>
      {side && (
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background/80 p-3 font-mono text-xs leading-relaxed ring-1 ring-inset ring-border/60">
          {side.configuration}
        </pre>
      )}
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
  const style = CHANGE_STYLES[step.change];
  const changed = step.change === 'CHANGED';
  return (
    <article
      className={cn(
        'space-y-3.5 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-5 shadow-xs transition-all hover:shadow-md',
        style.card
      )}
      data-change={step.change}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn('font-mono text-[10px]', style.badge)}>
          {step.change}
        </Badge>
        <h2 className="break-all font-mono !text-sm !leading-snug font-semibold">{step.key}</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <DiffPane
          heading={`Before · v${baseVersion}`}
          side={step.before}
          emptyLabel="Not in this version"
          tone={changed || step.change === 'REMOVED' ? 'before' : undefined}
        />
        <DiffPane
          heading={`After · v${nextVersion}`}
          side={step.after}
          emptyLabel="Removed"
          tone={changed || step.change === 'ADDED' ? 'after' : undefined}
        />
      </div>
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
  const changed = steps.filter(step => step.change !== 'UNCHANGED');
  const unchanged = steps.filter(step => step.change === 'UNCHANGED');
  const counts = (['ADDED', 'REMOVED', 'CHANGED'] as const).map(change => ({
    change,
    count: changed.filter(step => step.change === change).length,
  }));
  return (
    <section aria-label="Workflow changes" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {counts.map(({ change, count }) => (
          <span
            key={change}
            className={cn(
              'rounded-full border px-2.5 py-0.5 font-medium tabular-nums',
              count > 0 ? CHANGE_STYLES[change].badge : 'text-muted-foreground'
            )}
          >
            {count} {CHANGE_STYLES[change].label.toLowerCase()}
          </span>
        ))}
        <span className="rounded-full border px-2.5 py-0.5 tabular-nums text-muted-foreground">
          {unchanged.length} unchanged
        </span>
      </div>
      {changed.length === 0 && (
        <p className="rounded-xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          No step differences between v{baseVersion} and v{nextVersion}.
        </p>
      )}
      {changed.map(step => (
        <StepDiffCard
          key={step.key}
          step={step}
          baseVersion={baseVersion}
          nextVersion={nextVersion}
        />
      ))}
      {unchanged.length > 0 && (
        <details className="group rounded-xl border bg-card shadow-xs">
          <summary className="cursor-pointer select-none rounded-xl px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Show {unchanged.length} unchanged {unchanged.length === 1 ? 'step' : 'steps'}
          </summary>
          <div className="space-y-3 border-t p-4">
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
      <p className="text-xs text-muted-foreground">
        Changes include configuration, prechecks, verification and approval settings; credential
        fields are masked. This comparison performs no operation.
      </p>
    </section>
  );
}
