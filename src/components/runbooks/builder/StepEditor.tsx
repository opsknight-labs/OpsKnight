'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Badge } from '@/components/ui/shadcn/badge';
import { FormSelect } from '../RunbookControls';
import {
  RUNBOOK_STEP_TYPES,
  type RunbookRiskClass,
  type RunbookStepDefinition,
  type RunbookStepType,
} from '@/lib/runbooks/types';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';
import { newBuilderStep, builderRisk } from '@/lib/runbooks/builder';

import HttpActionEditor from './action-editors/HttpActionEditor';
import KubernetesActionEditor from './action-editors/KubernetesActionEditor';
import DockerActionEditor from './action-editors/DockerActionEditor';
import SystemdActionEditor from './action-editors/SystemdActionEditor';
import LinuxDiagnosticsEditor from './action-editors/LinuxDiagnosticsEditor';
import BashActionEditor from './action-editors/BashActionEditor';
import ConditionActionEditor from './action-editors/ConditionActionEditor';
import WaitActionEditor from './action-editors/WaitActionEditor';
import ManualActionEditor from './action-editors/ManualActionEditor';

interface StepEditorProps {
  step: RunbookStepDefinition;
  inputs: RunbookInputInput[];
  editorId: string;
  depth?: number;
  errors?: Record<string, string>;
  readOnly?: boolean;
  onChange: (patch: Partial<RunbookStepDefinition>) => void;
}

const RISK_RANKS: Record<RunbookRiskClass, number> = {
  READ_ONLY: 0,
  IDEMPOTENT_WRITE: 1,
  NON_IDEMPOTENT: 2,
};

export default function StepEditor({
  step,
  inputs,
  editorId,
  depth = 1,
  errors = {},
  readOnly = false,
  onChange,
}: StepEditorProps) {
  const minRisk = builderRisk(step);
  const isMandatoryApproval = step.riskClass === 'NON_IDEMPOTENT' || step.type === 'APPROVAL';

  const handleTypeChange = (nextType: RunbookStepType) => {
    const template = newBuilderStep(nextType, step.key);
    const newMinRisk = builderRisk(template);
    onChange({
      type: nextType,
      config: template.config,
      riskClass: newMinRisk,
      requiresApproval: newMinRisk === 'NON_IDEMPOTENT',
    });
  };

  const handleConfigChange = (nextConfig: Record<string, unknown>) => {
    const updatedStep = { ...step, config: nextConfig };
    const requiredMinRisk = builderRisk(updatedStep);
    let nextRisk = step.riskClass;
    let nextApproval = step.requiresApproval;

    if (step.riskClass === minRisk || minRisk === 'NON_IDEMPOTENT') {
      nextRisk = requiredMinRisk;
      if (minRisk === 'NON_IDEMPOTENT' && requiredMinRisk !== 'NON_IDEMPOTENT') {
        nextApproval = false;
      }
    } else if (RISK_RANKS[nextRisk] < RISK_RANKS[requiredMinRisk]) {
      nextRisk = requiredMinRisk;
    }

    if (nextRisk === 'NON_IDEMPOTENT') {
      nextApproval = true;
    }

    onChange({
      config: nextConfig,
      riskClass: nextRisk,
      requiresApproval: nextApproval,
    });
  };

  const handleRiskClassChange = (selectedRisk: RunbookRiskClass) => {
    if (RISK_RANKS[selectedRisk] < RISK_RANKS[minRisk]) return;
    onChange({
      riskClass: selectedRisk,
      requiresApproval: selectedRisk === 'NON_IDEMPOTENT' ? true : step.requiresApproval,
    });
  };

  const handleTimeoutChange = (valStr: string) => {
    const trimmed = valStr.trim();
    if (trimmed === '') {
      onChange({ timeoutSeconds: undefined });
    } else {
      const num = Number(trimmed);
      onChange({ timeoutSeconds: Number.isNaN(num) ? undefined : num });
    }
  };

  return (
    <div className="space-y-6">
      {/* Mini Sequence Header: Before Checks */}
      <NestedChecks
        phase="precheck"
        step={step}
        inputs={inputs}
        depth={depth}
        readOnly={readOnly}
        onChange={onChange}
      />

      {/* Main Action Workspace Card */}
      <div className="rounded-xl border bg-card p-5 shadow-2xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {depth === 1 ? 'Action Execution' : 'Check Execution'}
            </h3>
            <p className="text-xs text-muted-foreground">
              Define the physical command, probe, or mutation executed on the target.
            </p>
          </div>
          <div className="w-48">
            <FormSelect
              name={`step-type-${editorId}`}
              label="Step type"
              value={step.type}
              disabled={readOnly}
              onValueChange={(v: string) => handleTypeChange(v as RunbookStepType)}
              options={RUNBOOK_STEP_TYPES.map(type => ({
                value: type,
                label: type.replaceAll('_', ' '),
              }))}
            />
          </div>
        </div>

        {/* Step Metadata */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={`step-name-${editorId}`}>
              Step Name <span className="text-destructive">*</span>
            </Label>
            <div className="mt-1.5">
              <Input
                id={`step-name-${editorId}`}
                aria-label="Step name"
                placeholder="e.g. Restart checkout service"
                value={step.name}
                maxLength={200}
                disabled={readOnly}
                onChange={e => onChange({ name: e.target.value })}
                className={errors.name ? 'border-destructive' : ''}
              />
            </div>
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name}</p>}
          </div>

          <div>
            <Label htmlFor={`step-key-${editorId}`}>
              Step Key <span className="text-destructive">*</span>
            </Label>
            <div className="mt-1.5">
              <Input
                id={`step-key-${editorId}`}
                aria-label="Step key"
                placeholder="e.g. restart_checkout"
                value={step.key}
                disabled={readOnly}
                onChange={e => onChange({ key: e.target.value })}
                className={errors.key ? 'border-destructive' : ''}
              />
            </div>
            {errors.key ? (
              <p className="mt-1 text-xs text-destructive">{errors.key}</p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                Unique identifier referenced in logs, telemetry, and triggers.
              </p>
            )}
          </div>
        </div>

        <div>
          <Label htmlFor={`step-desc-${editorId}`}>Description / Responder Instructions</Label>
          <div className="mt-1.5">
            <Textarea
              id={`step-desc-${editorId}`}
              aria-label="Step description"
              placeholder="Explain the intent of this step and expected outcome..."
              value={step.description ?? ''}
              disabled={readOnly}
              onChange={e => onChange({ description: e.target.value })}
              className="text-xs min-h-16"
            />
          </div>
        </div>

        {/* Action-Specific Typed Form */}
        <div className="rounded-xl border bg-muted/10 p-4">
          {step.type === 'HTTP' && (
            <HttpActionEditor
              config={step.config}
              errors={errors}
              inputs={inputs}
              readOnly={readOnly}
              onChange={handleConfigChange}
            />
          )}

          {step.type === 'KUBERNETES' && (
            <KubernetesActionEditor
              config={step.config}
              errors={errors}
              inputs={inputs}
              readOnly={readOnly}
              onChange={handleConfigChange}
            />
          )}

          {step.type === 'SYSTEMD' && (
            <SystemdActionEditor
              config={step.config}
              errors={errors}
              readOnly={readOnly}
              onChange={handleConfigChange}
            />
          )}

          {step.type === 'DOCKER' && (
            <DockerActionEditor
              config={step.config}
              errors={errors}
              readOnly={readOnly}
              onChange={handleConfigChange}
            />
          )}

          {step.type === 'LINUX_DIAGNOSTICS' && (
            <LinuxDiagnosticsEditor
              config={step.config}
              errors={errors}
              readOnly={readOnly}
              onChange={handleConfigChange}
            />
          )}

          {step.type === 'BASH' && (
            <BashActionEditor
              config={step.config}
              errors={errors}
              inputs={inputs}
              readOnly={readOnly}
              onChange={handleConfigChange}
            />
          )}

          {step.type === 'CONDITION' && (
            <ConditionActionEditor
              config={step.config}
              errors={errors}
              inputs={inputs}
              editorId={editorId}
              readOnly={readOnly}
              onChange={handleConfigChange}
            />
          )}

          {step.type === 'WAIT' && (
            <WaitActionEditor
              config={step.config}
              errors={errors}
              readOnly={readOnly}
              onChange={handleConfigChange}
            />
          )}

          {(step.type === 'MANUAL' || step.type === 'APPROVAL') && (
            <ManualActionEditor
              config={step.config}
              errors={errors}
              readOnly={readOnly}
              onChange={handleConfigChange}
            />
          )}
        </div>

        {/* Safety, Risk & Approval Controls */}
        <div className="grid gap-4 rounded-xl border p-4 bg-muted/20 sm:grid-cols-2">
          <div>
            <Label htmlFor={`step-risk-${editorId}`}>Risk Classification</Label>
            <div className="mt-1.5">
              <FormSelect
                name={`step-risk-${editorId}`}
                label="Risk classification"
                value={step.riskClass}
                disabled={readOnly || minRisk === 'NON_IDEMPOTENT'}
                onValueChange={(v: string) => handleRiskClassChange(v as RunbookRiskClass)}
                options={[
                  { value: 'READ_ONLY', label: 'READ ONLY (Safe to retry)' },
                  { value: 'IDEMPOTENT_WRITE', label: 'IDEMPOTENT WRITE (Can repeat safely)' },
                  { value: 'NON_IDEMPOTENT', label: 'NON IDEMPOTENT (Destructive mutation)' },
                ]}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Required minimum: <strong>{minRisk.replaceAll('_', ' ')}</strong> based on step action.
            </p>
          </div>

          <div className="space-y-3">
            <Label>Approval Gate Policy</Label>
            <label className="flex items-start gap-2 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={step.requiresApproval || isMandatoryApproval}
                disabled={readOnly || isMandatoryApproval}
                onChange={e => onChange({ requiresApproval: e.target.checked })}
                className="mt-0.5"
              />
              <div>
                <span className="font-semibold text-foreground">
                  {isMandatoryApproval ? 'Mandatory Approval Gate' : 'Require Explicit Human Approval'}
                </span>
                <p className="text-muted-foreground">
                  {isMandatoryApproval
                    ? 'Non-idempotent mutations always require explicit responder approval before execution.'
                    : 'Execution will pause until an on-call responder confirms execution of this step.'}
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Step Timeout */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
          <div className="max-w-xs">
            <Label htmlFor={`step-timeout-${editorId}`}>Execution Timeout (Seconds)</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                id={`step-timeout-${editorId}`}
                aria-label="Step timeout"
                type="number"
                min={1}
                max={86400}
                value={step.timeoutSeconds === undefined || step.timeoutSeconds === null ? 300 : String(step.timeoutSeconds)}
                disabled={readOnly}
                onChange={e => handleTimeoutChange(e.target.value)}
                className={`w-32 ${errors.timeoutSeconds ? 'border-destructive' : ''}`}
              />
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> default 300s (5m)
              </span>
            </div>
            {errors.timeoutSeconds && (
              <p className="mt-1 text-xs text-destructive">{errors.timeoutSeconds}</p>
            )}
          </div>
        </div>
      </div>

      {/* Mini Sequence Footer: After Checks (Verification) */}
      <NestedChecks
        phase="verification"
        step={step}
        inputs={inputs}
        depth={depth}
        readOnly={readOnly}
        onChange={onChange}
      />
    </div>
  );
}

function NestedChecks({
  phase,
  step,
  inputs,
  depth,
  readOnly = false,
  onChange,
}: {
  phase: 'precheck' | 'verification';
  step: RunbookStepDefinition;
  inputs: RunbookInputInput[];
  depth: number;
  readOnly?: boolean;
  onChange: (patch: Partial<RunbookStepDefinition>) => void;
}) {
  const group = phase === 'precheck' ? step.precheck : step.verification;
  const checks = group?.steps ?? [];
  const [identities, setIdentities] = useState(checks.map(check => check.key));
  const [type, setType] = useState<RunbookStepType>('SYSTEMD');
  const label = phase === 'precheck' ? 'Before action' : 'After action';

  const commit = (steps: RunbookStepDefinition[]) =>
    onChange({
      [phase]: steps.length ? { ...group, steps } : undefined,
    });

  const move = (index: number, offset: number) => {
    const next = [...checks];
    const item = next.splice(index, 1)[0];
    if (!item) return;
    next.splice(index + offset, 0, item);
    const ids = [...identities];
    const id = ids.splice(index, 1)[0];
    ids.splice(index + offset, 0, id);
    setIdentities(ids);
    commit(next);
  };

  return (
    <section
      aria-label={`${label} checks`}
      className={`rounded-xl border p-4 ${
        phase === 'precheck' ? 'bg-sky-500/5 border-sky-500/20' : 'bg-emerald-500/5 border-emerald-500/20'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {phase === 'precheck' ? (
            <ShieldAlert className="h-4 w-4 text-sky-500 shrink-0" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
          )}
          <div>
            <h4 className="font-semibold text-sm text-foreground">{label} Checks</h4>
            <p className="text-xs text-muted-foreground">
              {phase === 'precheck'
                ? 'Prechecks verify prerequisites before the main action runs. Failure halts execution.'
                : 'Verifications independently prove recovery after the action runs. Failure marks execution failed.'}
            </p>
          </div>
        </div>
        <Badge variant="outline" className="text-xs">
          {checks.length} {checks.length === 1 ? 'check' : 'checks'}
        </Badge>
      </div>

      {checks.length > 0 && (
        <ol className="mt-3 space-y-2" aria-label={`${label} ordered checks`}>
          {checks.map((check, index) => (
            <li key={identities[index] ?? check.key} className="rounded-lg border bg-card p-3 shadow-2xs">
              <details>
                <summary className="cursor-pointer break-words text-sm font-medium flex items-center justify-between">
                  <span>
                    {index + 1}. {check.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={check.riskClass === 'READ_ONLY' ? 'secondary' : 'warning'}>
                      {check.riskClass === 'READ_ONLY' ? 'READ ONLY' : 'WRITE'}
                    </Badge>
                    {(check.requiresApproval || check.riskClass === 'NON_IDEMPOTENT') && (
                      <Badge variant="warning">APPROVAL</Badge>
                    )}
                  </div>
                </summary>
                <div className="mt-3 pt-3 border-t">
                  <StepEditor
                    step={check}
                    inputs={inputs}
                    editorId={identities[index] ?? check.key}
                    depth={depth + 1}
                    readOnly={readOnly}
                    onChange={patch =>
                      commit(
                        checks.map((item, pos) => (pos === index ? { ...item, ...patch } : item))
                      )
                    }
                  />
                </div>
              </details>

              {!readOnly && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${check.name} up in ${label}`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${check.name} down in ${label}`}
                    disabled={index === checks.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${check.name} from ${label}`}
                    onClick={() => {
                      setIdentities(identities.filter((_, pos) => pos !== index));
                      commit(checks.filter((_, pos) => pos !== index));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {!readOnly && depth < 3 && checks.length < 10 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="w-48">
            <FormSelect
              name={`${phase}-type-${step.key}`}
              label={`${label} check type`}
              value={type}
              onValueChange={(v: string) => setType(v as RunbookStepType)}
              options={RUNBOOK_STEP_TYPES.map(val => ({
                value: val,
                label: val.replaceAll('_', ' '),
              }))}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const key = `${phase}_${crypto.randomUUID().replaceAll('-', '_').slice(0, 8)}`;
              setIdentities([...identities, key]);
              commit([...checks, newBuilderStep(type, key)]);
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            {phase === 'precheck' ? 'Add precheck' : 'Add verification'}
          </Button>
        </div>
      )}
    </section>
  );
}
