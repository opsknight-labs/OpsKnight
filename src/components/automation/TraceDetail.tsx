'use client';
import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

const formatState = (state: unknown) => {
  if (!state || typeof state !== 'object') return 'Missing';
  const value = state as { state?: string; value?: unknown; raw?: unknown };
  return value.state === 'RECOGNIZED'
    ? String(value.value)
    : value.state === 'UNMAPPED'
      ? `${String(value.raw)} (unmapped)`
      : 'Missing';
};

const RESULT_LABELS = new Map<string, { label: string; tone: string }>([
  [
    'TRUE',
    {
      label: 'Matched',
      tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
    },
  ],
  ['FALSE', { label: 'Did not match', tone: 'border-border bg-muted text-muted-foreground' }],
  [
    'UNKNOWN',
    {
      label: 'Unknown (missing or unmapped value)',
      tone: 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
    },
  ],
]);

function ResultChip({ result }: { result: string }) {
  const known = RESULT_LABELS.get(result);
  return (
    <span
      className={cn(
        'shrink-0 rounded-md border px-1.5 py-px text-[11px] font-medium',
        known?.tone ?? 'border-border text-muted-foreground'
      )}
    >
      {known?.label ?? result}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

function StepList({
  steps,
  emptyText,
  firstMatchWins = false,
}: {
  steps?: Array<{ ruleName: string; result: string }>;
  emptyText: string;
  firstMatchWins?: boolean;
}) {
  if (!steps?.length) return <p className="text-muted-foreground">{emptyText}</p>;
  const selected = firstMatchWins ? steps.findIndex(step => step.result === 'TRUE') : -1;
  return (
    <ol className="space-y-1">
      {steps.map((step, index) => (
        <li
          key={index}
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5',
            index === selected ? 'border-primary/40 bg-primary/5' : 'border-border/70'
          )}
        >
          <span className="min-w-0 break-words">
            <span className="mr-1.5 tabular-nums text-muted-foreground">{index + 1}.</span>
            {step.ruleName}
            {index === selected && (
              <span className="ml-1.5 text-xs text-muted-foreground">· selected (first match)</span>
            )}
          </span>
          <ResultChip result={step.result} />
        </li>
      ))}
    </ol>
  );
}

export function TraceDetail({ detail }: { detail: unknown }) {
  const trace = (detail ?? {}) as {
    redacted?: boolean;
    shadowDifferent?: boolean;
    diagnosticLevel?: string;
    policyName?: string | null;
    destinationNames?: Array<{ provider: string; destinationId: string; label: string }>;
    result?: {
      matchedRule?: { name: string };
      tags?: string[];
      inputContext?: Record<string, unknown>;
      enrichedContext?: Record<string, unknown>;
      writes?: Array<{ ruleId: string; fieldKey: string; value: unknown }>;
      enrichmentRuleResults?: Array<{ ruleName: string; result: string }>;
      routingRuleResults?: Array<{ ruleName: string; result: string }>;
      outcome?: { type: string; policyId?: string };
      supplementalActions?: Array<{ provider: string; destinationId: string }>;
    };
    actual?: { priority?: string; route?: string };
    fallbackReason?: string;
    normalization?: Array<{ fieldKey: string; raw: unknown; canonical: unknown }>;
  };
  if (trace.redacted)
    return (
      <div className="mt-3 space-y-2 text-sm">
        <p className="flex items-start gap-2 rounded-md border border-dashed border-border px-3 py-2 text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Evaluation details are restricted. Sensitive incident access is required to view context
          values and rule steps.
        </p>
        {trace.shadowDifferent && (
          <p className="text-muted-foreground">Shadow evaluation differed from current behavior.</p>
        )}
      </div>
    );
  const result = trace.result;
  const inputContext = Object.entries(result?.inputContext ?? {});
  return (
    <div className="mt-3 space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-border/70 px-3 py-2">
          <h4 className="text-xs font-medium text-muted-foreground">Current behavior</h4>
          <p className="font-medium">
            Priority {trace.actual?.priority ?? 'Unset'} ·{' '}
            {trace.actual?.route === 'SERVICE_DEFAULT'
              ? 'Service default'
              : (trace.actual?.route ?? 'Service default')}
          </p>
        </div>
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <h4 className="text-xs font-medium text-muted-foreground">Automation outcome</h4>
          <p className="font-medium">
            {trace.fallbackReason ??
              (result?.outcome?.type === 'NO_ESCALATION'
                ? 'No responder paging'
                : result?.outcome?.type === 'ESCALATION_POLICY'
                  ? (trace.policyName ?? 'Selected escalation policy')
                  : 'Service default')}
          </p>
          <p className="text-muted-foreground">
            Final priority: {formatState(result?.enrichedContext?.priority)}
          </p>
        </div>
      </div>
      {trace.fallbackReason && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Evaluation fell back to the service default: {trace.fallbackReason}
        </p>
      )}
      {result?.matchedRule ? (
        <p>
          Selected by: <strong>{result.matchedRule.name}</strong>
        </p>
      ) : (
        result &&
        !trace.fallbackReason && (
          <p className="text-muted-foreground">
            No routing rule matched, so the service default applies.
          </p>
        )
      )}
      {!!result?.tags?.length && <p>Tags: {result.tags.join(', ')}</p>}
      {trace.diagnosticLevel === 'COMPACT' && (
        <p className="text-muted-foreground">
          Compact success record. Detailed diagnostics are retained for differences, fallbacks, and
          sampled evaluations; Test can explain the full policy.
        </p>
      )}
      <Section title="Why · normalization and matched rules">
        {!trace.normalization?.length && !inputContext.length && (
          <p className="text-muted-foreground">No context values were recorded.</p>
        )}
        {(!!trace.normalization?.length || !!inputContext.length) && (
          <dl className="divide-y divide-border/70 rounded-md border border-border/70">
            {trace.normalization?.map(n => (
              <div key={`n-${n.fieldKey}`} className="flex flex-wrap gap-x-2 px-2.5 py-1.5">
                <dt className="font-mono text-xs leading-5">{n.fieldKey}</dt>
                <dd className="min-w-0 break-words">
                  {String(n.raw ?? 'Missing')} → {formatState(n.canonical)}
                </dd>
              </div>
            ))}
            {inputContext.map(([key, value]) => (
              <div key={`c-${key}`} className="flex flex-wrap gap-x-2 px-2.5 py-1.5">
                <dt className="font-mono text-xs leading-5">{key}</dt>
                <dd className="min-w-0 break-words">{formatState(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>
      <Section title="Enrichment">
        <StepList
          steps={result?.enrichmentRuleResults}
          emptyText="No enabled enrichment rules were evaluated."
        />
        {!!result?.writes?.length && (
          <ul className="space-y-0.5 pl-1">
            {result.writes.map((w, i) => (
              <li key={i} className="break-words">
                <span className="font-mono text-xs">{w.fieldKey}</span> → {String(w.value)}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Routing">
        <StepList
          steps={result?.routingRuleResults}
          emptyText="No enabled routing rules were evaluated."
          firstMatchWins
        />
        {result?.supplementalActions?.map((a, i) => (
          <p key={i}>
            Also notify {a.provider} ·{' '}
            {trace.destinationNames?.find(
              d => d.destinationId === a.destinationId && d.provider === a.provider
            )?.label ?? 'Configured destination'}
          </p>
        ))}
      </Section>
      <details className="group">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronDown
            className="h-4 w-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
          Advanced diagnostics
        </summary>
        <pre className="max-h-96 max-w-full overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(detail, null, 2)}
        </pre>
      </details>
    </div>
  );
}
