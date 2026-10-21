import Link from 'next/link';
import type { ReactNode } from 'react';
import ExecutionTroubleshooting from '@/components/runbooks/executions/ExecutionTroubleshooting';
import { resolvedApprovalPlan } from '@/components/runbooks/executions/approval-plan';
import { StepStatusIcon, stepTone } from '@/components/runbooks/executions/StepStatusIcon';
import RunbookExecutionPreview from '@/components/runbooks/RunbookExecutionPreview';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import {
  EmptyHint,
  Pill,
  SectionCard,
  TONE_SURFACE,
  type Tone,
} from '@/components/runbooks/ui/primitives';
import {
  AlertTriangle,
  ChevronRight,
  Download,
  ExternalLink,
  History,
  Lightbulb,
  ShieldAlert,
  ShieldCheck,
  Workflow,
  Wrench,
} from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCanViewIncident, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { computePlanDigest, flattenSteps, parseRunbookDefinition } from '@/lib/runbooks/definition';
import { Button } from '@/components/ui/shadcn/button';
import { compareEvidence, verificationResultSchema } from '@/lib/runbooks/evidence';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import {
  parseRecoveryOutcome,
  recoveryOutcomePresentation,
  summarizeExecutionTarget,
  summarizeExecutionVerification,
  toneChipClass,
  verificationStatePresentation,
  type ResponseTone,
} from '@/lib/incidents/response-presentation';
import { ActionForm, ConfirmAction, SubmitButton } from '@/components/runbooks/RunbookControls';
import AdhocRunbookLauncher from './runbooks/AdhocRunbookLauncher';
import AutomationSafetyMeter from './runbooks/AutomationSafetyMeter';
import IncidentRunbookRefreshButton from './runbooks/IncidentRunbookRefreshButton';
import {
  approveIncidentRunbookStepAction,
  cancelIncidentRunbookAction,
  dismissIncidentRunbookSuggestionAction,
  previewIncidentRunbookAction,
  executePreviewedIncidentRunbookAction,
} from './runbook-actions';

export default async function IncidentRunbooks({
  incidentId,
  serviceId,
}: {
  incidentId: string;
  serviceId: string;
}) {
  const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUser()]);
  const userTimeZone = getUserTimeZone(user);
  if (
    !permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_ALL) &&
    !permissions.capabilities.includes(CAPABILITIES.RUNBOOK_READ_SCOPED)
  )
    return null;
  await assertCanViewIncident(incidentId);
  const [bindings, executions, suggestions, incidentRecord] = await Promise.all([
    prisma.serviceAutomationRule.findMany({
      where: { serviceId, enabled: true, detachedAt: null },
      include: { runbook: true, runbookVersion: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.runbookExecution.findMany({
      where: { incidentId },
      include: {
        runbook: true,
        runbookVersion: true,
        binding: true,
        resolvedTargetAgent: { select: { name: true, hostname: true } },
        resolvedTargetAgentPool: { select: { name: true } },
        steps: {
          orderBy: { sequence: 'asc' },
          include: { attempts: { orderBy: { attemptNumber: 'desc' }, take: 1 } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.runbookSuggestion.findMany({
      where: {
        incidentId,
        state: 'SUGGESTED',
        binding: {
          runbook: { archivedAt: null },
        },
      },
      include: {
        binding: { include: { runbook: true } },
        runbookVersion: { select: { version: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.incident.findUnique({
      where: { id: incidentId },
      select: { status: true },
    }),
  ]);
  const isIncidentOpen = incidentRecord ? incidentRecord.status !== 'RESOLVED' : true;
  const canExecute = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_EXECUTE);
  const [budget, usedWrites, usedExecutions, usedNonIdempotent] = await Promise.all([
    prisma.systemSettings.findUnique({
      where: { id: 'default' },
      select: {
        runbookAutoExecutionsPerIncident: true,
        runbookAutoWritesPerIncident: true,
        runbookAutoNonIdempotentPerIncident: true,
      },
    }),
    prisma.runbookExecutionStep.count({
      where: {
        execution: { incidentId, triggeredByUserId: null },
        riskClass: { in: ['IDEMPOTENT_WRITE', 'NON_IDEMPOTENT'] },
      },
    }),
    prisma.runbookExecution.count({ where: { incidentId, triggeredByUserId: null } }),
    prisma.runbookExecutionStep.count({
      where: { execution: { incidentId, triggeredByUserId: null }, riskClass: 'NON_IDEMPOTENT' },
    }),
  ]);
  const canApprove = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_APPROVE);
  const canViewSensitive = permissions.capabilities.includes(CAPABILITIES.INCIDENT_SENSITIVE_READ);
  const isTerminal = (status: string) => TERMINAL_STATUSES.includes(status);
  const orderedExecutions = [...executions].sort(
    (a, b) => Number(isTerminal(a.status)) - Number(isTerminal(b.status))
  );
  const activeCount = executions.filter(execution => !isTerminal(execution.status)).length;
  const nothingYet = bindings.length === 0 && executions.length === 0 && suggestions.length === 0;
  const budgets = [
    {
      label: 'Automatic runs',
      used: usedExecutions,
      limit: budget?.runbookAutoExecutionsPerIncident ?? 3,
    },
    {
      label: 'Automatic writes',
      used: usedWrites,
      limit: budget?.runbookAutoWritesPerIncident ?? 3,
    },
    {
      label: 'Non-idempotent actions',
      used: usedNonIdempotent,
      limit: budget?.runbookAutoNonIdempotentPerIncident ?? 0,
    },
  ];
  const budgetExhausted = budgets.some(item => item.limit > 0 && item.used >= item.limit);
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-4 sm:p-5 shadow-xs transition-colors">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-3.5 border-b border-border/60">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className={cn(
                'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-2xs',
                budgetExhausted
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'border-primary/20 bg-primary/10 text-primary'
              )}
            >
              {budgetExhausted ? (
                <ShieldAlert className="h-4 w-4" aria-hidden />
              ) : (
                <ShieldCheck className="h-4 w-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold tracking-tight text-foreground">
                  Automation Safety & Remediation Budgets
                </h3>
                <Pill tone={budgetExhausted ? 'warning' : 'success'}>
                  {budgetExhausted ? 'Budget exhausted' : 'Safeguards active'}
                </Pill>
              </div>
              <p
                className={cn(
                  'mt-0.5 text-xs leading-relaxed',
                  budgetExhausted
                    ? 'text-amber-700 dark:text-amber-300 font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {budgetExhausted
                  ? 'An automated budget is used up. Further remediation steps require manual responder initiation.'
                  : 'Enforced limits for unattended automations on this incident. Manual responder executions are unrestricted.'}
              </p>
            </div>
          </div>
          {canExecute && (
            <div className="w-full sm:w-auto shrink-0 flex items-center gap-2">
              <AdhocRunbookLauncher incidentId={incidentId} />
            </div>
          )}
        </div>
        <div className="pt-3.5">
          <AutomationSafetyMeter items={budgets} />
        </div>
      </div>
      {nothingYet && (
        <EmptyHint
          icon={Wrench}
          title="No incident runbooks"
          description={
            canExecute
              ? 'Nothing is suggested or attached to this incident’s service yet. Use “Run another runbook” to run any published runbook, or attach workflows to the service.'
              : 'Attach published workflows to this incident’s service to offer diagnostics and recovery.'
          }
          className="bg-card"
        />
      )}
      {!nothingYet && (
        <SectionCard
          id="incident-runbooks-suggested"
          icon={Lightbulb}
          title="Suggested Workflows"
          description="Matched to this incident by configured diagnostic and recovery triggers."
          actions={
            <Pill tone={suggestions.length > 0 ? 'brand' : 'neutral'}>{suggestions.length}</Pill>
          }
          bodyClassName="space-y-3 p-4 sm:p-5"
        >
          {suggestions.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              <Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
              <span>
                No trigger has suggested a workflow for this incident. You can preview available
                service workflows below or launch an ad-hoc runbook.
              </span>
            </div>
          ) : (
            suggestions.map(suggestion => (
              <div
                key={suggestion.id}
                id={`runbook-suggestion-${suggestion.id}`}
                className="scroll-mt-24 rounded-xl border border-border/80 dark:border-border/60 bg-card/70 hover:bg-card hover:border-border transition-all p-3.5 sm:p-4 shadow-2xs"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                        <Lightbulb className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <p className="truncate text-sm font-semibold tracking-tight text-foreground">
                        {suggestion.binding.runbook.name}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-9 text-xs text-muted-foreground">
                      <Pill tone="brand">Version {suggestion.runbookVersion.version}</Pill>
                      {suggestion.binding.detachedAt ? (
                        <Pill tone="warning">Rule detached</Pill>
                      ) : !suggestion.binding.enabled ? (
                        <Pill tone="warning">Rule paused</Pill>
                      ) : (
                        <Pill tone="success">Active trigger match</Pill>
                      )}
                    </div>
                  </div>
                  {canExecute && (
                    <div className="flex items-center gap-2 shrink-0 pl-9 sm:pl-0">
                      <ActionForm
                        action={dismissIncidentRunbookSuggestionAction.bind(
                          null,
                          incidentId,
                          suggestion.id
                        )}
                        successMessage="Suggestion dismissed"
                      >
                        <SubmitButton
                          pendingLabel="Dismissing…"
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Dismiss
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </div>
                {canExecute && (
                  <div className="mt-3 sm:ml-9 pt-2.5 border-t border-border/40">
                    {suggestion.planSnapshot ? (
                      <RunbookExecutionPreview
                        disabled={
                          Boolean(suggestion.binding.detachedAt) || !suggestion.binding.enabled
                        }
                        previewAction={previewIncidentRunbookAction.bind(
                          null,
                          incidentId,
                          suggestion.bindingId,
                          suggestion.id
                        )}
                        executeAction={executePreviewedIncidentRunbookAction.bind(
                          null,
                          incidentId,
                          suggestion.bindingId,
                          suggestion.id
                        )}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Generate a new suggestion to freeze its plan.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </SectionCard>
      )}
      {!nothingYet && (
        <SectionCard
          id="incident-runbooks-service"
          icon={Workflow}
          title="Available for this service"
          description="Workflows attached to this service, with their reviewed inputs and target."
          actions={<Pill>{bindings.length}</Pill>}
          bodyClassName="space-y-3 p-4 sm:p-5"
        >
          {bindings.length === 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              <Workflow className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
              <span>
                No enabled service workflows attached.
                {canExecute ? ' Use “Run another runbook” above to run any published runbook.' : ''}
              </span>
            </div>
          )}
          {bindings.map(binding => (
            <div
              key={binding.id}
              className="rounded-xl border border-border/80 dark:border-border/60 bg-card/70 hover:bg-card hover:border-border transition-all p-3.5 sm:p-4 shadow-2xs"
            >
              {canExecute ? (
                <RunbookExecutionPreview
                  headerContent={
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                          <Workflow className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <h4 className="text-sm font-semibold text-foreground tracking-tight truncate">
                          {binding.runbook.name}
                        </h4>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pl-9.5 text-xs text-muted-foreground">
                        <Pill
                          tone={
                            binding.mode === 'AUTOMATIC'
                              ? 'brand'
                              : binding.mode === 'SUGGESTED'
                                ? 'info'
                                : 'neutral'
                          }
                        >
                          {binding.mode.replaceAll('_', ' ').toLowerCase()}
                        </Pill>
                        <span className="font-mono text-[11px] bg-muted/60 text-muted-foreground px-2 py-0.5 rounded border border-border/50">
                          {binding.versionStrategy === 'PINNED'
                            ? `Pinned v${binding.runbookVersion?.version ?? ''}`
                            : 'Latest published'}
                        </span>
                        {binding.runbook.description && (
                          <span className="truncate max-w-sm hidden lg:inline text-muted-foreground/80">
                            · {binding.runbook.description}
                          </span>
                        )}
                      </div>
                    </div>
                  }
                  previewAction={previewIncidentRunbookAction.bind(
                    null,
                    incidentId,
                    binding.id,
                    undefined
                  )}
                  executeAction={executePreviewedIncidentRunbookAction.bind(
                    null,
                    incidentId,
                    binding.id,
                    undefined
                  )}
                />
              ) : (
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                      <Workflow className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <h4 className="text-sm font-semibold text-foreground tracking-tight truncate">
                      {binding.runbook.name}
                    </h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-9.5 text-xs text-muted-foreground">
                    <Pill>{binding.mode.replaceAll('_', ' ').toLowerCase()}</Pill>
                    <span className="font-mono text-[11px] bg-muted/60 text-muted-foreground px-2 py-0.5 rounded border border-border/50">
                      {binding.versionStrategy === 'PINNED'
                        ? `Pinned to v${binding.runbookVersion?.version ?? ''}`
                        : 'Latest published'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </SectionCard>
      )}
      {!nothingYet && (
        <SectionCard
          id="incident-runbooks-history"
          icon={History}
          title="Running & history"
          description={
            activeCount > 0
              ? `${activeCount} in progress. Review, approve or cancel steps in real time.`
              : 'Recent runbook executions recorded for this incident.'
          }
          actions={
            <div className="flex items-center gap-2">
              <IncidentRunbookRefreshButton
                hasActiveExecutions={activeCount > 0}
                isIncidentOpen={isIncidentOpen}
              />
              <Pill tone={activeCount > 0 ? 'info' : 'neutral'}>{executions.length}</Pill>
            </div>
          }
          bodyClassName="space-y-4 p-4 sm:p-5"
        >
          {executions.length === 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              <History className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
              <span>No runbook has executed for this incident yet.</span>
            </div>
          )}
          {orderedExecutions.map(execution => {
            const doneSteps = execution.steps.filter(step =>
              ['SUCCEEDED', 'SKIPPED'].includes(step.status)
            ).length;
            const totalSteps = execution.steps.length;
            const terminal = isTerminal(execution.status);
            const failed = execution.status === 'FAILED' || execution.status === 'TIMED_OUT';
            const waiting = execution.steps.some(step => step.status === 'WAITING_APPROVAL');
            return (
              <article
                key={execution.id}
                id={`runbook-execution-${execution.id}`}
                aria-label={execution.runbook.name}
                className={cn(
                  'scroll-mt-24 rounded-xl border bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs overflow-hidden transition-all',
                  waiting && 'border-amber-500/50 ring-1 ring-amber-500/20',
                  failed && 'border-rose-500/40 ring-1 ring-rose-500/20',
                  !waiting && !failed && terminal && 'border-border/80 hover:border-border',
                  !terminal && !waiting && !failed && 'border-blue-500/40 ring-1 ring-blue-500/20'
                )}
              >
                <header className="space-y-3 p-4 sm:p-5 pb-3.5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/runbooks/executions/${execution.id}`}
                          className="text-sm font-bold tracking-tight text-foreground hover:text-primary hover:underline"
                        >
                          {execution.runbook.name}
                        </Link>
                        <span className="font-mono text-[11px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded border border-border/50">
                          v{execution.runbookVersion.version}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>
                          Started{' '}
                          {formatDateTime(execution.createdAt, userTimeZone, {
                            format: 'datetime',
                            includeTimeZone: true,
                          })}
                        </span>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-foreground/80 font-medium">
                          {execution.binding ? execution.binding.name : 'Ad-hoc run'}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <RunbookStatusBadge status={execution.status} context="execution" />
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Link href={`/runbooks/executions/${execution.id}`}>
                          View details <ExternalLink className="h-3 w-3" aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  </div>

                  {totalSteps > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="tabular-nums font-medium text-foreground/80">
                          {doneSteps} of {totalSteps} {totalSteps === 1 ? 'step' : 'steps'} complete
                        </span>
                        <span className="font-mono tabular-nums text-[11px]">
                          {Math.round((doneSteps / totalSteps) * 100)}%
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`${execution.runbook.name} progress`}
                        aria-valuemin={0}
                        aria-valuemax={totalSteps}
                        aria-valuenow={doneSteps}
                        className="h-1.5 overflow-hidden rounded-full bg-muted/70"
                      >
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-300',
                            failed
                              ? 'bg-rose-500'
                              : waiting
                                ? 'bg-amber-500'
                                : terminal
                                  ? 'bg-emerald-500'
                                  : 'bg-primary'
                          )}
                          style={{ width: `${Math.round((doneSteps / totalSteps) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <ExecutionTroubleshooting
                    status={execution.status}
                    code={execution.failureCode}
                  />
                </header>
                <div className="space-y-4 border-t border-border/60 bg-muted/10 px-4 sm:px-5 py-3.5">
                  <ExecutionResponseSummary
                    execution={execution}
                    canViewSensitive={canViewSensitive}
                    userTimeZone={userTimeZone}
                  />
                  <details open={!terminal} className="group">
                    <summary className="flex w-fit cursor-pointer select-none list-none items-center gap-2 rounded-md py-1 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      <ChevronRight
                        className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90"
                        aria-hidden
                      />
                      <span>Execution Timeline</span>
                      <span className="font-mono text-[10px] bg-muted/80 text-muted-foreground px-1.5 py-0.5 rounded border border-border/50">
                        {totalSteps} {totalSteps === 1 ? 'step' : 'steps'}
                      </span>
                    </summary>

                    <ol
                      aria-label={`${execution.runbook.name} execution timeline`}
                      className="mt-3.5 relative"
                    >
                      {execution.steps.map((step, stepIndex) => {
                        const digest = computePlanDigest({
                          stepKey: step.stepKey,
                          stepType: step.type,
                          riskClass: step.riskClass,
                          config: step.config as Record<string, unknown>,
                          agentPoolId: execution.resolvedTargetAgentPoolId ?? undefined,
                          agentId: execution.resolvedTargetAgentId ?? undefined,
                          inputValues: execution.inputValues as Record<string, unknown>,
                          versionChecksum: execution.definitionChecksum,
                        });
                        const approvalPlan = resolvedApprovalPlan(
                          step.type,
                          step.config as Record<string, unknown>,
                          execution.inputValues as Record<string, unknown>
                        );
                        const evidence = compareEvidence(
                          step.attempts[0]?.preState,
                          step.attempts[0]?.postState
                        );
                        const authored = flattenSteps(
                          parseRunbookDefinition(execution.runbookVersion.definition)
                        ).find(item => item.key === step.stepKey);
                        const verificationKeys = authored?.verification
                          ? flattenSteps({ steps: authored.verification.steps }).map(
                              item => item.key
                            )
                          : [];
                        const result = verificationResultSchema.safeParse(step.verificationResult);
                        const differences = result.success
                          ? result.data.differences
                          : evidence.differences;
                        const verified =
                          result.success &&
                          result.data.verified &&
                          execution.status === 'SUCCEEDED' &&
                          step.status === 'SUCCEEDED' &&
                          verificationKeys.length > 0 &&
                          verificationKeys.every(key =>
                            execution.steps.some(
                              item => item.stepKey === key && item.status === 'SUCCEEDED'
                            )
                          );
                        const tone = stepTone(step.status);
                        const lastStep = stepIndex === execution.steps.length - 1;
                        const approvalTarget = execution.resolvedTargetAgent
                          ? `${execution.resolvedTargetAgent.name}${execution.resolvedTargetAgent.hostname ? ` (${execution.resolvedTargetAgent.hostname})` : ''}`
                          : execution.resolvedTargetAgentPool
                            ? `Pool: ${execution.resolvedTargetAgentPool.name}`
                            : 'OpsKnight control plane';
                        const actionSummary = formatStepActionSummary(step.type, step.config);
                        return (
                          <li
                            key={step.id}
                            className="relative flex items-start gap-3.5 pb-5 last:pb-0"
                          >
                            {/* Vertical connector line */}
                            {!lastStep && (
                              <div
                                aria-hidden="true"
                                className={cn(
                                  'absolute left-[11px] top-7 bottom-0 w-0.5 rounded-full',
                                  tone === 'success' ? 'bg-emerald-500/40' : 'bg-border/80'
                                )}
                              />
                            )}

                            {/* Status Icon */}
                            <div className="relative z-10 shrink-0 mt-0.5">
                              <span
                                aria-hidden="true"
                                className={cn(
                                  'flex h-6 w-6 items-center justify-center rounded-full ring-1 ring-inset shadow-2xs',
                                  // eslint-disable-next-line security/detect-object-injection -- tone is a typed enum of known tokens
                                  TONE_SURFACE[tone]
                                )}
                              >
                                <StepStatusIcon status={step.status} className="h-3.5 w-3.5" />
                              </span>
                            </div>

                            {/* Step Content */}
                            <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-semibold text-foreground tracking-tight">
                                  {step.name}
                                </span>
                                {verified && (
                                  <Pill tone="success" icon={ShieldCheck}>
                                    Verified recovery
                                  </Pill>
                                )}
                                <Pill tone={RISK_TONE[step.riskClass] ?? 'neutral'}>
                                  {step.riskClass.replaceAll('_', ' ')}
                                </Pill>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                <span
                                  className={cn(
                                    'font-semibold text-[11px] uppercase tracking-wider',
                                    step.status === 'SUCCEEDED'
                                      ? 'text-emerald-700 dark:text-emerald-400'
                                      : step.status === 'FAILED'
                                        ? 'text-rose-700 dark:text-rose-400'
                                        : step.status === 'WAITING_APPROVAL'
                                          ? 'text-amber-700 dark:text-amber-400'
                                          : 'text-muted-foreground'
                                  )}
                                >
                                  {step.status.replaceAll('_', ' ')}
                                </span>
                                {actionSummary && (
                                  <>
                                    <span className="text-muted-foreground/40">·</span>
                                    <span className="font-mono text-[11px] bg-muted/70 text-foreground/80 px-2 py-0.5 rounded border border-border/60">
                                      {actionSummary}
                                    </span>
                                  </>
                                )}
                                {step.timeoutSeconds && (
                                  <>
                                    <span className="text-muted-foreground/40">·</span>
                                    <span className="tabular-nums text-[11px]">
                                      {step.timeoutSeconds}s timeout
                                    </span>
                                  </>
                                )}
                              </div>

                              {step.outputPreview && (
                                <div className="mt-2 rounded-lg bg-zinc-950 p-2.5 font-mono text-[11px] text-zinc-300 break-all border border-zinc-800 shadow-inner">
                                  <div className="text-[10px] text-zinc-500 select-none pb-1 font-sans font-medium">
                                    Standard Output Preview
                                  </div>
                                  {step.outputPreview.slice(0, 300)}
                                </div>
                              )}

                              {step.attempts[0]?.preState && step.attempts[0]?.postState && (
                                <details className="mt-2 rounded-xl border border-border/70 bg-card/80 text-xs overflow-hidden shadow-2xs group/evidence">
                                  <summary className="flex cursor-pointer select-none items-center justify-between px-3.5 py-2 font-medium hover:bg-muted/30 transition-colors">
                                    <span className="flex items-center gap-2">
                                      <ChevronRight
                                        className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open/evidence:rotate-90"
                                        aria-hidden
                                      />
                                      <span className="font-semibold text-foreground/90">
                                        Recovery evidence
                                      </span>
                                      <span className="text-[11px] font-normal text-muted-foreground">
                                        ({differences.length}{' '}
                                        {differences.length === 1
                                          ? 'metric changed'
                                          : 'metrics changed'}
                                        )
                                      </span>
                                    </span>
                                    <span
                                      className={cn(
                                        'text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border',
                                        verified
                                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                          : 'bg-muted text-muted-foreground border-border/60'
                                      )}
                                    >
                                      {verified ? '✓ Verified' : 'Not verified'}
                                    </span>
                                  </summary>
                                  <div className="border-t border-border/60 bg-muted/15 p-3 space-y-2">
                                    {differences.length > 0 ? (
                                      <ul className="space-y-1.5 font-mono text-[11px]">
                                        {differences.map(change => {
                                          const formatted = formatEvidenceDifference(change);
                                          return (
                                            <li
                                              key={change.field}
                                              className="flex flex-col sm:flex-row sm:items-baseline gap-1 break-words rounded-lg bg-background/90 px-3 py-2 border border-border/50"
                                            >
                                              <span className="font-semibold text-foreground/90 shrink-0">
                                                {formatted.label}:
                                              </span>
                                              <span className="text-muted-foreground">
                                                {formatted.display}
                                              </span>
                                            </li>
                                          );
                                        })}
                                      </ul>
                                    ) : (
                                      <p className="text-xs text-muted-foreground italic">
                                        No metric deviations between pre-state and post-state
                                        snapshots.
                                      </p>
                                    )}
                                  </div>
                                </details>
                              )}

                              {step.outputArtifactId &&
                                permissions.capabilities.includes(
                                  CAPABILITIES.RUNBOOK_ARTIFACT_DOWNLOAD
                                ) && (
                                  <Link
                                    href={`/api/runbook-artifacts/${step.outputArtifactId}`}
                                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                                  >
                                    <Download className="h-3.5 w-3.5" aria-hidden /> Download full
                                    execution artifact
                                  </Link>
                                )}

                              {step.status === 'WAITING_APPROVAL' && (
                                <div className="mt-3.5 space-y-3.5 rounded-xl border border-amber-500/50 bg-amber-500/[0.08] p-4 shadow-xs">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-100">
                                      <span className="relative flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                                      </span>
                                      <ShieldAlert
                                        className="h-4 w-4 text-amber-600 dark:text-amber-400"
                                        aria-hidden
                                      />
                                      Action requires operator approval
                                    </p>
                                    <Pill tone="warning">Awaiting decision</Pill>
                                  </div>
                                  <dl className="grid gap-x-4 gap-y-2 rounded-xl border border-amber-500/30 bg-background/95 p-3.5 text-xs sm:grid-cols-[8.5rem_1fr]">
                                    <dt className="text-muted-foreground font-medium">Action</dt>
                                    <dd className="font-semibold text-foreground">
                                      {step.type.replaceAll('_', ' ')}
                                    </dd>
                                    {approvalPlan.map(([label, value]) => (
                                      <div key={label} className="contents">
                                        <dt className="text-muted-foreground">{label}</dt>
                                        <dd className="break-all font-mono font-medium">{value}</dd>
                                      </div>
                                    ))}
                                    <dt className="text-muted-foreground">Execution target</dt>
                                    <dd className="font-semibold text-foreground">
                                      {approvalTarget}
                                    </dd>
                                    <dt className="text-muted-foreground">Version</dt>
                                    <dd className="font-mono text-muted-foreground">
                                      v{execution.runbookVersion.version} ·{' '}
                                      <span>{execution.definitionChecksum.slice(0, 12)}…</span>
                                    </dd>
                                    <dt className="text-muted-foreground">Timeout</dt>
                                    <dd className="tabular-nums font-medium">
                                      {step.timeoutSeconds ?? 300}s
                                    </dd>
                                  </dl>
                                  {canApprove ? (
                                    <div className="pt-1">
                                      <ConfirmAction
                                        action={approveIncidentRunbookStepAction.bind(
                                          null,
                                          incidentId,
                                          execution.id,
                                          step.id,
                                          digest
                                        )}
                                        title={`Approve ${step.name}?`}
                                        description={`Authorize the exact displayed plan for ${execution.resolvedTargetAgent?.name ?? execution.resolvedTargetAgentPool?.name ?? 'OpsKnight control plane'}. Risk: ${step.riskClass.replaceAll('_', ' ')}. The action may change the target; inspect its resolved parameters before approving.`}
                                        label="Approve exact plan"
                                        variant="default"
                                      />
                                    </div>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">
                                      A user with runbook approval permission must approve this
                                      step.
                                    </p>
                                  )}
                                </div>
                              )}

                              {step.status === 'UNKNOWN' && (
                                <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                                  <AlertTriangle
                                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                                    aria-hidden
                                  />
                                  The action may have executed. Verify the target before retrying.
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </details>

                  {canExecute && !terminal && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 p-3 border border-border/50">
                      <p className="text-xs text-muted-foreground">
                        Stop pending steps. Started writes may finish with an unknown outcome.
                      </p>
                      <ConfirmAction
                        action={cancelIncidentRunbookAction.bind(null, incidentId, execution.id)}
                        title={`Cancel ${execution.runbook.name}?`}
                        description="Pending steps stop and running Agents receive cancellation. A started write may have an unknown outcome; verify the target before retrying."
                        label="Cancel execution"
                        variant="destructive"
                        successMessage="Cancellation requested"
                      />
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </SectionCard>
      )}
    </div>
  );
}

const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];

const RISK_TONE: Record<string, Tone> = {
  READ_ONLY: 'success',
  IDEMPOTENT_WRITE: 'warning',
  NON_IDEMPOTENT: 'danger',
};

function ToneChip({ tone, children }: { tone: ResponseTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        toneChipClass(tone)
      )}
    >
      {children}
    </span>
  );
}

function ExecutionResponseSummary({
  execution,
  canViewSensitive,
  userTimeZone,
}: {
  execution: {
    status: string;
    runbook: { name: string };
    targetSelection: unknown;
    unattendedWritesAuthorized: boolean;
    recoveryOutcome: string | null;
    recoveryCheckedAt: Date | null;
    resolvedTargetAgent: { name: string; hostname: string | null } | null;
    resolvedTargetAgentPool: { name: string } | null;
    steps: Array<{
      id: string;
      stepKey: string;
      name: string;
      riskClass: string;
      status: string;
      verificationResult: unknown;
    }>;
  };
  canViewSensitive: boolean;
  userTimeZone: string;
}) {
  const target = summarizeExecutionTarget(execution.targetSelection, canViewSensitive);
  const verification = summarizeExecutionVerification(execution.steps);
  const outcome = parseRecoveryOutcome(execution.recoveryOutcome);
  const recommended =
    outcome === 'NOT_REQUESTED' &&
    execution.status === 'SUCCEEDED' &&
    verification.state === 'VERIFIED';
  const recovery = recommended
    ? {
        label: 'Resolution recommended',
        description:
          'Every write action was verified. Automatic resolution is off for this rule, so a responder confirms recovery and resolves the incident.',
        tone: 'success' as const,
      }
    : outcome
      ? recoveryOutcomePresentation(outcome)
      : null;
  const waiting = PENDING_RECOVERY_NOTE.get(execution.status);
  const verificationPresentation = verificationStatePresentation(verification.state);
  return (
    <dl
      aria-label={`${execution.runbook.name} response summary`}
      className="grid gap-x-4 gap-y-2 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-[9rem_1fr]"
    >
      <dt className="text-muted-foreground">Target</dt>
      <dd className="min-w-0 break-words">
        {execution.resolvedTargetAgent
          ? `${execution.resolvedTargetAgent.name}${execution.resolvedTargetAgent.hostname ? ` (${execution.resolvedTargetAgent.hostname})` : ''}`
          : execution.resolvedTargetAgentPool
            ? `Pool: ${execution.resolvedTargetAgentPool.name}`
            : target.implicitLocalHost
              ? 'Local host Agent'
              : 'OpsKnight control plane'}
        {target.labels.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {target.labels.map(label => (
              <span
                key={label.key}
                className="rounded border px-1.5 py-0.5 font-mono text-[11px]"
                title={label.fromContext ? 'Resolved from incident context' : undefined}
              >
                {label.key}={label.value ?? '[restricted]'}
                {label.fromContext ? ' · context' : ''}
              </span>
            ))}
          </span>
        )}
      </dd>
      {target.contextKeys.length > 0 && (
        <>
          <dt className="text-muted-foreground">Context keys</dt>
          <dd className="break-words font-mono">{target.contextKeys.join(', ')}</dd>
        </>
      )}
      {verification.writeActions.length > 0 && (
        <>
          <dt className="text-muted-foreground">Write actions</dt>
          <dd>
            {execution.unattendedWritesAuthorized ? (
              <ToneChip tone="warning">Unattended writes authorized</ToneChip>
            ) : (
              <ToneChip tone="info">Approval required</ToneChip>
            )}
          </dd>
          <dt className="text-muted-foreground">Verification</dt>
          <dd className="space-y-1">
            <ToneChip tone={verificationPresentation.tone}>
              {verificationPresentation.label}
            </ToneChip>
            <span className="ml-2 text-muted-foreground">
              {verification.verifiedCount} verified · {verification.unverifiedCount} unverified ·{' '}
              {verification.pendingCount} pending
            </span>
          </dd>
        </>
      )}
      <dt className="text-muted-foreground">Recovery</dt>
      <dd>
        {recovery ? (
          <>
            <ToneChip tone={recovery.tone}>{recovery.label}</ToneChip>
            {execution.recoveryCheckedAt && (
              <span className="ml-2 text-muted-foreground">
                checked{' '}
                {formatDateTime(execution.recoveryCheckedAt, userTimeZone, { format: 'datetime' })}
              </span>
            )}
            <span className="mt-1 block text-muted-foreground">{recovery.description}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{waiting ?? 'Not evaluated yet'}</span>
        )}
      </dd>
    </dl>
  );
}

const PENDING_RECOVERY_NOTE = new Map<string, string>([
  ['WAITING_APPROVAL', 'Waiting for approval. Paging continues meanwhile.'],
  ['WAITING_AGENT', 'Waiting for an Agent. Paging continues meanwhile.'],
  ['RUNNING', 'Not evaluated yet. Paging continues while the runbook runs.'],
  ['QUEUED', 'Not evaluated yet. Paging continues while the runbook runs.'],
]);

function formatStepActionSummary(type: string, config: unknown): string {
  if (!config || typeof config !== 'object') return type.replaceAll('_', ' ');
  const c = config as Record<string, unknown>;
  switch (type) {
    case 'KUBERNETES': {
      const act = String(c.action ?? '');
      const res = String(c.resource ?? 'deployment');
      const name = c.name ? `/${String(c.name)}` : '';
      const ns = c.namespace ? ` (${String(c.namespace)})` : '';
      return `${act} ${res}${name}${ns}`.trim();
    }
    case 'DOCKER': {
      const act = String(c.action ?? '');
      const container = c.container ? ` container ${String(c.container)}` : '';
      return `${act}${container}`.trim();
    }
    case 'SYSTEMD': {
      const act = String(c.action ?? '');
      const unit = c.unit ? ` ${String(c.unit)}` : '';
      return `${act}${unit}`.trim();
    }
    case 'HTTP': {
      const method = String(c.method ?? 'GET');
      let sanitizedUrl = '';
      if (c.url) {
        try {
          const parsed = new URL(String(c.url));
          sanitizedUrl = ` ${parsed.origin}${parsed.pathname}`;
        } catch {
          sanitizedUrl = ` ${String(c.url).split('?')[0]}`;
        }
      }
      return `${method}${sanitizedUrl}`.trim();
    }
    case 'BASH': {
      const interpreter = c.interpreter ? String(c.interpreter) : 'bash';
      return `Execute script (${interpreter})`;
    }
    case 'LINUX_DIAGNOSTICS': {
      const diag = c.diagnostic ? String(c.diagnostic) : '';
      return diag ? `diagnostic: ${diag}` : 'Linux diagnostics';
    }
    case 'CONDITION': {
      const field = c.field ? String(c.field) : '';
      const op = c.operator ? String(c.operator).toLowerCase().replace('_', ' ') : '';
      const val = c.value !== undefined ? String(c.value) : '';
      if (field && op) {
        return `If ${field} ${op}${val ? ` ${val}` : ''}`.trim();
      }
      return 'If condition';
    }
    case 'WAIT': {
      return `wait ${String(c.durationSeconds ?? 0)}s`;
    }
    default:
      return type.replaceAll('_', ' ');
  }
}

function formatEvidenceDifference(change: { field: string; before: string; after: string }) {
  try {
    if (change.field === 'kubernetesState') {
      const b = JSON.parse(change.before);
      const a = JSON.parse(change.after);
      return {
        label: 'Kubernetes Pods',
        display: `Ready replicas: ${b.ready ?? 0}/${b.desired ?? 0} → ${a.ready ?? 0}/${a.desired ?? 0} (gen ${b.observedGeneration ?? 0} → ${a.observedGeneration ?? 0})`,
      };
    }
    if (change.field === 'memory') {
      const b = JSON.parse(change.before);
      const a = JSON.parse(change.after);
      const bMB = Math.round(Number(b.usedBytes) / (1024 * 1024));
      const aMB = Math.round(Number(a.usedBytes) / (1024 * 1024));
      const totGB = (Number(a.totalBytes) / (1024 * 1024 * 1024)).toFixed(1);
      return {
        label: 'Memory usage',
        display: `${bMB} MB → ${aMB} MB (of ${totGB} GB total)`,
      };
    }
    if (change.field === 'cpu') {
      const b = JSON.parse(change.before);
      const a = JSON.parse(change.after);
      return {
        label: 'CPU load',
        display: `1m load: ${b.load1 ?? '-'} → ${a.load1 ?? '-'} (${a.cores ?? 1} cores)`,
      };
    }
  } catch {
    // not JSON, fall through
  }
  return {
    label: change.field.replace(/([A-Z])/g, ' $1').toLowerCase(),
    display: `${change.before} → ${change.after}`,
  };
}
