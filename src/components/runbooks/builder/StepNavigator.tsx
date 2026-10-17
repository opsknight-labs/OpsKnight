'use client';
/* eslint-disable security/detect-object-injection -- step types and risk levels are closed union keys */

import { useRef, useState, type KeyboardEvent } from 'react';
import { stepRequiresApproval } from '@/lib/runbooks/safety';
import { AlertCircle, ArrowDown, ArrowUp, Copy, GripVertical, Lock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import type { RunbookStepDefinition, RunbookStepType } from '@/lib/runbooks/types';
import AddStepMenu from './AddStepMenu';
import { RISK_META, STEP_CATALOG } from './step-catalog';

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
  const [announcement, setAnnouncement] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const label = (step: RunbookStepDefinition | undefined) => step?.name || 'Untitled step';

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= steps.length || offset === 0) return;
    onMoveStep(index, offset);
    setAnnouncement(
      `Moved ${label(steps.at(index))} to position ${target + 1} of ${steps.length}.`
    );
  };

  const focusStep = (index: number) =>
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('button[data-step-select]')
      .item(index)
      ?.focus();

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const offset = event.key === 'ArrowUp' ? -1 : 1;
    if (event.altKey && !readOnly) move(index, offset);
    else focusStep(Math.min(steps.length - 1, Math.max(0, index + offset)));
  };

  return (
    <nav
      aria-label="Runbook steps navigation"
      className="flex flex-col overflow-hidden rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div>
          <h3 className="!text-sm !leading-snug font-semibold text-foreground">Steps</h3>
          <p className="text-xs text-muted-foreground">
            <span className="tabular-nums">{steps.length}</span>{' '}
            {steps.length === 1 ? 'step runs' : 'steps run'} top to bottom
          </p>
        </div>
        {!readOnly && steps.length > 1 && (
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground xl:inline">
            Alt + ↑↓ to reorder
          </kbd>
        )}
      </div>

      <ol
        ref={listRef}
        aria-label="Runbook steps"
        className="max-h-56 flex-1 list-none space-y-1 overflow-y-auto p-2 sm:max-h-72 lg:max-h-[calc(100vh-18rem)]"
      >
        {steps.map((step, index) => {
          const isSelected = index === selectedIndex;
          const errors = stepErrors.get(index);
          const errorTotal = errors ? Object.keys(errors).length : 0;
          const isApprovalRequired = stepRequiresApproval(step);
          const catalog = STEP_CATALOG[step.type];
          const TypeIcon = catalog.icon;
          const risk = RISK_META[step.riskClass];
          const beforeCount = step.precheck?.steps.length ?? 0;
          const afterCount = step.verification?.steps.length ?? 0;
          const isDropTarget = dragIndex !== null && dropIndex === index && dragIndex !== index;

          return (
            <li
              key={stepIdentities.at(index) ?? step.key}
              className="list-none"
              onDragOver={event => {
                if (dragIndex === null) return;
                event.preventDefault();
                setDropIndex(index);
              }}
              onDrop={event => {
                event.preventDefault();
                if (dragIndex !== null) move(dragIndex, index - dragIndex);
                setDragIndex(null);
                setDropIndex(null);
              }}
            >
              <div
                className={cn(
                  'group relative flex items-stretch gap-1 rounded-xl border transition-all',
                  isSelected
                    ? 'border-primary/50 bg-primary/10 shadow-xs'
                    : 'border-transparent hover:border-border/80 hover:bg-muted/40',
                  isDropTarget && 'border-dashed border-primary',
                  dragIndex === index && 'opacity-50'
                )}
              >
                {!readOnly && (
                  <span
                    draggable
                    onDragStart={event => {
                      event.dataTransfer.effectAllowed = 'move';
                      setDragIndex(index);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                    title="Drag to reorder"
                    aria-hidden="true"
                    className="hidden cursor-grab items-center pl-1 text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing sm:flex"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                )}
                <button
                  type="button"
                  data-step-select
                  aria-current={isSelected ? 'step' : undefined}
                  aria-label={`Step ${index + 1}: ${label(step)}`}
                  aria-keyshortcuts={readOnly ? undefined : 'Alt+ArrowUp Alt+ArrowDown'}
                  onClick={() => onSelectStep(index)}
                  onKeyDown={event => handleKeyDown(event, index)}
                  className="flex min-w-0 flex-1 items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : errorTotal > 0
                          ? 'bg-destructive/15 text-destructive'
                          : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-sm font-medium text-foreground">
                      {step.name || (
                        <em className="font-normal text-muted-foreground">Untitled step</em>
                      )}
                    </h4>
                    {getStepSummary(step) && (
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/90">
                        {getStepSummary(step)}
                      </p>
                    )}
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <TypeIcon className="h-3 w-3" aria-hidden="true" />
                        {catalog.label}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={cn('h-1.5 w-1.5 rounded-full', risk.dot)}
                          aria-hidden="true"
                        />
                        {risk.label}
                      </span>
                      {isApprovalRequired && (
                        <span
                          className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400"
                          title="Needs human approval before it runs"
                        >
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          Approval
                        </span>
                      )}
                    </span>
                    {(beforeCount > 0 || afterCount > 0) && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Before: {beforeCount} · After: {afterCount}
                      </span>
                    )}
                  </div>
                  {errorTotal > 0 && (
                    <span
                      className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-destructive"
                      title={`${errorTotal} validation ${errorTotal === 1 ? 'issue' : 'issues'}`}
                    >
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="tabular-nums">{errorTotal}</span>
                      <span className="sr-only">
                        {' '}
                        validation {errorTotal === 1 ? 'issue' : 'issues'}
                      </span>
                    </span>
                  )}
                </button>

                {!readOnly && (
                  <div
                    className={cn(
                      'flex shrink-0 items-center gap-0.5 pr-1 transition-opacity',
                      !isSelected &&
                        'lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100'
                    )}
                  >
                    <div className="flex flex-col">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 max-sm:h-11 max-sm:w-11"
                        title={`Move ${step.name} up`}
                        aria-label={`Move ${step.name} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 max-sm:h-11 max-sm:w-11"
                        title={`Move ${step.name} down`}
                        aria-label={`Move ${step.name} down`}
                        disabled={index === steps.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="flex flex-col">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 max-sm:h-11 max-sm:w-11"
                        title={`Duplicate ${step.name}`}
                        aria-label={`Duplicate ${step.name}`}
                        onClick={() => {
                          onDuplicateStep(index);
                          setAnnouncement(`Duplicated ${label(step)}.`);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive max-sm:h-11 max-sm:w-11"
                        title={`Remove ${step.name}`}
                        aria-label={`Remove ${step.name}`}
                        disabled={steps.length === 1}
                        onClick={() => {
                          onRemoveStep(index);
                          setAnnouncement(`Removed ${label(step)}. Discard changes to undo.`);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {!readOnly && (
        <div className="border-t p-2.5">
          <AddStepMenu
            onAddStep={type => {
              onAddStep(type);
              setAnnouncement(
                `Added ${STEP_CATALOG[type].label} step at position ${steps.length + 1}.`
              );
            }}
          />
        </div>
      )}
    </nav>
  );
}

export function getStepSummary(step: RunbookStepDefinition): string {
  const config = (step.config || {}) as Record<string, unknown>;
  switch (step.type) {
    case 'KUBERNETES': {
      const act = String(config.action ?? 'get');
      const res = String(config.resource ?? 'deployment');
      const name = config.name ? `/${String(config.name)}` : '';
      const ns = config.namespace ? ` (${String(config.namespace)})` : '';
      return `${act} ${res}${name}${ns}`.trim();
    }
    case 'DOCKER': {
      const act = String(config.action ?? 'start');
      const container = config.container ? ` container ${String(config.container)}` : '';
      return `${act}${container}`.trim();
    }
    case 'SYSTEMD': {
      const act = String(config.action ?? 'status');
      const unit = config.unit ? ` ${String(config.unit)}` : '';
      return `${act}${unit}`.trim();
    }
    case 'HTTP': {
      const method = String(config.method ?? 'GET');
      const url = config.url ? ` ${String(config.url)}` : '';
      return `${method}${url}`.trim();
    }
    case 'BASH': {
      const cmd = String(config.command ?? '');
      return cmd ? `$ ${cmd.slice(0, 35)}${cmd.length > 35 ? '…' : ''}` : 'Shell script';
    }
    case 'LINUX_DIAGNOSTICS': {
      return String(config.command ?? 'Diagnostics check');
    }
    case 'WAIT': {
      return `Wait ${String(config.durationSeconds ?? 10)}s`;
    }
    case 'CONDITION': {
      return `If ${String(config.condition ?? 'condition')}`;
    }
    case 'MANUAL': {
      return 'Manual responder instructions';
    }
    case 'APPROVAL': {
      return 'Approval gate';
    }
    default:
      return '';
  }
}
