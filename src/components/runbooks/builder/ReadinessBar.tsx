'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import type { RunbookDefinition } from '@/lib/runbooks/types';
import { flattenSteps } from '@/lib/runbooks/definition';
import { stepRequiresApproval } from '@/lib/runbooks/safety';

interface ReadinessBarProps {
  definition: RunbookDefinition;
  errorCount: number;
  dirty: boolean;
  unappliedJson: boolean;
  _readOnly?: boolean;
  draftRevision?: number;
  stepErrors?: Map<number, Record<string, string>>;
  inputErrors?: Map<number, Record<string, string>>;
  generalInputErrors?: string[];
  onNavigateToStep?: (stepIndex: number) => void;
  onNavigateToInputs?: () => void;
}

export default function ReadinessBar({
  definition,
  errorCount,
  dirty,
  unappliedJson,
  _readOnly = false,
  draftRevision = 0,
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

  return (
    <aside
      aria-label="Runbook publish readiness summary"
      className="sticky bottom-0 z-20 flex flex-col rounded-xl border bg-card/95 p-2.5 sm:p-3.5 backdrop-blur-md shadow-lg transition-all"
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {errorCount === 0 ? (
            <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400 truncate">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Draft configuration checks passed</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 font-medium text-destructive hover:underline cursor-pointer truncate"
              title="Toggle error details"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {errorCount} validation {errorCount === 1 ? 'issue' : 'issues'}
              </span>
            </button>
          )}

          {/* Inline breakdown badges for desktop */}
          <div className="hidden sm:flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {totalSteps} {totalSteps === 1 ? 'step' : 'steps'}
            </Badge>

            <Badge variant={mutationSteps > 0 ? 'warning' : 'secondary'} className="text-xs">
              {mutationSteps} {mutationSteps === 1 ? 'mutation' : 'mutations'}
            </Badge>

            <Badge
              variant={approvalGates > 0 ? 'warning' : 'secondary'}
              className="text-xs flex items-center gap-1"
            >
              {approvalGates > 0 ? (
                <ShieldAlert className="h-3 w-3" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              {approvalGates} {approvalGates === 1 ? 'gate' : 'gates'}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground flex items-center gap-1"
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide summary details' : 'Show summary details'}
          >
            <span>{expanded ? 'Hide details' : 'Details'}</span>
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>

          <span aria-live="polite" className="text-xs font-medium">
            {unappliedJson ? (
              <span className="text-warning font-semibold">Unapplied JSON</span>
            ) : dirty ? (
              <span className="text-amber-500 font-medium">Unsaved (rev {draftRevision})</span>
            ) : (
              <span className="text-muted-foreground">Draft saved (rev {draftRevision})</span>
            )}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-3 text-xs">
          {/* Mobile badges breakdown */}
          <div className="flex sm:hidden flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {totalSteps} {totalSteps === 1 ? 'step' : 'steps'}
            </Badge>

            <Badge variant={mutationSteps > 0 ? 'warning' : 'secondary'} className="text-xs">
              {mutationSteps} {mutationSteps === 1 ? 'mutation' : 'mutations'}
            </Badge>

            <Badge
              variant={approvalGates > 0 ? 'warning' : 'secondary'}
              className="text-xs flex items-center gap-1"
            >
              {approvalGates > 0 ? (
                <ShieldAlert className="h-3 w-3" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              {approvalGates} {approvalGates === 1 ? 'gate' : 'gates'}
            </Badge>
          </div>

          {/* Actionable error details */}
          {errorCount > 0 ? (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              <p className="font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">
                Actionable Issues (click to resolve):
              </p>

              {/* General input errors */}
              {generalInputErrors &&
                generalInputErrors.map((msg, i) => (
                  <button
                    key={`gen-input-${i}`}
                    type="button"
                    onClick={onNavigateToInputs}
                    className="flex items-start gap-1.5 w-full text-left text-destructive hover:underline p-1 rounded hover:bg-destructive/10 transition-colors"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>Inputs: {msg}</span>
                  </button>
                ))}

              {/* Indexed input errors */}
              {inputErrors &&
                Array.from(inputErrors.entries()).map(([inputIdx, errs]) =>
                  Object.entries(errs).map(([field, msg]) => (
                    <button
                      key={`input-${inputIdx}-${field}`}
                      type="button"
                      onClick={onNavigateToInputs}
                      className="flex items-start gap-1.5 w-full text-left text-destructive hover:underline p-1 rounded hover:bg-destructive/10 transition-colors"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        Parameter #{inputIdx + 1} ({field}): {msg}
                      </span>
                    </button>
                  ))
                )}

              {/* Step errors */}
              {stepErrors &&
                Array.from(stepErrors.entries()).map(([stepIdx, errs]) => {
                  const step = definition.steps.at(stepIdx);
                  const stepLabel = step?.name ? `"${step.name}"` : `Step ${stepIdx + 1}`;
                  return Object.entries(errs).map(([field, msg]) => (
                    <button
                      key={`step-${stepIdx}-${field}`}
                      type="button"
                      onClick={() => onNavigateToStep?.(stepIdx)}
                      className="flex items-start gap-1.5 w-full text-left text-destructive hover:underline p-1 rounded hover:bg-destructive/10 transition-colors"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        {stepLabel} ({field}): {msg}
                      </span>
                    </button>
                  ));
                })}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              All workflow safety and schema constraints are satisfied. Ready to save or publish.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
