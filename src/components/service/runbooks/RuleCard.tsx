'use client';

import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  Archive,
  BookOpen,
  ChevronDown,
  Clock,
  FileSearch,
  Hand,
  Play,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import {
  ActionForm,
  ConfirmAction,
  FormSelect,
  SubmitButton,
} from '@/components/runbooks/RunbookControls';
import RunbookSelectorBuilder from '@/components/runbooks/RunbookSelectorBuilder';
import AutomaticTargetGuard from '@/components/runbooks/AutomaticTargetGuard';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import Field from '@/components/runbooks/RunbookField';
import { Pill } from '@/components/runbooks/ui/primitives';
import {
  checkRulePolicyAction,
  configureRunbookTriggerAction,
  detachRunbookAction,
  duplicateRuleAction,
  pauseRuleAction,
  updateRunbookBindingAction,
} from '@/app/(app)/services/[id]/runbook-actions';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import {
  describeBinding,
  type RunbookResource,
} from '@/lib/runbooks/presentation/binding-contract';
import {
  RULE_STATUS_STYLE,
  RuleStatusPill,
} from '@/components/service/automation-rule/RuleStatusPill';
import {
  TONE_DOT,
  TONE_TEXT,
  readinessPresentation,
  ruleStatusKind,
} from '@/components/service/automation-rule/rule-presentation';
import RunbookBindingVersionInputs from '../RunbookBindingVersionInputs';
import { InputSummary, hasAgentWrites } from './rule-fields';
import { RuleSheet, SheetGroup, SheetJumpNav } from './RuleSheet';
import TriggerConditionEditor from './TriggerConditionEditor';
import {
  RuleAutomationFields,
  RuleUnattendedWrites,
  type ServiceRunbookUnattendedWriteDetails,
} from './RuleAutomationControls';
import type { AutomationContextSummary } from './context-helpers';
import type {
  AvailableRunbook,
  ServiceRunbookAgent,
  ServiceRunbookAgentPool,
  ServiceRunbookBinding,
} from '../ServiceRunbooks';

function relative(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatDistanceToNowStrict(date, { addSuffix: true });
}

export function ArchivedRuleCard({
  serviceId,
  binding,
}: {
  serviceId: string;
  binding: ServiceRunbookBinding;
}) {
  return (
    <article className="bg-card group relative overflow-hidden rounded-xl border border-dashed border-border/80 bg-card/60 backdrop-blur-xs p-3.5 sm:p-4 shadow-xs hover:border-border transition-all">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 border border-border/70 text-muted-foreground shadow-2xs">
            <Archive className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="break-words text-sm sm:text-base font-bold text-foreground">
              {binding.name || binding.runbook.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Rule detached · Archived execution history retained
            </p>
          </div>
        </div>
        <RuleStatusPill kind="ARCHIVED" />
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
        This rule cannot be triggered. Its configuration parameters, condition rules, and past
        execution evidence are permanently preserved for audit.
      </p>
      <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 shadow-2xs text-xs font-semibold"
        >
          <Link href={`/services/${serviceId}/automations/${binding.id}`}>
            <FileSearch className="h-3.5 w-3.5" aria-hidden />
            View Archived Evidence
          </Link>
        </Button>
      </div>
    </article>
  );
}

export function RuleCard({
  serviceId,
  binding,
  availableRunbooks,
  availableAgents,
  availableAgentPools,
  canManage,
  configurationAvailable,
  loadErrors,
  userTimeZone,
  automationContext = null,
  unattendedWriteDetails,
  canAuthorizeUnattendedWrites = false,
}: {
  serviceId: string;
  binding: ServiceRunbookBinding;
  availableRunbooks: AvailableRunbook[];
  availableAgents: ServiceRunbookAgent[];
  availableAgentPools: ServiceRunbookAgentPool[];
  canManage: boolean;
  configurationAvailable: boolean;
  loadErrors: RunbookResource[];
  userTimeZone?: string;
  automationContext?: AutomationContextSummary | null;
  unattendedWriteDetails?: ServiceRunbookUnattendedWriteDetails[string];
  canAuthorizeUnattendedWrites?: boolean;
}) {
  const { userTimeZone: contextTz } = useTimezone();
  const activeTz = userTimeZone || contextTz;
  const presentation =
    binding.presentation ??
    describeBinding(binding, availableAgents, availableAgentPools, loadErrors);
  const lastExecution = binding.executions?.[0];
  const kind = ruleStatusKind({ mode: binding.mode, enabled: binding.enabled, detachedAt: null });
  const accent = RULE_STATUS_STYLE.get(kind)?.accent;
  const rulePath = `/services/${serviceId}/automations/${binding.id}`;
  const blocked = binding.readiness?.checks.filter(check => check.state === 'blocked') ?? [];
  const executionCount = binding._count?.executions ?? binding.executions?.length ?? 0;
  const readinessView = binding.readiness ? readinessPresentation(binding.readiness.state) : null;

  return (
    <article className="bg-card group relative overflow-hidden rounded-xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs hover:border-border hover:shadow-md transition-all duration-200">
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', accent)} />
      <div className="space-y-3 p-3.5 sm:p-4 pl-4 sm:pl-4.5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <div
              className={cn(
                'flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-lg shadow-2xs transition-transform group-hover:scale-105',
                binding.mode === 'AUTOMATIC'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                  : binding.mode === 'SUGGESTED'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                    : 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20'
              )}
            >
              {binding.mode === 'AUTOMATIC' ? (
                <Zap className="h-4 w-4" />
              ) : binding.mode === 'SUGGESTED' ? (
                <Sparkles className="h-4 w-4" />
              ) : (
                <Hand className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm sm:text-base font-bold leading-snug">
                <Link
                  href={rulePath}
                  className="break-words text-foreground hover:text-primary transition-colors focus-visible:underline"
                >
                  {binding.name || binding.runbook.name}
                </Link>
              </h3>
              <p className="line-clamp-1 mt-0.5 text-xs text-muted-foreground">
                Runs{' '}
                <strong className="font-semibold text-foreground/90">{binding.runbook.name}</strong>
                {binding.runbook.description ? ` · ${binding.runbook.description}` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0 self-start sm:self-auto sm:justify-end">
            <RuleStatusPill kind={kind} />
            <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/50 px-2 py-0.5 text-[11px] font-mono font-medium text-foreground shadow-2xs">
              {binding.versionStrategy === 'PINNED'
                ? `v${binding.runbookVersion?.version ?? '?'} pinned`
                : 'Latest published'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <div className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-0.5 text-muted-foreground text-[11px] shadow-2xs">
            <Server className="h-3 w-3 text-primary shrink-0" />
            <span className="min-w-0 break-words">
              Target: {presentation.target} · Trigger: {presentation.trigger}
            </span>
          </div>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/70 rounded-lg border border-border/70 bg-muted/20">
          <div className="min-w-0 px-3 py-1.5 sm:py-2">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3 text-muted-foreground" /> Last Run
            </dt>
            <dd className="mt-0.5 min-w-0">
              {lastExecution ? (
                <Link
                  href={`/runbooks/executions/${lastExecution.id}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 hover:underline"
                >
                  <RunbookStatusBadge status={lastExecution.status} size="sm" />
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {relative(lastExecution.createdAt)}
                  </span>
                </Link>
              ) : (
                <span className="text-xs font-medium text-muted-foreground">Never run</span>
              )}
            </dd>
          </div>
          <div className="min-w-0 px-3 py-1.5 sm:py-2">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Activity className="h-3 w-3 text-muted-foreground" /> Executions
            </dt>
            <dd className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-sm sm:text-base font-extrabold tracking-tight text-foreground tabular-nums">
                {executionCount}
              </span>
              <span className="text-[11px] text-muted-foreground">runs</span>
            </dd>
          </div>
          <div className="min-w-0 px-3 py-1.5 sm:py-2">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-muted-foreground" /> Fleet Readiness
            </dt>
            <dd className="mt-0.5 text-xs">
              {readinessView ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 font-semibold text-xs',
                    TONE_TEXT[readinessView.tone]
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      TONE_DOT[readinessView.tone]
                    )}
                  />
                  {readinessView.label}
                </span>
              ) : (
                <span className="font-medium text-muted-foreground text-xs">Not checked</span>
              )}
            </dd>
          </div>
        </dl>

        {binding.readiness && (
          <section
            aria-label="Rule readiness"
            className={cn(
              'space-y-1 text-xs',
              blocked.length > 0 &&
                'rounded-lg bg-destructive/5 p-2.5 ring-1 ring-inset ring-destructive/20'
            )}
          >
            <p className="text-muted-foreground text-[11px]">
              {binding.readiness.eligibleAgents === null
                ? binding.readiness.state === 'PAUSED'
                  ? 'Target checks paused'
                  : binding.readiness.checks.some(
                        check => check.code === 'INCIDENT_CONTEXT_REQUIRED'
                      )
                    ? 'Target requires incident context'
                    : 'Target check unavailable'
                : `${binding.readiness.eligibleAgents} matching online Agents`}{' '}
              · checked{' '}
              <time
                dateTime={binding.readiness.checkedAt}
                title={formatDateTime(binding.readiness.checkedAt, activeTz, {
                  format: 'datetime',
                  includeTimeZone: true,
                })}
                suppressHydrationWarning
              >
                {formatDateTime(binding.readiness.checkedAt, activeTz, {
                  format: 'time',
                  includeTimeZone: true,
                })}
              </time>
            </p>
            {blocked.slice(0, 3).map(check => (
              <p key={check.code} className="flex items-start gap-1.5 text-xs">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                <span>
                  {check.message}{' '}
                  <Link href={`${rulePath}#checks`} className="font-medium underline">
                    Fix
                  </Link>
                </span>
              </p>
            ))}
          </section>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-muted/20 px-3.5 sm:px-4 py-2 pl-4 sm:pl-4.5">
        {binding.enabled && (
          <Button asChild size="sm" className="h-8 gap-1.5 shadow-2xs font-semibold text-xs">
            <Link href={`${rulePath}#run-now`}>
              <Play className="h-3.5 w-3.5" aria-hidden />
              Run now
            </Link>
          </Button>
        )}
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 shadow-2xs font-semibold text-xs"
        >
          <Link href={rulePath}>
            <FileSearch className="h-3.5 w-3.5" aria-hidden />
            Rule evidence
          </Link>
        </Button>
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 font-semibold text-xs text-muted-foreground hover:text-foreground"
        >
          <Link href={`/runbooks/${binding.runbookId}`}>
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            <span>View Runbook</span>
          </Link>
        </Button>
        {canManage && configurationAvailable && (
          <div className="sm:ml-auto">
            <RuleConfigureSheet
              serviceId={serviceId}
              binding={binding}
              availableRunbooks={availableRunbooks}
              availableAgents={availableAgents}
              availableAgentPools={availableAgentPools}
              automationContext={automationContext}
            />
          </div>
        )}
      </div>

      <details className="group/manage border-t border-border/60 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-3.5 sm:px-4 py-2 pl-4 sm:pl-4.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          Manage rule
          <ChevronDown
            className="h-3.5 w-3.5 transition-transform group-open/manage:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="space-y-3 border-t border-border/60 px-3.5 sm:px-4 py-3 pl-4 sm:pl-4.5">
          <div>
            <h4 className="mb-2 text-xs font-semibold text-foreground">Inputs</h4>
            <InputSummary
              definitions={
                binding.runbookVersion?.inputs ?? binding.runbook.publishedVersion?.inputs ?? []
              }
              values={binding.inputValues as Record<string, unknown>}
            />
          </div>
          {(canManage || canAuthorizeUnattendedWrites) && (
            <RuleUnattendedWrites
              serviceId={serviceId}
              rule={binding}
              details={unattendedWriteDetails}
              canAuthorize={canAuthorizeUnattendedWrites}
            />
          )}
          {canManage && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {configurationAvailable && (
                  <ActionForm
                    action={checkRulePolicyAction.bind(null, serviceId, binding.id)}
                    successMessage="Policy check requested"
                  >
                    <SubmitButton
                      variant="outline"
                      size="sm"
                      pendingLabel="Requesting read-only policy check…"
                    >
                      Check Agent policy · No execution
                    </SubmitButton>
                  </ActionForm>
                )}
                <ActionForm
                  action={duplicateRuleAction.bind(null, serviceId, binding.id)}
                  successMessage="Paused copy created"
                >
                  <SubmitButton variant="outline" size="sm" pendingLabel="Duplicating…">
                    Duplicate paused rule
                  </SubmitButton>
                </ActionForm>
                {binding.enabled && (
                  <ConfirmAction
                    action={pauseRuleAction.bind(null, serviceId, binding.id)}
                    label="Pause rule"
                    title="Pause this automation rule?"
                    description="This stops future triggering. Existing executions retain their own cancellation and approval controls."
                    successMessage="Rule paused"
                  />
                )}
              </div>
              {configurationAvailable && (
                <p className="text-xs text-muted-foreground">
                  Policy checks compare this configuration with each Agent&apos;s local policy.
                  Nothing runs.
                </p>
              )}
            </div>
          )}
        </div>
      </details>
    </article>
  );
}

function RuleConfigureSheet({
  serviceId,
  binding,
  availableRunbooks,
  availableAgents,
  availableAgentPools,
  automationContext,
}: {
  serviceId: string;
  binding: ServiceRunbookBinding;
  availableRunbooks: AvailableRunbook[];
  availableAgents: ServiceRunbookAgent[];
  availableAgentPools: ServiceRunbookAgentPool[];
  automationContext: AutomationContextSummary | null;
}) {
  const automatic = binding.mode === 'AUTOMATIC';
  return (
    <RuleSheet
      title={`Configure ${binding.name || binding.runbook.name}`}
      description={`Runs ${binding.runbook.name}. Changes apply to future runs; existing executions are unaffected.`}
      trigger={
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
          <span>Configure</span>
        </Button>
      }
    >
      <SheetJumpNav
        label="Rule configuration sections"
        items={[
          { id: 'rule-config-version', label: 'Version & inputs' },
          { id: 'rule-config-target', label: 'Target' },
          { id: 'rule-config-automation', label: 'Service Automation' },
          { id: 'rule-config-trigger', label: 'Trigger' },
          { id: 'rule-config-danger', label: 'Danger zone', tone: 'danger' },
        ]}
      />
      {automatic && (
        <div
          role="note"
          className="mb-6 flex items-start gap-2.5 rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-500/30 dark:text-amber-100"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p>
            Saving configuration or trigger conditions pauses this Automatic rule immediately.{' '}
            <Link
              className="font-medium underline underline-offset-2"
              href={`/services/${serviceId}/automations/${binding.id}`}
            >
              Recheck policy and reactivate from Rule evidence
            </Link>{' '}
            after every save. Suggestions and execution history are kept.
          </p>
        </div>
      )}

      <ActionForm
        key={`configuration-${binding.id}`}
        action={updateRunbookBindingAction.bind(null, serviceId, binding.id)}
        className="flex flex-col gap-8"
        successMessage="Rule configuration saved"
      >
        <div key={binding.configurationRevision} className="contents">
          <input
            type="hidden"
            name="expectedConfigurationRevision"
            value={binding.configurationRevision}
          />
          <RunbookBindingVersionInputs
            layout="sections"
            initialMode={binding.mode}
            runbookId={binding.runbookId}
            versions={[
              ...new Map(
                [
                  ...(availableRunbooks
                    .find(item => item.id === binding.runbookId)
                    ?.versions.map(version => ({
                      ...version,
                      inputs: version.inputs ?? [],
                    })) ?? []),
                  ...(binding.runbookVersion ? [binding.runbookVersion] : []),
                  ...(binding.runbook.publishedVersion ? [binding.runbook.publishedVersion] : []),
                ].map(version => [version.id, version])
              ).values(),
            ].map(version => ({
              ...version,
              hasAgentWrite: hasAgentWrites(version.definition),
            }))}
            publishedVersionId={binding.runbook.publishedVersionId ?? ''}
            initialStrategy={binding.versionStrategy}
            initialVersionId={binding.runbookVersionId}
            values={binding.inputValues as Record<string, unknown>}
            targets={{
              agents: availableAgents,
              pools: availableAgentPools,
              defaultValue: binding.defaultAgentId
                ? `agent:${binding.defaultAgentId}`
                : binding.defaultAgentPoolId
                  ? `pool:${binding.defaultAgentPoolId}`
                  : 'none',
            }}
            targetExtras={
              <>
                <RunbookSelectorBuilder initialValue={binding.agentSelector} />
                <AutomaticTargetGuard />
              </>
            }
          />
          <SheetGroup title="Rule details" description="Name and whether the rule can run.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rule name">
                <Input
                  name="ruleName"
                  defaultValue={binding.name ?? ''}
                  placeholder={binding.runbook.name}
                  maxLength={200}
                />
              </Field>
              <div className="space-y-2">
                <Label htmlFor="enabled">Status</Label>
                <FormSelect
                  name="enabled"
                  label="Binding status"
                  defaultValue={String(binding.enabled)}
                  options={[
                    { value: 'true', label: 'Enabled' },
                    { value: 'false', label: 'Disabled' },
                  ]}
                />
              </div>
            </div>
          </SheetGroup>
          <SheetGroup
            id="rule-config-automation"
            title="Service Automation"
            description="Monitoring opt-in, verified recovery and inputs or targets taken from the incident's automation context."
          >
            <RuleAutomationFields
              inputs={
                binding.runbookVersion?.inputs ?? binding.runbook.publishedVersion?.inputs ?? []
              }
              automationContext={automationContext}
              agents={availableAgents}
              pools={availableAgentPools}
              defaults={{
                resolveOnVerifiedRecovery: binding.resolveOnVerifiedRecovery,
                runOnMonitoringIncidents: binding.runOnMonitoringIncidents,
                contextInputMappings: binding.contextInputMappings,
                contextTargetMappings: binding.contextTargetMappings,
              }}
            />
          </SheetGroup>
          <div className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <p className="text-xs text-muted-foreground">
              {automatic
                ? 'Saving pauses this Automatic rule.'
                : 'Saves version, target and inputs.'}
            </p>
            <SubmitButton>
              {automatic ? 'Save and pause Automatic rule' : 'Save binding'}
            </SubmitButton>
          </div>
        </div>
      </ActionForm>

      <ActionForm
        key={`trigger-${binding.id}`}
        action={configureRunbookTriggerAction.bind(null, serviceId, binding.id)}
        className="mt-8 flex flex-col gap-4 border-t pt-8"
      >
        <div key={binding.configurationRevision} className="contents">
          <input
            type="hidden"
            name="expectedConfigurationRevision"
            value={binding.configurationRevision}
          />
          <SheetGroup
            id="rule-config-trigger"
            title="Trigger"
            description="What starts this rule. Automatic runs still stop at approval gates."
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event">Trigger event</Label>
                <FormSelect
                  name="event"
                  label="Trigger event"
                  defaultValue="INCIDENT_CREATED"
                  options={[{ value: 'INCIDENT_CREATED', label: 'Incident created' }]}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="conditionLogic">Condition logic</Label>
                <FormSelect
                  name="conditionLogic"
                  label="Condition logic"
                  defaultValue={binding.triggers?.[0]?.conditionLogic ?? 'AND'}
                  options={[
                    { value: 'AND', label: 'Match all' },
                    { value: 'OR', label: 'Match any' },
                  ]}
                />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Conditions</p>
              <TriggerConditionEditor
                conditions={binding.triggers?.[0]?.conditions ?? []}
                automationContext={automationContext}
              />
              <p className="text-xs text-muted-foreground">
                Rows set to “No additional condition” are ignored. Comma-separate values for “is one
                of”.
              </p>
            </div>
            <div className="flex justify-end">
              <SubmitButton variant="outline" pendingLabel="Saving trigger…">
                {automatic ? 'Save trigger and pause Automatic rule' : 'Save trigger'}
              </SubmitButton>
            </div>
          </SheetGroup>
        </div>
      </ActionForm>

      <SheetGroup
        id="rule-config-danger"
        title="Danger zone"
        className="mb-6 mt-8 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-sm text-xs text-muted-foreground">
            Detaching archives the rule so it can no longer run. History and evidence are kept.
          </p>
          <ConfirmAction
            action={detachRunbookAction.bind(null, serviceId, binding.id)}
            title={`Detach ${binding.runbook.name}?`}
            description="This rule will be archived and disabled. Pending suggestions cannot be started. Suggestion history, configuration and execution links are retained."
            label="Detach Runbook"
            successMessage="Rule detached"
          />
        </div>
      </SheetGroup>
    </RuleSheet>
  );
}
