'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Trash2,
  AlertCircle,
  ShieldAlert,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { FormSelect } from '../RunbookControls';
import {
  RUNBOOK_STEP_TYPES,
  type RunbookStepDefinition,
  type RunbookStepType,
} from '@/lib/runbooks/types';

interface StepNavigatorProps {
  steps: RunbookStepDefinition[];
  stepIdentities: string[];
  selectedIndex: number;
  stepErrors: Map<number, Record<string, string>>;
  readOnly?: boolean;
  onSelectStep: (index: number) => void;
  onMoveStep: (index: number, offset: number) => void;
  onDuplicateStep: (index: number) => void;
  onRemoveStep: (index: number) => void;
  onAddStep: (type: RunbookStepType) => void;
}

export default function StepNavigator({
  steps,
  stepIdentities,
  selectedIndex,
  stepErrors,
  readOnly = false,
  onSelectStep,
  onMoveStep,
  onDuplicateStep,
  onRemoveStep,
  onAddStep,
}: StepNavigatorProps) {
  const [newStepType, setNewStepType] = useState<RunbookStepType>('SYSTEMD');
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const selectedStep = steps.at(selectedIndex);

  return (
    <nav
      aria-label="Runbook steps navigation"
      className="flex flex-col h-full rounded-xl border bg-card/60 shadow-2xs overflow-hidden"
    >
      <div className="flex items-center justify-between border-b px-3 sm:px-4 py-2.5 sm:py-3 bg-muted/20">
        <div>
          <h3 className="font-semibold text-xs tracking-wider uppercase text-muted-foreground">
            Workflow Steps
          </h3>
          <span className="text-xs text-muted-foreground font-medium">
            {steps.length} {steps.length === 1 ? 'step' : 'steps'} configured
          </span>
        </div>

        {/* Mobile toggle button */}
        <div className="lg:hidden">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMobileExpanded(!mobileExpanded)}
            className="h-7 text-xs font-medium px-2 flex items-center gap-1"
            aria-expanded={mobileExpanded}
            aria-label={mobileExpanded ? 'Hide step list' : 'View all steps'}
          >
            <span>{mobileExpanded ? 'Hide steps' : 'Change step'}</span>
            {mobileExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* When collapsed on mobile, show compact current-step card */}
      {!mobileExpanded && selectedStep && (
        <div className="lg:hidden p-2.5 bg-card/60 border-b flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold bg-primary text-primary-foreground">
              {selectedIndex + 1}
            </span>
            <span className="text-xs font-semibold truncate text-foreground">
              {selectedStep.name || 'Untitled step'}
            </span>
            <Badge variant="outline" className="text-[10px] py-0 px-1 font-mono uppercase">
              {selectedStep.type.replaceAll('_', ' ')}
            </Badge>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 text-[11px] px-2 shrink-0"
            onClick={() => setMobileExpanded(true)}
          >
            Change
          </Button>
        </div>
      )}

      <div className={mobileExpanded ? 'flex flex-col flex-1' : 'hidden lg:flex lg:flex-col lg:flex-1'}>
        <ol
          aria-label="Runbook steps"
          className="flex-1 overflow-y-auto p-2 space-y-1.5 list-none max-h-56 sm:max-h-80 lg:max-h-[calc(100vh-16rem)]"
          tabIndex={0}
        >
          {steps.map((step, index) => {
            const isSelected = index === selectedIndex;
            const errors = stepErrors.get(index);
            const hasErrors = errors && Object.keys(errors).length > 0;
            const isApprovalRequired =
              step.riskClass === 'NON_IDEMPOTENT' || step.requiresApproval || step.type === 'APPROVAL';
            const hasNestedChecks = Boolean(
              (step.precheck?.steps && step.precheck.steps.length > 0) ||
                (step.verification?.steps && step.verification.steps.length > 0)
            );

            return (
              <li key={stepIdentities.at(index) ?? step.key} className="list-none">
                <div
                  className={`group relative flex flex-col rounded-lg border p-2.5 transition-all text-left ${
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-2xs ring-1 ring-primary/20'
                      : 'border-border/60 hover:border-border hover:bg-muted/40'
                  }`}
                >
                  {/* Semantic selection button */}
                  <button
                    type="button"
                    aria-current={isSelected ? 'step' : undefined}
                    aria-label={`Step ${index + 1}: ${step.name || 'Untitled step'}`}
                    onClick={() => {
                      onSelectStep(index);
                      setMobileExpanded(false);
                    }}
                    className="flex flex-col text-left w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded p-0.5 cursor-pointer"
                  >
                  <div className="flex items-start justify-between gap-2 w-full">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : hasErrors
                              ? 'bg-destructive/20 text-destructive font-bold'
                              : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {index + 1}
                      </span>
                      <h4 className="truncate text-xs font-semibold text-foreground">
                        {step.name || <em className="text-muted-foreground font-normal">Untitled step</em>}
                      </h4>
                    </div>

                    {hasErrors ? (
                      <span title={`${Object.keys(errors).length} validation issues`} className="text-destructive shrink-0">
                        <AlertCircle className="h-4 w-4" />
                      </span>
                    ) : isSelected ? (
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0 opacity-80" />
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 uppercase font-mono">
                      {step.type.replaceAll('_', ' ')}
                    </Badge>

                    {step.riskClass === 'NON_IDEMPOTENT' ? (
                      <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                        MUTATION
                      </Badge>
                    ) : step.riskClass === 'IDEMPOTENT_WRITE' ? (
                      <Badge variant="warning" className="text-[10px] py-0 px-1.5">
                        WRITE
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                        READ
                      </Badge>
                    )}

                    {isApprovalRequired && (
                      <span
                        title="Human approval required before execution"
                        className="flex items-center gap-0.5 rounded px-1 text-[10px] font-medium bg-warning/20 text-warning-foreground"
                      >
                        <ShieldAlert className="h-3 w-3 text-warning" />
                        GATE
                      </span>
                    )}

                    {hasNestedChecks && (
                      <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        VERIFIED
                      </span>
                    )}
                  </div>

                  {(step.precheck?.steps?.length || step.verification?.steps?.length) && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground truncate w-full">
                      {step.precheck?.steps?.length ? `Before: ${step.precheck.steps.map(c => c.name).join(' → ')}` : ''}
                      {step.precheck?.steps?.length && step.verification?.steps?.length ? ' · ' : ''}
                      {step.verification?.steps?.length ? `After: ${step.verification.steps.map(c => c.name).join(' → ')}` : ''}
                    </p>
                  )}
                </button>

                {/* Separate Actions Toolbar */}
                {!readOnly && (
                  <div className="mt-2 flex items-center justify-end gap-1 border-t border-border/40 pt-1.5">
                    <div className="flex items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={`Move ${step.name} up`}
                        aria-label={`Move ${step.name} up`}
                        disabled={index === 0}
                        onClick={() => onMoveStep(index, -1)}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={`Move ${step.name} down`}
                        aria-label={`Move ${step.name} down`}
                        disabled={index === steps.length - 1}
                        onClick={() => onMoveStep(index, 1)}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={`Duplicate ${step.name}`}
                        aria-label={`Duplicate ${step.name}`}
                        onClick={() => onDuplicateStep(index)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        title={`Remove ${step.name}`}
                        aria-label={`Remove ${step.name}`}
                        disabled={steps.length === 1}
                        onClick={() => onRemoveStep(index)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {!readOnly && (
        <div className="border-t bg-muted/20 p-2.5 space-y-2">
          <FormSelect
            name="nav-add-step-type"
            label="Step type"
            value={newStepType}
            onValueChange={(v: string) => setNewStepType(v as RunbookStepType)}
            options={RUNBOOK_STEP_TYPES.map(type => ({
              value: type,
              label: type.replaceAll('_', ' '),
            }))}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full text-xs font-semibold"
            onClick={() => {
              onAddStep(newStepType);
              setMobileExpanded(false);
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Step
          </Button>
        </div>
      )}
      </div>
    </nav>
  );
}
