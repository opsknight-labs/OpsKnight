import { redactRunbookDisplayName } from '@/lib/runbooks/display-name';
import ExecutionTroubleshooting from '@/components/runbooks/executions/ExecutionTroubleshooting';
import { getExecutionProgress, TRIGGER_LABELS } from '@/lib/runbooks/presentation/contracts';
import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { redactRunbookOutput } from '@/lib/runbooks/redaction';
import { formatDiagnosticEvidence } from '@/lib/runbooks/presentation/diagnostics';
import { computePlanDigest } from '@/lib/runbooks/definition';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Layers,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { ConfirmAction } from '@/components/runbooks/RunbookControls';
import { ExecutionProgressBar } from '@/components/runbooks/executions/ExecutionProgressBar';
import {
  ExecutionStepTimeline,
  type TimelineStep,
} from '@/components/runbooks/executions/ExecutionStepTimeline';
import { ExecutionRerunPanel } from '@/components/runbooks/executions/ExecutionRerunPanel';
import { resolvedApprovalPlan } from '@/components/runbooks/executions/approval-plan';
import {
  executionDurationSeconds,
  formatDurationSeconds,
} from '@/components/runbooks/executions/format';
import { RunbookLiveRefresh } from '@/components/runbooks/RunbookLiveRefresh';
import { isActiveExecutionStatus } from '@/lib/runbooks/types';
import { getRerunBlockedReason } from '@/lib/runbooks/rerun';
import { cancelExecutionAction } from '../actions';
import { Button } from '@/components/ui/shadcn/button';
import { KeyValueGrid, SectionCard } from '@/components/runbooks/ui/primitives';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';

export const revalidate = 0;

export default async function ExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const { id } = await params;
  const [user, permissions] = await Promise.all([getCurrentUser(), getUserPermissions()]);
  const userTimeZone = getUserTimeZone(user);
  const canExecute = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_EXECUTE);
  const canApprove = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_APPROVE);

  const execution = await prisma.runbookExecution.findUnique({
    where: { id },
    include: {
      runbook: {
        select: { id: true, name: true, slug: true, archivedAt: true, publishedVersionId: true },
      },
      runbookVersion: { select: { id: true, version: true, checksum: true } },
      service: { select: { id: true, name: true } },
      binding: {
        select: {
          id: true,
          name: true,
          serviceId: true,
          enabled: true,
          detachedAt: true,
          versionStrategy: true,
          runbookVersionId: true,
        },
      },
      resolvedTargetAgentPool: { select: { id: true, name: true, mode: true } },
      resolvedTargetAgent: { select: { id: true, name: true, hostname: true } },
      triggeredByUser: { select: { id: true, name: true } },
      incident: { select: { id: true, title: true, priority: true } },
      steps: {
        orderBy: { sequence: 'asc' },
        include: {
          approvedBy: { select: { name: true } },
          attempts: {
            orderBy: { attemptNumber: 'desc' },
            take: 3,
            select: {
              targetAgent: { select: { name: true } },
              targetAgentPool: { select: { name: true } },
              claimedAgent: { select: { name: true, lastHeartbeatAt: true } },
              leaseExpiresAt: true,
              planDigest: true,
              preState: true,
              postState: true,
              outputArtifactId: true,
              artifacts: {
                take: 10,
                orderBy: { createdAt: 'desc' },
                select: { id: true, kind: true, sizeBytes: true, sha256: true, truncated: true },
              },
              _count: { select: { artifacts: true } },
              id: true,
              attemptNumber: true,
              status: true,
              createdAt: true,
              claimedAt: true,
              startedAt: true,
              completedAt: true,
              exitCode: true,
              errorCode: true,
              errorMessage: true,
              outputPreview: true,
            },
          },
        },
      },
    },
  });

  if (!execution) notFound();

  const { totalSteps, completedSteps, failedStepName } = getExecutionProgress(execution.steps);
  const failedStep = execution.steps.find(step => step.stepKey === failedStepName);
  const navigation = await getRunbookNavigationSummary();
  const now = new Date();
  const fmt = (value: Date | null, fallback: string) =>
    value ? formatDateTime(value, userTimeZone, { format: 'datetime' }) : fallback;
  const durationText = formatDurationSeconds(
    executionDurationSeconds(execution.startedAt, execution.completedAt, now)
  );
  const isActive = isActiveExecutionStatus(execution.status);
  const isFailure = execution.status === 'FAILED' || execution.status === 'TIMED_OUT';
  const rerunBlockedReason = getRerunBlockedReason(execution);
  const runbookName = redactRunbookDisplayName(execution.runbook.name);
  const targetLabel = execution.resolvedTargetAgent
    ? `Agent · ${execution.resolvedTargetAgent.name}${execution.resolvedTargetAgent.hostname ? ` (${execution.resolvedTargetAgent.hostname})` : ''}`
    : execution.resolvedTargetAgentPool
      ? `Pool · ${execution.resolvedTargetAgentPool.name} (${execution.resolvedTargetAgentPool.mode})`
      : 'Control plane';
  const versionLabel = `v${execution.runbookVersion.version} · ${execution.definitionChecksum.slice(0, 12)}…`;
  const inputValues = execution.inputValues as Record<string, unknown>;
  const waitingStep = execution.steps.find(step => step.status === 'WAITING_APPROVAL');

  const timelineSteps: TimelineStep[] = execution.steps.map(step => {
    const config = step.config as Record<string, unknown>;
    return {
      id: step.id,
      name: redactRunbookDisplayName(step.name),
      stepKey: step.stepKey,
      type: step.type,
      riskClass: step.riskClass,
      status: step.status,
      startedAt: step.startedAt ? fmt(step.startedAt, '') : null,
      completedAt: step.completedAt ? fmt(step.completedAt, '') : null,
      duration: step.startedAt
        ? formatDurationSeconds(executionDurationSeconds(step.startedAt, step.completedAt, now))
        : '—',
      attemptCount: step.attemptCount,
      maxRetries: step.maxRetries,
      errorCode: step.errorCode,
      errorMessage: step.errorMessage ? redactRunbookOutput(step.errorMessage) : null,
      outputPreview: step.outputPreview ? redactRunbookOutput(step.outputPreview) : null,
      outputArtifactId: step.outputArtifactId,
      verification: formatDiagnosticEvidence(step.verificationResult),
      requiresApproval: step.requiresApproval,
      approvedBy: step.approvedBy?.name ?? null,
      approvedAt: step.approvedAt ? fmt(step.approvedAt, '') : null,
      approvedPlanDigest: step.approvedPlanDigest,
      pendingApproval:
        step.status === 'WAITING_APPROVAL'
          ? {
              digest: computePlanDigest({
                stepKey: step.stepKey,
                stepType: step.type,
                riskClass: step.riskClass,
                config,
                agentPoolId: execution.resolvedTargetAgentPoolId ?? undefined,
                agentId: execution.resolvedTargetAgentId ?? undefined,
                inputValues,
                versionChecksum: execution.definitionChecksum,
              }),
              plan: resolvedApprovalPlan(step.type, config, inputValues),
              timeoutSeconds: step.timeoutSeconds ?? 300,
            }
          : null,
      attempts: step.attempts.map(att => ({
        id: att.id,
        attemptNumber: att.attemptNumber,
        status: att.status,
        exitCode: att.exitCode,
        errorCode: att.errorCode,
        errorMessage: att.errorMessage ? redactRunbookOutput(att.errorMessage) : null,
        target: att.targetAgent?.name ?? att.targetAgentPool?.name ?? 'Control plane',
        claimedBy: att.claimedAgent?.name ?? 'Unclaimed',
        agentLastContact: fmt(att.claimedAgent?.lastHeartbeatAt ?? null, 'Not reported'),
        queuedAt: fmt(att.createdAt, 'Not recorded'),
        claimedAt: fmt(att.claimedAt, att.claimedAgent ? 'Not recorded' : 'Unclaimed'),
        startedAt: fmt(att.startedAt, 'Not started'),
        completedAt: fmt(att.completedAt, 'Pending'),
        leaseExpiresAt: fmt(att.leaseExpiresAt, 'No lease'),
        planDigest: att.planDigest,
        outputPreview: att.outputPreview ? redactRunbookOutput(att.outputPreview) : null,
        outputArtifactId: att.outputArtifactId,
        evidence: formatDiagnosticEvidence({ before: att.preState, after: att.postState }),
        artifactCount: att._count.artifacts,
        artifacts: att.artifacts,
      })),
    };
  });

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 p-4 md:p-6">
      <RunbookPageHeader
        breadcrumbs={[
          { label: 'Runbooks', href: '/runbooks' },
          { label: 'Executions', href: '/runbooks/executions' },
          { label: runbookName },
        ]}
        title={runbookName}
        description={
          <span>
            Execution <span className="font-mono">{execution.id}</span> · queued{' '}
            {fmt(execution.createdAt, 'at an unrecorded time')}
          </span>
        }
        badge={<RunbookStatusBadge status={execution.status} />}
        actions={
          <>
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/runbooks/executions">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                All executions
              </Link>
            </Button>
            {execution.incident && (
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <Link href={`/incidents/${execution.incident.id}?tab=runbooks`}>
                  Open incident
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            )}
          </>
        }
      />

      {/* Static here so the execution summary can own the sticky slot below the app header. */}
      <RunbookModuleNav summary={navigation} className="static" />

      <section
        aria-label="Execution summary"
        className="sticky top-0 z-20 -mx-4 border-y bg-background/95 px-4 py-3 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6"
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <RunbookStatusBadge status={execution.status} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold" title={runbookName}>
                {runbookName}
              </p>
              <p
                className="truncate text-xs text-muted-foreground tabular-nums"
                title={targetLabel}
              >
                {durationText}
                {execution.startedAt
                  ? ` · started ${fmt(execution.startedAt, '')}`
                  : ' · waiting for a worker'}
                {` · ${targetLabel}`}
              </p>
            </div>
          </div>
          {totalSteps > 0 && (
            <ExecutionProgressBar
              totalSteps={totalSteps}
              completedSteps={completedSteps}
              status={execution.status}
              size="lg"
              className="order-last basis-full sm:order-none sm:max-w-xs sm:basis-auto"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <RunbookLiveRefresh
              enabled={isActive}
              active={isActive}
              intervalMs={5000}
              showIndicator={isActive}
            />
            {waitingStep && (
              <Button
                asChild
                size="sm"
                className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
              >
                <a href={`#step-${waitingStep.id}`}>
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Review approval
                </a>
              </Button>
            )}
            {isActive && canExecute && (
              <ConfirmAction
                action={cancelExecutionAction.bind(null, execution.id)}
                title={`Cancel ${runbookName}?`}
                description="Pending steps stop and running Agents receive cancellation. A started write may have an unknown outcome; verify the target before retrying."
                label="Cancel execution"
                variant="destructive"
                successMessage="Cancellation requested"
              />
            )}
            {!isActive && (
              <Button
                asChild
                size="sm"
                variant={isFailure ? 'default' : 'outline'}
                className="gap-1.5"
              >
                <a href="#rerun">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Re-run
                </a>
              </Button>
            )}
          </div>
        </div>
      </section>

      {waitingStep && (
        <section
          aria-label="Approval needed"
          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] p-4"
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300">
              <ShieldAlert className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                A step is waiting for approval
              </p>
              <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-100/80">
                “{redactRunbookDisplayName(waitingStep.name)}” is paused until a responder
                authorizes its exact plan.{' '}
                {canApprove
                  ? 'Review the resolved parameters, then approve.'
                  : 'You can review the plan; a user with approval permission must approve it.'}
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="border-amber-500/50 bg-background">
            <a href={`#step-${waitingStep.id}`}>Review plan</a>
          </Button>
        </section>
      )}

      {(isFailure || execution.failureCode || execution.failureMessage) && (
        <section
          aria-label="Failure details"
          className="space-y-3 rounded-xl border border-rose-500/40 bg-rose-500/[0.06] p-4 text-sm"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-700 ring-1 ring-inset ring-rose-500/25 dark:text-rose-300">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-1">
              <p className="font-semibold text-rose-800 dark:text-rose-200">
                {execution.failureCode ??
                  (execution.status === 'TIMED_OUT' ? 'Execution timed out' : 'Execution failed')}
              </p>
              {execution.failureMessage && (
                <p className="break-words text-xs text-rose-800/90 dark:text-rose-200/90">
                  {redactRunbookOutput(execution.failureMessage)}
                </p>
              )}
              {failedStep && (
                <p className="text-xs text-rose-800/90 dark:text-rose-200/90">
                  Stopped at step{' '}
                  <a
                    className="font-mono font-semibold underline underline-offset-2"
                    href={`#step-${failedStep.id}`}
                  >
                    {failedStep.stepKey}
                  </a>
                  {failedStep.errorCode ? ` · ${failedStep.errorCode}` : ''}
                </p>
              )}
            </div>
          </div>
          <ExecutionTroubleshooting
            status={execution.status}
            code={execution.failureCode ?? failedStep?.errorCode}
          />
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <SectionCard
          icon={Layers}
          title="Steps"
          description="In execution order, including prechecks, approvals and verification. Output and attempt details expand per step."
          actions={
            <span className="text-xs text-muted-foreground tabular-nums">
              {completedSteps} of {totalSteps} complete
            </span>
          }
        >
          <ExecutionStepTimeline
            executionId={execution.id}
            runbookName={runbookName}
            steps={timelineSteps}
            canApprove={canApprove}
            canDownloadArtifacts={permissions.capabilities.includes(
              CAPABILITIES.RUNBOOK_ARTIFACT_DOWNLOAD
            )}
            targetLabel={targetLabel}
            versionLabel={versionLabel}
          />
        </SectionCard>

        <aside className="space-y-5">
          <SectionCard title="Details">
            <KeyValueGrid
              className="sm:grid-cols-1"
              items={[
                {
                  label: 'Runbook',
                  value: (
                    <Link
                      className="text-primary hover:underline"
                      href={`/runbooks/${execution.runbook.id}`}
                    >
                      {runbookName} · v{execution.runbookVersion.version}
                    </Link>
                  ),
                },
                {
                  label: 'Service',
                  value: execution.service ? (
                    <Link
                      className="text-primary hover:underline"
                      href={`/services/${execution.service.id}`}
                    >
                      {execution.service.name}
                    </Link>
                  ) : (
                    'No service'
                  ),
                },
                {
                  label: 'Incident',
                  value: execution.incident ? (
                    <Link
                      className="text-primary hover:underline"
                      href={`/incidents/${execution.incident.id}?tab=runbooks`}
                    >
                      {execution.incident.title}
                    </Link>
                  ) : (
                    'None'
                  ),
                },
                {
                  label: 'Trigger',
                  value: `${TRIGGER_LABELS[execution.triggeredByType]}${execution.triggeredByUser ? ` · ${execution.triggeredByUser.name}` : ''}`,
                },
                { label: 'Target', value: targetLabel },
                {
                  label: 'Timing',
                  value: (
                    <span className="block space-y-0.5 text-xs tabular-nums">
                      <span className="block">
                        Queued {fmt(execution.createdAt, 'not recorded')}
                      </span>
                      <span className="block">Started {fmt(execution.startedAt, 'not yet')}</span>
                      <span className="block">
                        Completed {fmt(execution.completedAt, 'not yet')}
                      </span>
                      <span className="block font-medium">Duration {durationText}</span>
                    </span>
                  ),
                },
                {
                  label: 'Version checksum',
                  value: (
                    <span className="break-all font-mono text-xs text-muted-foreground">
                      {execution.runbookVersion.checksum}
                    </span>
                  ),
                },
                ...(execution.binding
                  ? [
                      {
                        label: 'Source rule',
                        value: (
                          <Link
                            className="text-primary hover:underline"
                            href={`/services/${execution.binding.serviceId}/automations/${execution.binding.id}`}
                          >
                            {execution.binding.name || execution.binding.id}
                          </Link>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </SectionCard>

          {!isActive && (
            <div id="rerun" className="scroll-mt-40">
              <ExecutionRerunPanel
                executionId={execution.id}
                blockedReason={rerunBlockedReason}
                canExecute={canExecute}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
