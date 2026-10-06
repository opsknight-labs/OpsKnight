import Link from 'next/link';
import { CheckCircle2, Circle, Clock3, Download, Lightbulb, Play, XCircle } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCanViewIncident, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { redactRunbookOutput } from '@/lib/runbooks/redaction';
import {
  computePlanDigest,
  resolveInputTemplates,
  flattenSteps,
  parseRunbookDefinition,
} from '@/lib/runbooks/definition';
import { Badge } from '@/components/ui/shadcn/badge';
import { compareEvidence, verificationResultSchema } from '@/lib/runbooks/evidence';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import EmptyState from '@/components/ui/EmptyState';
import {
  ActionForm,
  ConfirmAction,
  StatusBadge,
  SubmitButton,
} from '@/components/runbooks/RunbookControls';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import {
  approveIncidentRunbookStepAction,
  cancelIncidentRunbookAction,
  dismissIncidentRunbookSuggestionAction,
  startIncidentRunbookAction,
  startIncidentRunbookSuggestionAction,
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
  const [bindings, executions, suggestions] = await Promise.all([
    prisma.serviceRunbookBinding.findMany({
      where: { serviceId, enabled: true },
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
      where: { incidentId, state: 'SUGGESTED' },
      include: {
        binding: { include: { runbook: true } },
        runbookVersion: { select: { version: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
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
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 text-sm">
        <h3 className="font-semibold">Automation safety</h3>
        <p>
          {usedExecutions} / {budget?.runbookAutoExecutionsPerIncident ?? 3} automatic executions ·{' '}
          {usedWrites} / {budget?.runbookAutoWritesPerIncident ?? 3} automatic writes ·{' '}
          {usedNonIdempotent} / {budget?.runbookAutoNonIdempotentPerIncident ?? 0} non-idempotent
          actions used.
        </p>
        <p className="text-xs text-muted-foreground">
          Further remediation requires responder approval when an incident budget is exhausted.
        </p>
      </div>
      {suggestions.length > 0 && (
        <Card className="rounded-xl border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4" /> Suggested runbooks
            </CardTitle>
            <CardDescription>Matched to the incident by a configured trigger.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.map(suggestion => (
              <div
                key={suggestion.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3"
              >
                <div>
                  <div className="font-medium">{suggestion.binding.runbook.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Version {suggestion.runbookVersion.version}
                  </div>
                </div>
                {canExecute && (
                  <div className="flex gap-2">
                    <ActionForm
                      action={startIncidentRunbookSuggestionAction.bind(
                        null,
                        incidentId,
                        suggestion.id
                      )}
                    >
                      <SubmitButton
                        pendingLabel="Starting…"
                        size="sm"
                        disabled={!suggestion.planSnapshot}
                      >
                        <Play /> Start suggestion
                      </SubmitButton>
                    </ActionForm>
                    {!suggestion.planSnapshot && (
                      <span className="text-xs text-muted-foreground">
                        Generate a new suggestion to freeze its plan.
                      </span>
                    )}
                    <ActionForm
                      action={dismissIncidentRunbookSuggestionAction.bind(
                        null,
                        incidentId,
                        suggestion.id
                      )}
                    >
                      <SubmitButton pendingLabel="Dismissing…" size="sm" variant="ghost">
                        Dismiss
                      </SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {bindings.length > 0 && (
        <details className="rounded-xl border bg-card">
          <summary className="cursor-pointer p-4 text-sm font-semibold">
            Available workflows · {bindings.length}
          </summary>
          <Card className="border-0 shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Available runbooks</CardTitle>
              <CardDescription>
                Manual and suggested workflows attached to this service.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {bindings.map(binding => (
                <div
                  key={binding.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div>
                    <div className="font-medium">{binding.runbook.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {binding.mode} ·{' '}
                      {binding.versionStrategy === 'PINNED'
                        ? `v${binding.runbookVersion?.version}`
                        : 'latest published'}
                    </div>
                  </div>
                  {canExecute && (
                    <ActionForm
                      action={startIncidentRunbookAction.bind(null, incidentId, binding.id)}
                    >
                      <SubmitButton pendingLabel="Starting…" size="sm">
                        <Play /> Start
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </details>
      )}
      {executions.map(execution => (
        <Card key={execution.id}>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{execution.runbook.name}</CardTitle>
                <CardDescription>
                  Version {execution.runbookVersion.version} · started{' '}
                  {formatDateTime(execution.createdAt, userTimeZone, { format: 'datetime' })}
                </CardDescription>
              </div>
              <StatusBadge status={execution.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol aria-label={`${execution.runbook.name} execution timeline`}>
              {execution.steps.map(step => {
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
                  ? flattenSteps({ steps: authored.verification.steps }).map(item => item.key)
                  : [];
                const result = verificationResultSchema.safeParse(step.verificationResult);
                const differences = result.success ? result.data.differences : evidence.differences;
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
                return (
                  <li
                    key={step.id}
                    className="relative ml-2 border-l-2 border-border pb-6 pl-4 last:border-transparent"
                  >
                    <div className="flex items-start gap-3">
                      <StepIcon status={step.status} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{step.name}</span>
                          {verified && <Badge variant="success">Verified recovery</Badge>}
                          <Badge variant="outline">{step.riskClass.replaceAll('_', ' ')}</Badge>
                        </div>
                        <div className="mt-1 break-words text-xs text-muted-foreground">
                          {step.status.replaceAll('_', ' ')}
                          {step.outputPreview ? ` · ${step.outputPreview.slice(0, 160)}` : ''}
                        </div>
                        {step.attempts[0]?.preState && step.attempts[0]?.postState && (
                          <details className="mt-2 rounded-lg border p-3 text-xs">
                            <summary className="cursor-pointer font-medium">
                              Recovery evidence · {verified ? 'verified' : 'not verified'}
                            </summary>
                            <ul className="mt-2 space-y-1">
                              {differences.map(change => (
                                <li className="break-words" key={change.field}>
                                  {change.field}: {change.before} → {change.after}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        {step.outputArtifactId && (
                          <Link
                            href={`/api/runbook-artifacts/${step.outputArtifactId}`}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <Download className="h-3.5 w-3.5" /> Download full output
                          </Link>
                        )}
                        {step.status === 'WAITING_APPROVAL' && canApprove && (
                          <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
                            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
                              <dt className="text-muted-foreground">Action</dt>
                              <dd>{step.type.replaceAll('_', ' ')}</dd>
                              {approvalPlan.map(([label, value]) => (
                                <div key={label} className="contents">
                                  <dt className="text-muted-foreground">{label}</dt>
                                  <dd className="break-all font-mono">{value}</dd>
                                </div>
                              ))}
                              <dt className="text-muted-foreground">Execution target</dt>
                              <dd>
                                {execution.resolvedTargetAgent
                                  ? `${execution.resolvedTargetAgent.name}${execution.resolvedTargetAgent.hostname ? ` (${execution.resolvedTargetAgent.hostname})` : ''}`
                                  : execution.resolvedTargetAgentPool
                                    ? `Pool: ${execution.resolvedTargetAgentPool.name}`
                                    : 'OpsKnight control plane'}
                              </dd>
                              <dt className="text-muted-foreground">Version</dt>
                              <dd>
                                v{execution.runbookVersion.version} ·{' '}
                                <span className="font-mono">
                                  {execution.definitionChecksum.slice(0, 12)}…
                                </span>
                              </dd>
                              <dt className="text-muted-foreground">Timeout</dt>
                              <dd>{step.timeoutSeconds ?? 300}s</dd>
                            </dl>
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
                        )}
                        {step.status === 'UNKNOWN' && (
                          <p className="mt-2 text-xs font-medium text-amber-700">
                            The action may have executed. Verify the target before retrying.
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {canExecute &&
              !['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(execution.status) && (
                <ConfirmAction
                  action={cancelIncidentRunbookAction.bind(null, incidentId, execution.id)}
                  title={`Cancel ${execution.runbook.name}?`}
                  description="Pending steps stop and running Agents receive cancellation. A started write may have an unknown outcome; verify the target before retrying."
                  label="Cancel execution"
                  variant="outline"
                />
              )}
          </CardContent>
        </Card>
      ))}
      {bindings.length === 0 && executions.length === 0 && suggestions.length === 0 && (
        <EmptyState
          title="No incident runbooks"
          description="Attach published workflows to this incident’s service to offer diagnostics and recovery."
        />
      )}
    </div>
  );
}

function safePlanValue(value: unknown): string {
  if (typeof value === 'string') {
    if (value.includes('secret://')) return '[scoped secret]';
    try {
      const url = new URL(value);
      if (url.username || url.password) {
        url.username = '';
        url.password = '';
      }
      return redactRunbookOutput(url.toString()).slice(0, 500);
    } catch {
      return redactRunbookOutput(value).slice(0, 500);
    }
  }
  return JSON.stringify(value).slice(0, 500);
}

function resolvedApprovalPlan(
  type: string,
  config: Record<string, unknown>,
  inputValues: Record<string, unknown>
): Array<[string, string]> {
  const resolved = resolveInputTemplates(config, inputValues) as Record<string, unknown>;
  const keys =
    type === 'HTTP'
      ? ['method', 'url']
      : type === 'SYSTEMD'
        ? ['action', 'unit']
        : type === 'DOCKER'
          ? ['action', 'container']
          : type === 'KUBERNETES'
            ? ['action', 'namespace', 'resource', 'name']
            : type === 'BASH'
              ? ['command']
              : type === 'WAIT'
                ? ['durationSeconds']
                : [];
  return Object.entries(resolved)
    .filter(([key, value]) => keys.includes(key) && value !== undefined)
    .map(([key, value]) => [
      key.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase()),
      safePlanValue(value),
    ]);
}

function StepIcon({ status }: { status: string }) {
  if (status === 'SUCCEEDED') return <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />;
  if (status === 'FAILED' || status === 'UNKNOWN')
    return <XCircle className="mt-0.5 h-4 w-4 text-destructive" />;
  if (status.startsWith('WAITING') || status === 'RUNNING')
    return <Clock3 className="mt-0.5 h-4 w-4 text-amber-600" />;
  return <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />;
}
