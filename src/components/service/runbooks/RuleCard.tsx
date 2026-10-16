'use client';

import Link from 'next/link';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  Play,
  Settings2,
  Shield,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import {
  ActionForm,
  ConfigureSheet,
  ConfirmAction,
  FormSelect,
  SubmitButton,
} from '@/components/runbooks/RunbookControls';
import RunbookSelectorBuilder from '@/components/runbooks/RunbookSelectorBuilder';
import AutomaticTargetGuard from '@/components/runbooks/AutomaticTargetGuard';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import Field from '@/components/runbooks/RunbookField';
import {
  checkRulePolicyAction,
  configureRunbookTriggerAction,
  detachRunbookAction,
  duplicateRuleAction,
  pauseRuleAction,
  updateRunbookBindingAction,
} from '@/app/(app)/services/[id]/runbook-actions';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import {
  describeBinding,
  type RunbookResource,
} from '@/lib/runbooks/presentation/binding-contract';
import RunbookBindingVersionInputs from '../RunbookBindingVersionInputs';
import { InputSummary, TriggerConditionRow, hasAgentWrites } from './rule-fields';
import type {
  AvailableRunbook,
  ServiceRunbookAgent,
  ServiceRunbookAgentPool,
  ServiceRunbookBinding,
} from '../ServiceRunbooks';

const MODE_STYLES = {
  AUTOMATIC: {
    label: 'Automatic',
    icon: Zap,
    accent: 'before:bg-indigo-500',
    badge: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  },
  SUGGESTED: {
    label: 'Suggested',
    icon: Sparkles,
    accent: 'before:bg-amber-500',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  MANUAL: {
    label: 'Manual',
    icon: Play,
    accent: 'before:bg-sky-500',
    badge: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
} as const;

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
    <Card className="border-dashed bg-muted/20">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{binding.name || binding.runbook.name}</CardTitle>
          <Badge variant="outline">Archived</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>Rule detached · Archived history</p>
        <p className="text-muted-foreground">
          This rule cannot execute. Its configuration, suggestions and execution evidence are
          retained.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/services/${serviceId}/automations/${binding.id}`}>
            View archived rule evidence
          </Link>
        </Button>
      </CardContent>
    </Card>
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
}: {
  serviceId: string;
  binding: ServiceRunbookBinding;
  availableRunbooks: AvailableRunbook[];
  availableAgents: ServiceRunbookAgent[];
  availableAgentPools: ServiceRunbookAgentPool[];
  canManage: boolean;
  configurationAvailable: boolean;
  loadErrors: RunbookResource[];
}) {
  const presentation =
    binding.presentation ??
    describeBinding(binding, availableAgents, availableAgentPools, loadErrors);
  const lastExecution = binding.executions?.[0];
  const mode = MODE_STYLES[binding.mode as keyof typeof MODE_STYLES] ?? MODE_STYLES.MANUAL;
  const ModeIcon = mode.icon;
  const rulePath = `/services/${serviceId}/automations/${binding.id}`;
  const blocked = binding.readiness?.checks.filter(check => check.state === 'blocked') ?? [];
  const executionCount = binding._count?.executions ?? binding.executions?.length ?? 0;

  return (
    <Card
      className={cn(
        'group relative overflow-hidden border-border/80 transition-shadow hover:shadow-sm',
        'before:absolute before:inset-y-0 before:left-0 before:w-1',
        binding.enabled ? mode.accent : 'before:bg-muted-foreground/30'
      )}
    >
      <CardHeader className="space-y-3 pb-3 pl-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base font-semibold">
              <Link
                href={rulePath}
                className="break-words text-foreground underline-offset-4 hover:text-primary hover:underline"
              >
                {binding.name || binding.runbook.name}
              </Link>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Runs <span className="font-medium text-foreground/80">{binding.runbook.name}</span>
              {binding.runbook.description ? ` · ${binding.runbook.description}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn('gap-1 text-[11px] font-medium', binding.enabled && mode.badge)}
            >
              {binding.enabled ? (
                <>
                  <ModeIcon className="h-3 w-3" aria-hidden /> {mode.label}
                </>
              ) : (
                'Paused'
              )}
            </Badge>
            <Badge variant="outline" className="gap-1 text-[11px] font-medium">
              {binding.versionStrategy === 'PINNED' ? (
                <>
                  <Shield className="h-3 w-3 text-muted-foreground" aria-hidden />v
                  {binding.runbookVersion?.version ?? '?'} pinned
                </>
              ) : (
                'Latest published'
              )}
            </Badge>
          </div>
        </div>
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <Target className="h-3.5 w-3.5" aria-hidden />
          Target: {presentation.target} · Trigger: {presentation.trigger}
        </p>
      </CardHeader>

      <CardContent className="space-y-4 pl-6 pt-0">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/20 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Last run
            </p>
            {lastExecution ? (
              <Link
                href={`/runbooks/executions/${lastExecution.id}`}
                className="mt-1 flex flex-wrap items-center gap-2 text-sm hover:underline"
              >
                <RunbookStatusBadge status={lastExecution.status} />
                <span className="text-xs text-muted-foreground">
                  {relative(lastExecution.createdAt)}
                </span>
              </Link>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Never run</p>
            )}
          </div>
          <div className="rounded-lg border bg-muted/20 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Executions
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {executionCount}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/20 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Readiness
            </p>
            {binding.readiness ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm">
                {binding.readiness.state === 'BLOCKED' ? (
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                )}
                {binding.readiness.state.replaceAll('_', ' ').toLowerCase()}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Not checked</p>
            )}
          </div>
        </div>

        {!binding.readiness && (
          <p className="text-xs text-muted-foreground">
            {binding.enabled
              ? 'Target and policy readiness not assessed. Open Rule evidence or check this page.'
              : 'Rule paused · Target checks not run.'}
          </p>
        )}
        {binding.readiness && (
          <section
            aria-label="Rule readiness"
            className={cn(
              'space-y-2 rounded-lg border p-3 text-xs',
              binding.readiness.state === 'BLOCKED' && 'border-destructive/40 bg-destructive/5'
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={binding.readiness.state === 'BLOCKED' ? 'danger' : 'outline'}>
                {binding.readiness.state.replaceAll('_', ' ')}
              </Badge>
              <span>
                {binding.readiness.eligibleAgents === null
                  ? binding.readiness.state === 'PAUSED'
                    ? 'Target checks paused'
                    : binding.readiness.checks.some(
                          check => check.code === 'INCIDENT_CONTEXT_REQUIRED'
                        )
                      ? 'Target requires incident context'
                      : 'Target check unavailable'
                  : `${binding.readiness.eligibleAgents} matching online Agents`}{' '}
                · checked {new Date(binding.readiness.checkedAt).toLocaleTimeString()}
              </span>
            </div>
            {blocked.slice(0, 3).map(check => (
              <p key={check.code} className="flex items-start gap-1.5">
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

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {binding.enabled && (
            <Button asChild size="sm" className="h-8 gap-1.5">
              <Link href={`${rulePath}#checks`}>
                <Play className="h-3.5 w-3.5" aria-hidden />
                Run now
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href={rulePath}>Rule evidence</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-8 gap-1.5">
            <Link href={`/runbooks/${binding.runbookId}`}>
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              <span>View Runbook</span>
            </Link>
          </Button>
          {canManage && configurationAvailable && (
            <RuleConfigureSheet
              serviceId={serviceId}
              binding={binding}
              availableRunbooks={availableRunbooks}
              availableAgents={availableAgents}
              availableAgentPools={availableAgentPools}
            />
          )}
        </div>

        <details className="group/manage rounded-lg border bg-muted/10 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-medium">
            Manage rule
            <ChevronDown
              className="h-4 w-4 text-muted-foreground transition-transform group-open/manage:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="space-y-4 border-t p-3">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Inputs
              </h4>
              <InputSummary
                definitions={
                  binding.runbookVersion?.inputs ?? binding.runbook.publishedVersion?.inputs ?? []
                }
                values={binding.inputValues as Record<string, unknown>}
              />
            </div>
            {canManage && (
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
                {binding.enabled && (
                  <ConfirmAction
                    action={pauseRuleAction.bind(null, serviceId, binding.id)}
                    label="Pause rule"
                    title="Pause this automation rule?"
                    description="This stops future triggering. Existing executions retain their own cancellation and approval controls."
                    successMessage="Rule paused"
                  />
                )}
                <ActionForm
                  action={duplicateRuleAction.bind(null, serviceId, binding.id)}
                  successMessage="Paused copy created"
                >
                  <SubmitButton variant="outline" size="sm">
                    Duplicate paused rule
                  </SubmitButton>
                </ActionForm>
              </div>
            )}
            {canManage && configurationAvailable && (
              <p className="text-xs text-muted-foreground">
                Agent policy checks compare this frozen configuration with each Agent&apos;s local
                policy. They do not run a step or verify target-side permissions.
              </p>
            )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function RuleConfigureSheet({
  serviceId,
  binding,
  availableRunbooks,
  availableAgents,
  availableAgentPools,
}: {
  serviceId: string;
  binding: ServiceRunbookBinding;
  availableRunbooks: AvailableRunbook[];
  availableAgents: ServiceRunbookAgent[];
  availableAgentPools: ServiceRunbookAgentPool[];
}) {
  return (
    <ConfigureSheet
      title={`Configure ${binding.runbook.name}`}
      description="Review version, inputs, target and trigger policy before saving."
      trigger={
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
          <span>Configure</span>
        </Button>
      }
    >
      {binding.mode === 'AUTOMATIC' && (
        <div
          role="note"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          Saving configuration or trigger conditions pauses this Automatic rule immediately.{' '}
          <Link className="underline" href={`/services/${serviceId}/automations/${binding.id}`}>
            Recheck policy and reactivate from Rule evidence
          </Link>{' '}
          after every save. Suggestions and execution history are retained.
        </div>
      )}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Version, target and inputs</h3>
        <ActionForm
          key={`configuration-${binding.id}`}
          action={updateRunbookBindingAction.bind(null, serviceId, binding.id)}
          className="grid gap-3 rounded-lg border p-4 lg:grid-cols-4"
          successMessage="Rule configuration saved"
        >
          <div key={binding.configurationRevision} className="contents">
            <input
              type="hidden"
              name="expectedConfigurationRevision"
              value={binding.configurationRevision}
            />
            <RunbookBindingVersionInputs
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
            />
            <RunbookSelectorBuilder initialValue={binding.agentSelector} />
            <AutomaticTargetGuard />
            <Field label="Rule name">
              <Input name="ruleName" defaultValue={binding.name ?? ''} maxLength={200} />
            </Field>
            <Field label="Status">
              <FormSelect
                name="enabled"
                label="Binding status"
                defaultValue={String(binding.enabled)}
                options={[
                  { value: 'true', label: 'Enabled' },
                  { value: 'false', label: 'Disabled' },
                ]}
              />
            </Field>
            <div className="order-2 flex gap-2 lg:col-span-4">
              <SubmitButton>
                <Settings2 className="h-3.5 w-3.5" aria-hidden />
                {binding.mode === 'AUTOMATIC' ? 'Save and pause Automatic rule' : 'Save binding'}
              </SubmitButton>
            </div>
          </div>
        </ActionForm>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Trigger</h3>
        <ActionForm
          key={`trigger-${binding.id}`}
          action={configureRunbookTriggerAction.bind(null, serviceId, binding.id)}
          className="grid gap-3 rounded-lg border p-4 lg:grid-cols-3"
        >
          <div key={binding.configurationRevision} className="contents">
            <input
              type="hidden"
              name="expectedConfigurationRevision"
              value={binding.configurationRevision}
            />
            <Field label="Trigger event">
              <FormSelect
                name="event"
                label="Trigger event"
                defaultValue="INCIDENT_CREATED"
                options={[{ value: 'INCIDENT_CREATED', label: 'Incident created' }]}
              />
            </Field>
            <Field label="Condition logic">
              <FormSelect
                name="conditionLogic"
                label="Condition logic"
                defaultValue={binding.triggers?.[0]?.conditionLogic ?? 'AND'}
                options={[
                  { value: 'AND', label: 'Match all' },
                  { value: 'OR', label: 'Match any' },
                ]}
              />
            </Field>
            <div className="flex items-end">
              <SubmitButton variant="outline" pendingLabel="Saving trigger…">
                {binding.mode === 'AUTOMATIC' ? 'Save trigger and pause Automatic rule' : 'Save trigger'}
              </SubmitButton>
            </div>
            <div className="space-y-3 lg:col-span-3">
              <Label>Conditions</Label>
              {(binding.triggers?.[0]?.conditions ?? []).map(condition => (
                <TriggerConditionRow
                  key={condition.id}
                  field={condition.field}
                  operator={condition.operator}
                  value={condition.value}
                />
              ))}
              <TriggerConditionRow />
              <p className="text-xs text-muted-foreground">
                Leave the final field empty to add no condition. Comma-separate values for “is one
                of” operators. Automatic mode still stops at approval gates.
              </p>
            </div>
          </div>
        </ActionForm>
      </section>

      <section className="space-y-2 rounded-lg border border-destructive/30 p-4">
        <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
        <p className="text-xs text-muted-foreground">
          Detaching archives the rule. History and evidence are kept.
        </p>
        <ConfirmAction
          action={detachRunbookAction.bind(null, serviceId, binding.id)}
          title={`Detach ${binding.runbook.name}?`}
          description="This rule will be archived and disabled. Pending suggestions cannot be started. Suggestion history, configuration and execution links are retained."
          label="Detach Runbook"
          successMessage="Rule detached"
        />
      </section>
    </ConfigureSheet>
  );
}
