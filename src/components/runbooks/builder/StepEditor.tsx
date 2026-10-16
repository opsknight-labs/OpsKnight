'use client';

import { useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Clock,
  FileText,
  Info,
  ListChecks,
  Lock,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import { FormSelect } from '../RunbookControls';
import { Pill, SectionCard, TONE_SURFACE } from '../ui/primitives';
import { RISK_META, STEP_CATALOG } from './step-catalog';
import {
  RUNBOOK_STEP_TYPES,
  DEFAULT_STEP_TIMEOUT_SECONDS,
  DEFAULT_LEASE_DURATION_SECONDS,
  type RunbookRiskClass,
  type RunbookStepDefinition,
  type RunbookStepType,
} from '@/lib/runbooks/types';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';
import { newBuilderStep, builderRisk } from '@/lib/runbooks/builder';
import { validateStep } from './validation';

import HttpActionEditor from './action-editors/HttpActionEditor';
import KubernetesActionEditor from './action-editors/KubernetesActionEditor';
import DockerActionEditor from './action-editors/DockerActionEditor';
import SystemdActionEditor from './action-editors/SystemdActionEditor';
import LinuxDiagnosticsEditor from './action-editors/LinuxDiagnosticsEditor';
import BashActionEditor from './action-editors/BashActionEditor';
import ConditionActionEditor from './action-editors/ConditionActionEditor';
import WaitActionEditor from './action-editors/WaitActionEditor';

const AGENT_PREREQUISITES: Record<RunbookStepType, string> = {
  KUBERNETES:
    'Requires Agent with KUBERNETES capability and cluster RBAC permissions in target namespace.',
  DOCKER: 'Requires Agent with DOCKER capability and local container engine socket access.',
  SYSTEMD: 'Requires Agent with SYSTEMD capability and systemctl/journalctl permissions on host.',
  BASH: 'Requires Agent with BASH capability; command must match local bashCommandPatterns allowlist.',
  LINUX_DIAGNOSTICS: 'Requires Agent with LINUX_DIAGNOSTICS capability on the host.',
  HTTP: 'Executed by OpsKnight control plane via outbound network request (no host Agent required).',
  WAIT: 'Executed by control-plane orchestrator timer.',
  CONDITION: 'Evaluated directly against incident context by control plane.',
  MANUAL: 'Assigned to a human operator during execution.',
  APPROVAL: 'Requires a responder with runbook.approve and access to the incident.',
};
import ManualActionEditor from './action-editors/ManualActionEditor';

interface StepEditorProps {
  step: RunbookStepDefinition;
  inputs: RunbookInputInput[];
  editorId: string;
  depth?: number;
  errors?: Record<string, string>;
  readOnly?: boolean;
  onChange: (patch: Partial<RunbookStepDefinition>) => void;
  expandedChecks?: ReadonlySet<string>;
  onToggleCheck?: (key: string, open: boolean) => void;
}

function getRiskRank(risk: RunbookRiskClass): number {
  if (risk === 'NON_IDEMPOTENT') return 2;
  if (risk === 'IDEMPOTENT_WRITE') return 1;
  return 0;
}

export default function StepEditor({
  step,
  inputs,
  editorId,
  depth = 1,
  errors = {},
  readOnly = false,
  onChange,
  expandedChecks,
  onToggleCheck,
}: StepEditorProps) {
  const minRisk = builderRisk(step);
  const isMandatoryApproval =
    step.riskClass === 'NON_IDEMPOTENT' || ['APPROVAL', 'MANUAL'].includes(step.type);

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
    } else if (getRiskRank(nextRisk) < getRiskRank(requiredMinRisk)) {
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
    if (getRiskRank(selectedRisk) < getRiskRank(minRisk)) return;
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

  const catalog = STEP_CATALOG[step.type];
  const approvalChecked = step.requiresApproval || isMandatoryApproval;
  const checks = depth < 3 && (
    <>
      <NestedChecks
        key={`precheck-${editorId}`}
        phase="precheck"
        step={step}
        inputs={inputs}
        depth={depth}
        readOnly={readOnly}
        onChange={onChange}
        expandedChecks={expandedChecks}
        onToggleCheck={onToggleCheck}
      />
      <NestedChecks
        key={`verification-${editorId}`}
        phase="verification"
        step={step}
        inputs={inputs}
        depth={depth}
        readOnly={readOnly}
        onChange={onChange}
        expandedChecks={expandedChecks}
        onToggleCheck={onToggleCheck}
      />
    </>
  );

  return (
    <div className="space-y-4">
      <EditorSection
        depth={depth}
        icon={FileText}
        title="Basics"
        description="A clear name helps responders recognise this step in live timelines."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`step-name-${editorId}`} label="Step name" required error={errors.name}>
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
          </Field>
          <Field
            id={`step-key-${editorId}`}
            label="Step key"
            required
            error={errors.key}
            hint="Unique ID used in logs, outputs and conditions."
          >
            <Input
              id={`step-key-${editorId}`}
              aria-label="Step key"
              placeholder="e.g. restart_checkout"
              value={step.key}
              disabled={readOnly}
              onChange={e => onChange({ key: e.target.value })}
              className={cn('font-mono text-xs', errors.key && 'border-destructive')}
            />
          </Field>
        </div>
        <Field id={`step-type-${editorId}`} label="Step type">
          <FormSelect
            name={`step-type-${editorId}`}
            label="Step type"
            value={step.type}
            disabled={readOnly}
            onValueChange={(v: string) => handleTypeChange(v as RunbookStepType)}
            options={RUNBOOK_STEP_TYPES.map(type => ({
              value: type,
              label: STEP_CATALOG[type].label,
            }))}
          />
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{AGENT_PREREQUISITES[step.type]}</span>
          </p>
        </Field>
        <Field
          id={`step-desc-${editorId}`}
          label="Responder notes"
          optional
          hint="Why this step exists and what “good” looks like."
        >
          <Textarea
            id={`step-desc-${editorId}`}
            aria-label="Step description"
            placeholder="Explain the intent of this step and the expected outcome…"
            value={step.description ?? ''}
            disabled={readOnly}
            onChange={e => onChange({ description: e.target.value })}
            className="min-h-16 text-sm"
          />
        </Field>
      </EditorSection>

      <EditorSection
        depth={depth}
        icon={catalog.icon}
        title={depth === 1 ? `Action · ${catalog.label}` : `Check · ${catalog.label}`}
        description={catalog.description}
      >
        {step.type === 'HTTP' && (
          <HttpActionEditor
            config={step.config}
            errors={errors}
            inputs={inputs}
            editorId={editorId}
            readOnly={readOnly}
            onChange={handleConfigChange}
          />
        )}
        {step.type === 'KUBERNETES' && (
          <KubernetesActionEditor
            config={step.config}
            errors={errors}
            inputs={inputs}
            editorId={editorId}
            readOnly={readOnly}
            onChange={handleConfigChange}
          />
        )}
        {step.type === 'SYSTEMD' && (
          <SystemdActionEditor
            config={step.config}
            errors={errors}
            inputs={inputs}
            editorId={editorId}
            readOnly={readOnly}
            onChange={handleConfigChange}
          />
        )}
        {step.type === 'DOCKER' && (
          <DockerActionEditor
            config={step.config}
            errors={errors}
            inputs={inputs}
            editorId={editorId}
            readOnly={readOnly}
            onChange={handleConfigChange}
          />
        )}
        {step.type === 'LINUX_DIAGNOSTICS' && (
          <LinuxDiagnosticsEditor
            config={step.config}
            errors={errors}
            editorId={editorId}
            readOnly={readOnly}
            onChange={handleConfigChange}
          />
        )}
        {step.type === 'BASH' && (
          <BashActionEditor
            config={step.config}
            errors={errors}
            inputs={inputs}
            editorId={editorId}
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
            editorId={editorId}
            readOnly={readOnly}
            onChange={handleConfigChange}
          />
        )}
        {(step.type === 'MANUAL' || step.type === 'APPROVAL') && (
          <ManualActionEditor
            config={step.config}
            errors={errors}
            editorId={editorId}
            readOnly={readOnly}
            onChange={handleConfigChange}
          />
        )}
      </EditorSection>

      <EditorSection
        depth={depth}
        icon={ShieldCheck}
        title="Safety"
        description="How risky this step is and what has to happen before it runs."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={`step-risk-${editorId}`}
            label="Risk"
            hint={
              <>
                Minimum for this action:{' '}
                <span className="font-medium text-foreground">{RISK_META[minRisk].label}</span>
              </>
            }
          >
            <FormSelect
              name={`step-risk-${editorId}`}
              label="Risk classification"
              value={step.riskClass}
              disabled={readOnly || minRisk === 'NON_IDEMPOTENT'}
              onValueChange={(v: string) => handleRiskClassChange(v as RunbookRiskClass)}
              options={[
                { value: 'READ_ONLY', label: 'Read-only · safe to retry' },
                { value: 'IDEMPOTENT_WRITE', label: 'Safe write · same result if repeated' },
                { value: 'NON_IDEMPOTENT', label: 'Mutation · always needs approval' },
              ]}
            />
          </Field>
          <Field
            id={`step-timeout-${editorId}`}
            label="Timeout"
            error={errors.timeoutSeconds}
            hint={`Seconds. Defaults to ${DEFAULT_STEP_TIMEOUT_SECONDS}s.`}
          >
            <div className="flex items-center gap-2">
              <Input
                id={`step-timeout-${editorId}`}
                aria-label="Step timeout"
                type="number"
                min={1}
                max={86400}
                value={
                  step.timeoutSeconds === undefined || step.timeoutSeconds === null
                    ? DEFAULT_STEP_TIMEOUT_SECONDS
                    : String(step.timeoutSeconds)
                }
                disabled={readOnly}
                onChange={e => handleTimeoutChange(e.target.value)}
                className={cn('w-32 tabular-nums', errors.timeoutSeconds && 'border-destructive')}
              />
              <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
          </Field>
        </div>

        <label
          className={cn(
            'flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
            approvalChecked ? 'border-amber-500/30 bg-amber-500/5' : 'bg-muted/20',
            !(readOnly || isMandatoryApproval) && 'cursor-pointer hover:bg-muted/40'
          )}
        >
          <input
            type="checkbox"
            checked={approvalChecked}
            disabled={readOnly || isMandatoryApproval}
            onChange={e => onChange({ requiresApproval: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              {isMandatoryApproval ? 'Approval always required' : 'Require approval before running'}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {isMandatoryApproval
                ? 'Mutations, manual tasks and approval steps always wait for a responder.'
                : 'The run pauses until an on-call responder approves this step.'}
            </span>
          </span>
        </label>

        {depth === 1 && (
          <details className="group rounded-lg text-xs text-muted-foreground">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-sm font-medium text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight
                className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
                aria-hidden="true"
              />
              How safety works
            </summary>
            <div className="mt-2 space-y-1.5 pl-5 leading-relaxed">
              <p>
                Risk can be raised but never set below what the action needs. Agent policy on the
                host is always authoritative and can still block a step.
              </p>
              <p>
                The overall runbook deadline and Agent maximum runtime can shorten this timeout.
                Agents claim work with a {DEFAULT_LEASE_DURATION_SECONDS}s renewable lease; that
                lease is not the execution timeout.
              </p>
            </div>
          </details>
        )}
      </EditorSection>

      {checks &&
        (depth === 1 ? (
          <EditorSection
            depth={depth}
            icon={ListChecks}
            title="Checks"
            description="Prove it’s safe to act first, then prove the action worked."
          >
            {checks}
          </EditorSection>
        ) : (
          checks
        ))}
    </div>
  );
}

function EditorSection({
  depth,
  icon,
  title,
  description,
  children,
}: {
  depth: number;
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  if (depth === 1) {
    return (
      <SectionCard icon={icon} title={title} description={description} bodyClassName="space-y-4">
        {children}
      </SectionCard>
    );
  }
  const Icon = icon;
  return (
    <div className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
      <h5 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        {title}
      </h5>
      {children}
    </div>
  );
}

function Field({
  id,
  label,
  required,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1 text-xs font-medium">
        {label}
        {required && (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        )}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
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
  expandedChecks,
  onToggleCheck,
}: {
  phase: 'precheck' | 'verification';
  step: RunbookStepDefinition;
  inputs: RunbookInputInput[];
  depth: number;
  readOnly?: boolean;
  onChange: (patch: Partial<RunbookStepDefinition>) => void;
  expandedChecks?: ReadonlySet<string>;
  onToggleCheck?: (key: string, open: boolean) => void;
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

  const sectionLabel =
    depth === 1 ? `${label} checks` : `${label} checks for ${step.name || step.key}`;
  const testId = depth === 1 ? `action-${phase}-checks` : `nested-${phase}-checks-${step.key}`;

  return (
    <section
      aria-label={sectionLabel}
      data-testid={testId}
      className="rounded-2xl border border-border/80 dark:border-border/60 bg-muted/20 backdrop-blur-xs p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
              phase === 'precheck' ? TONE_SURFACE.info : TONE_SURFACE.success
            )}
          >
            {phase === 'precheck' ? (
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div>
            <h4 className="text-sm font-medium text-foreground">{label} checks</h4>
            <p className="text-xs text-muted-foreground">
              {phase === 'precheck'
                ? 'Run before the action. If one fails, the run stops safely.'
                : 'Run after the action to prove recovery. If one fails, the run is marked failed.'}
            </p>
          </div>
        </div>
        <Pill className="tabular-nums">
          {checks.length} {checks.length === 1 ? 'check' : 'checks'}
        </Pill>
      </div>

      {checks.length > 0 && (
        <ol className="mt-3 space-y-2.5" aria-label={`${label} ordered checks`}>
          {checks.map((check, index) => {
            const checkResult = validateStep(check, inputs);
            const checkErrors = checkResult.errors;
            const issueCount = Object.keys(checkErrors).length;
            const checkRisk = RISK_META[check.riskClass];

            return (
              <li
                key={identities.at(index) ?? check.key}
                className="rounded-xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs transition-all hover:border-primary/40"
              >
                <details
                  open={issueCount > 0 || expandedChecks?.has(check.key) || undefined}
                  onToggle={event => onToggleCheck?.(check.key, event.currentTarget.open)}
                  className="group"
                >
                  <summary className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-xl px-3.5 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex min-w-0 items-center gap-2">
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                        aria-hidden="true"
                      />
                      <span className="truncate">
                        {index + 1}. {check.name || 'Untitled check'}
                      </span>
                      {issueCount > 0 && (
                        <Badge
                          variant="destructive"
                          className="flex shrink-0 items-center gap-1 px-1.5 py-0 text-[10px]"
                        >
                          <AlertCircle className="h-3 w-3" aria-hidden="true" />
                          {issueCount} {issueCount === 1 ? 'issue' : 'issues'}
                        </Badge>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Pill tone={checkRisk.tone}>{checkRisk.label}</Pill>
                      {(check.requiresApproval || check.riskClass === 'NON_IDEMPOTENT') && (
                        <Pill tone="warning" icon={Lock}>
                          Approval
                        </Pill>
                      )}
                    </span>
                  </summary>
                  <div className="border-t p-3 sm:p-4">
                    <StepEditor
                      step={check}
                      inputs={inputs}
                      editorId={identities.at(index) ?? check.key}
                      depth={depth + 1}
                      errors={checkErrors}
                      readOnly={readOnly}
                      expandedChecks={expandedChecks}
                      onToggleCheck={onToggleCheck}
                      onChange={patch =>
                        commit(
                          checks.map((item, pos) => (pos === index ? { ...item, ...patch } : item))
                        )
                      }
                    />
                  </div>
                </details>

                {!readOnly && (
                  <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Move ${check.name} up in ${label}`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Move ${check.name} down in ${label}`}
                      disabled={index === checks.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-8 gap-1 text-xs text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${check.name} from ${label}`}
                      onClick={() => {
                        setIdentities(identities.filter((_, pos) => pos !== index));
                        commit(checks.filter((_, pos) => pos !== index));
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {!readOnly && depth < 3 && checks.length < 10 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-52">
            <FormSelect
              name={`${phase}-type-${step.key}`}
              label={`${label} check type`}
              value={type}
              onValueChange={(v: string) => setType(v as RunbookStepType)}
              options={RUNBOOK_STEP_TYPES.map(val => ({
                value: val,
                label: STEP_CATALOG[val].label,
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
            <Plus className="h-4 w-4" aria-hidden="true" />
            {phase === 'precheck' ? 'Add precheck' : 'Add verification'}
          </Button>
        </div>
      )}
    </section>
  );
}
