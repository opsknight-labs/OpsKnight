import { redactRunbookDisplayName } from '@/lib/runbooks/display-name';
import ExecutionTroubleshooting from '@/components/runbooks/executions/ExecutionTroubleshooting';
import { getExecutionProgress, TRIGGER_LABELS } from '@/lib/runbooks/presentation/contracts';
import { redactRunbookOutput } from '@/lib/runbooks/redaction';
import { formatDiagnosticEvidence } from '@/lib/runbooks/presentation/diagnostics';
import { computePlanDigest } from '@/lib/runbooks/definition';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Flame,
  Layers,
  Play,
  RotateCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Workflow,
  XCircle,
} from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { ConfirmAction } from '@/components/runbooks/RunbookControls';
import { ExecutionProgressBar } from '@/components/runbooks/executions/ExecutionProgressBar';
import { cn } from '@/lib/utils';
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
  const now = new Date();
  const fmt = (value: Date | null, fallback: string) =>
    value
      ? formatDateTime(value, userTimeZone, { format: 'datetime', includeTimeZone: true })
      : fallback;
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
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <DetailHeroBanner
        breadcrumb={{
          label: 'Executions',
          href: '/runbooks/executions',
          current: runbookName,
        }}
        tag="Automation Execution"
        title={runbookName}
        icon={
          <div
            className={cn(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-inner transition-transform',
              execution.status === 'SUCCEEDED'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : execution.status === 'RUNNING'
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-400'
                  : isFailure
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                    : execution.status === 'WAITING_APPROVAL'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                      : 'border-zinc-700 bg-zinc-800 text-slate-300'
            )}
          >
            {execution.status === 'SUCCEEDED' ? (
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
            ) : execution.status === 'RUNNING' ? (
              <Play className="h-6 w-6 animate-pulse" aria-hidden="true" />
            ) : isFailure ? (
              <XCircle className="h-6 w-6" aria-hidden="true" />
            ) : execution.status === 'WAITING_APPROVAL' ? (
              <ShieldAlert className="h-6 w-6 text-amber-400" aria-hidden="true" />
            ) : (
              <Workflow className="h-6 w-6" aria-hidden="true" />
            )}
          </div>
        }
        badges={
          <div className="flex flex-wrap items-center gap-1.5">
            <RunbookStatusBadge status={execution.status} />
            <Badge
              variant="outline"
              className="border-white/20 bg-white/5 text-slate-300 font-mono text-[11px] font-normal shadow-2xs"
            >
              v{execution.runbookVersion.version}
            </Badge>
            <Badge
              variant="outline"
              className="border-white/10 bg-white/5 text-slate-400 font-mono text-[11px] gap-1 shadow-2xs"
              title={`Execution ID: ${execution.id}`}
            >
              <Terminal className="h-3 w-3 text-slate-400" aria-hidden="true" />
              <span className="hidden sm:inline">ID: </span>
              {execution.id}
            </Badge>
            {execution.incident && (
              <Badge
                variant="outline"
                className="border-rose-500/40 bg-rose-500/10 text-rose-300 text-[11px] font-medium gap-1 shadow-2xs"
              >
                <Flame className="h-3 w-3 text-rose-400" aria-hidden="true" />
                Incident Linked
              </Badge>
            )}
          </div>
        }
        subtitle={
          <p className="text-xs text-slate-300 leading-relaxed">
            <span>
              Runbook{' '}
              <Link
                href={`/runbooks/${execution.runbook.id}`}
                className="font-semibold text-white hover:text-primary transition-colors underline-offset-2 hover:underline"
              >
                {runbookName}
              </Link>
            </span>
            <span className="text-slate-500"> · </span>
            <span>Queued {fmt(execution.createdAt, 'at an unrecorded time')}</span>
            {execution.startedAt && (
              <>
                <span className="text-slate-500"> · </span>
                <span>Started {fmt(execution.startedAt, '')}</span>
              </>
            )}
          </p>
        }
        actions={
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
                className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700 shadow-xs"
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
                className={cn(
                  'gap-1.5 font-semibold shadow-xs',
                  !isFailure && 'border-zinc-700 bg-zinc-800 text-slate-100 hover:bg-zinc-700'
                )}
              >
                <a href="#rerun">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Re-run execution
                </a>
              </Button>
            )}
            {execution.incident && (
              <Button
                asChild
                variant="outline"
                size="sm"
                className="gap-1.5 border-zinc-700 bg-zinc-800/80 text-slate-200 hover:bg-zinc-700 shadow-2xs"
              >
                <Link href={`/incidents/${execution.incident.id}?tab=runbooks`}>
                  Open incident
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </Button>
            )}
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="gap-1.5 text-slate-300 hover:text-white hover:bg-white/5"
            >
              <Link href="/runbooks/executions">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                All executions
              </Link>
            </Button>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Status',
            value: execution.status.replace(/_/g, ' '),
            valueClassName: cn(
              'capitalize',
              execution.status === 'SUCCEEDED' && 'text-emerald-400',
              execution.status === 'RUNNING' && 'text-sky-400',
              isFailure && 'text-rose-400',
              execution.status === 'WAITING_APPROVAL' && 'text-amber-400'
            ),
            subtext: isActive
              ? 'In-flight execution'
              : execution.status === 'SUCCEEDED'
                ? 'All steps completed'
                : isFailure
                  ? failedStepName
                    ? `Failed on ${failedStepName}`
                    : 'Execution failed'
                  : 'Execution ended',
            icon:
              execution.status === 'SUCCEEDED' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              ) : execution.status === 'RUNNING' ? (
                <Activity className="h-3.5 w-3.5 text-sky-400 animate-pulse" />
              ) : isFailure ? (
                <XCircle className="h-3.5 w-3.5 text-rose-400" />
              ) : (
                <Clock className="h-3.5 w-3.5 text-slate-400" />
              ),
          },
          {
            label: 'Progress',
            value: totalSteps > 0 ? `${completedSteps} of ${totalSteps} Steps` : '0 Steps',
            subtext: `${totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0}% completed`,
            icon: <Workflow className="h-3.5 w-3.5 text-slate-400" />,
          },
          {
            label: 'Duration',
            value: durationText,
            subtext: execution.completedAt
              ? `Ended ${fmt(execution.completedAt, '')}`
              : isActive
                ? 'Running now'
                : 'Waiting',
            icon: <Clock className="h-3.5 w-3.5 text-sky-400" />,
          },
          {
            label: 'Target',
            value: execution.resolvedTargetAgent
              ? execution.resolvedTargetAgent.name
              : execution.resolvedTargetAgentPool
                ? execution.resolvedTargetAgentPool.name
                : 'Control Plane',
            subtext: execution.resolvedTargetAgent
              ? (execution.resolvedTargetAgent.hostname ?? 'Direct Agent')
              : execution.resolvedTargetAgentPool
                ? `${execution.resolvedTargetAgentPool.mode} Fleet`
                : 'Direct execution',
            icon: <Server className="h-3.5 w-3.5 text-indigo-400" />,
          },
        ]}
      />

      {waitingStep && (
        <section
          aria-label="Approval needed"
          className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/[0.05] backdrop-blur-xs p-5 shadow-xs"
        >
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300 border border-amber-500/20 shadow-2xs">
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
          <Button
            asChild
            size="sm"
            variant="outline"
            className="border-amber-500/50 bg-background/80 shadow-2xs"
          >
            <a href={`#step-${waitingStep.id}`}>Review plan</a>
          </Button>
        </section>
      )}

      {(isFailure || execution.failureCode || execution.failureMessage) && (
        <section
          aria-label="Failure details"
          className="space-y-3 rounded-2xl border border-rose-500/40 bg-rose-500/[0.05] backdrop-blur-xs p-5 text-sm shadow-xs"
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
        <div className="min-w-0 space-y-5">
          <SectionCard
            icon={Layers}
            title="Steps"
            description="In execution order, including prechecks, approvals and verification. Output and attempt details expand per step."
            actions={
              totalSteps > 0 ? (
                <div className="flex items-center gap-3">
                  <ExecutionProgressBar
                    totalSteps={totalSteps}
                    completedSteps={completedSteps}
                    status={execution.status}
                    size="sm"
                    className="w-36 sm:w-48"
                  />
                </div>
              ) : null
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

          {!isActive && (
            <div id="rerun" className="scroll-mt-40">
              <ExecutionRerunPanel
                executionId={execution.id}
                blockedReason={rerunBlockedReason}
                canExecute={canExecute}
              />
            </div>
          )}
        </div>

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
        </aside>
      </div>
    </div>
  );
}
