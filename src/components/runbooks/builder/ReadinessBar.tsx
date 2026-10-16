'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ListOrdered,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import type { RunbookDefinition } from '@/lib/runbooks/types';
import { flattenSteps } from '@/lib/runbooks/shared-definition';
import { stepRequiresApproval } from '@/lib/runbooks/safety';
import { Pill } from '../ui/primitives';

interface ReadinessBarProps {
  definition: RunbookDefinition;
  errorCount: number;
  stepErrors?: Map<number, Record<string, string>>;
  inputErrors?: Map<number, Record<string, string>>;
  generalInputErrors?: string[];
  onNavigateToStep?: (stepIndex: number) => void;
  onNavigateToInputs?: () => void;
}

export default function ReadinessBar({
  definition,
  errorCount,
  stepErrors,
  inputErrors,
  generalInputErrors,
  onNavigateToStep,
  onNavigateToInputs,
}: ReadinessBarProps) {
  const [expanded, setExpanded] = useState(false);
  const executableSteps = flattenSteps(definition);
  const totalSteps = executableSteps.length;
  const approvalGates = executableSteps.filter(stepRequiresApproval).length;
  const mutationSteps = executableSteps.filter(s => s.riskClass !== 'READ_ONLY').length;
  const issueClass =
    'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <aside
      aria-label="Runbook publish readiness summary"
      className={cn(
        'rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs px-5 py-3.5 shadow-xs',
        errorCount > 0 && 'border-destructive/30'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          {errorCount === 0 ? (
            <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Draft configuration checks passed</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              className="flex items-center gap-1.5 rounded-sm font-medium text-destructive underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Toggle error details"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="tabular-nums">
                {errorCount} validation {errorCount === 1 ? 'issue' : 'issues'} to fix
              </span>
            </button>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <Pill icon={ListOrdered} className="tabular-nums">
              {totalSteps} {totalSteps === 1 ? 'step' : 'steps'}
            </Pill>
            <Pill tone={mutationSteps > 0 ? 'warning' : 'neutral'} className="tabular-nums">
              {mutationSteps} {mutationSteps === 1 ? 'mutation' : 'mutations'}
            </Pill>
            <Pill
              tone={approvalGates > 0 ? 'warning' : 'neutral'}
              icon={approvalGates > 0 ? ShieldAlert : ShieldCheck}
              className="tabular-nums"
            >
              {approvalGates} approval {approvalGates === 1 ? 'gate' : 'gates'}
            </Pill>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide summary details' : 'Show summary details'}
        >
          <span>{expanded ? 'Hide details' : 'Details'}</span>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 border-t pt-3 text-xs">
          {errorCount > 0 ? (
            <div className="space-y-1">
              <p className="px-2 pb-1 font-medium text-muted-foreground">
                Actionable issues · select one to jump to it
              </p>
              <ul className="max-h-56 space-y-0.5 overflow-y-auto">
                {generalInputErrors?.map((msg, i) => (
                  <li key={`gen-input-${i}`}>
                    <button type="button" onClick={onNavigateToInputs} className={issueClass}>
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="flex-1">Inputs: {msg}</span>
                      <ArrowRight
                        className="mt-0.5 h-3 w-3 shrink-0 opacity-60"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
                {inputErrors &&
                  Array.from(inputErrors.entries()).flatMap(([inputIdx, errs]) =>
                    Object.entries(errs).map(([field, msg]) => (
                      <li key={`input-${inputIdx}-${field}`}>
                        <button type="button" onClick={onNavigateToInputs} className={issueClass}>
                          <AlertTriangle
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="flex-1">
                            Parameter #{inputIdx + 1} ({field}): {msg}
                          </span>
                          <ArrowRight
                            className="mt-0.5 h-3 w-3 shrink-0 opacity-60"
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    ))
                  )}
                {stepErrors &&
                  Array.from(stepErrors.entries()).flatMap(([stepIdx, errs]) => {
                    const step = definition.steps.at(stepIdx);
                    const stepLabel = step?.name ? `"${step.name}"` : `Step ${stepIdx + 1}`;
                    return Object.entries(errs).map(([field, msg]) => (
                      <li key={`step-${stepIdx}-${field}`}>
                        <button
                          type="button"
                          onClick={() => onNavigateToStep?.(stepIdx)}
                          className={issueClass}
                        >
                          <AlertTriangle
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="flex-1">
                            {stepLabel} ({field}): {msg}
                          </span>
                          <ArrowRight
                            className="mt-0.5 h-3 w-3 shrink-0 opacity-60"
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    ));
                  })}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">
              All safety and schema checks pass. Save the draft, then publish when you’re ready.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
