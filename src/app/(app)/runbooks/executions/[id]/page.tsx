import { getExecutionProgress, TRIGGER_LABELS } from '@/lib/runbooks/presentation/contracts';
import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { redactRunbookOutput } from '@/lib/runbooks/redaction';
import { formatDiagnosticEvidence } from '@/lib/runbooks/presentation/diagnostics';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Layers } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser } from '@/lib/rbac';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { ExecutionProgressBar } from '@/components/runbooks/executions/ExecutionProgressBar';
import { RunbookLiveRefresh } from '@/components/runbooks/RunbookLiveRefresh';
import { isActiveExecutionStatus } from '@/lib/runbooks/types';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';

export const revalidate = 0;

export default async function ExecutionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const { id } = await params;
  const user = await getCurrentUser();
  const userTimeZone = getUserTimeZone(user);

  const execution = await prisma.runbookExecution.findUnique({
    where: { id },
    include: {
      runbook: { select: { id: true, name: true, slug: true } },
      runbookVersion: { select: { id: true, version: true, checksum: true } },
      service: { select: { id: true, name: true } },
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
              claimedAgent: { select: { name: true } },
              leaseExpiresAt: true,
              planDigest: true,
              preState: true,
              postState: true,
              artifacts: { take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, sizeBytes: true, sha256: true, truncated: true } },
              _count: { select: { artifacts: true } },
              id: true,
              attemptNumber: true,
              status: true,
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
  const durationSec = execution.startedAt
    ? Math.max(
        0,
        Math.round(
          ((execution.completedAt ?? new Date()).getTime() - execution.startedAt.getTime()) / 1000
        )
      )
    : null;

  const durationText =
    durationSec !== null
      ? durationSec >= 60
        ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
        : `${durationSec}s`
      : 'Not started';

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 p-4 md:p-6">
      <RunbookLiveRefresh enabled={isActiveExecutionStatus(execution.status)} intervalMs={6000} />
      <RunbookPageHeader
        breadcrumbs={[
          { label: 'Runbooks', href: '/runbooks' },
          { label: 'Executions', href: '/runbooks/executions' },
          { label: execution.runbook.name },
        ]}
        title={execution.runbook.name}
        description={`Execution trace · ID ${execution.id}`}
        badge={<RunbookStatusBadge status={execution.status} />}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5 text-xs">
              <Link href="/runbooks/executions">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>All Executions</span>
              </Link>
            </Button>
            {execution.incident && (
              <Button asChild size="sm" className="gap-1.5 text-xs">
                <Link href={`/incidents/${execution.incident.id}?tab=runbooks`}>
                  <span>Incident Command Center</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <RunbookModuleNav summary={navigation} />
      {(execution.failureCode || execution.failureMessage) && <div className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"><strong>{execution.failureCode}</strong><p className="break-words">{redactRunbookOutput(execution.failureMessage ?? '')}</p></div>}
      {/* Hero Overview Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="rounded-xl">
          <CardHeader className="pb-2">
            <span className="text-xs text-muted-foreground">Version</span>
            <CardTitle className="text-lg font-bold">
              v{execution.runbookVersion.version}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground font-mono">
            {execution.runbookVersion.checksum.slice(0, 16)}
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader className="pb-2">
            <span className="text-xs text-muted-foreground">Target Service</span>
            <CardTitle className="text-lg font-bold">
              {execution.service?.name || 'Unbound execution'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {TRIGGER_LABELS[execution.triggeredByType]}{execution.triggeredByUser ? ` · ${execution.triggeredByUser.name}` : ''}
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader className="pb-2">
            <span className="text-xs text-muted-foreground">Target Host / Agent</span>
            <CardTitle className="text-lg font-bold">
              {execution.resolvedTargetAgent?.name || 'Control plane'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground font-mono">
            {execution.resolvedTargetAgent?.hostname || 'Not reported'}{execution.resolvedTargetAgentPool ? ` · Pool: ${execution.resolvedTargetAgentPool.name} (${execution.resolvedTargetAgentPool.mode})` : ''}
          </CardContent>
        </Card>

        <Card className="rounded-xl">
          <CardHeader className="pb-2">
            <span className="text-xs text-muted-foreground">Duration</span>
            <CardTitle className="text-lg font-bold">{durationText}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {execution.startedAt
              ? `Started ${formatDateTime(execution.startedAt, userTimeZone, { format: 'time' })}`
              : 'Awaiting execution worker'}
          </CardContent>
        </Card>
      </div>

      {/* Progress & Steps section */}
      <Card className="rounded-xl">
        <CardHeader className="flex flex-row items-center justify-between pb-4 border-b">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              <span>Execution Steps & Verification</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Ordered plan executed under isolated runner guarantees.
            </p>
          </div>
          <ExecutionProgressBar
            totalSteps={totalSteps}
            completedSteps={completedSteps}
            status={execution.status}
          />
        </CardHeader>

        <CardContent className="p-0 divide-y">
          {failedStep && (
            <div className="p-4 bg-rose-500/10 border-b border-rose-500/20 text-xs text-rose-600 dark:text-rose-400 flex items-center justify-between">
              <span>
                Execution interrupted at step: <strong className="font-semibold">{failedStep.stepKey}</strong>
              </span>
              <RunbookStatusBadge status={failedStep.status} size="sm" />
            </div>
          )}
          {execution.steps.map((step, index) => (
            <div key={step.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs text-muted-foreground">
                    Step {index + 1}
                  </span>
                  <span className="font-semibold text-sm">{step.name} · {step.stepKey}</span>
                  <Badge variant="outline" className="text-[11px]">
                    {step.type}
                  </Badge>
                </div>
                <RunbookStatusBadge status={step.status} size="sm" />
              </div>

              <p className="text-xs text-muted-foreground">Risk: {step.riskClass} · Attempts: {step.attemptCount} · Retry limit: {step.maxRetries}</p>
              <p className="text-xs text-muted-foreground">Started: {step.startedAt ? formatDateTime(step.startedAt, userTimeZone, { format: 'datetime' }) : 'Not started'} · Completed: {step.completedAt ? formatDateTime(step.completedAt, userTimeZone, { format: 'datetime' }) : 'Pending'} · Duration: {step.startedAt ? `${Math.max(0, Math.round(((step.completedAt ?? new Date()).getTime() - step.startedAt.getTime()) / 1000))}s` : '—'}</p>
              {(step.errorCode || step.errorMessage) && <p className="text-xs text-destructive">{step.errorCode}: {redactRunbookOutput(step.errorMessage ?? '')}</p>}
              {step.outputPreview && <details className="text-xs"><summary className="cursor-pointer">Step output (bounded, redacted)</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{redactRunbookOutput(step.outputPreview)}</pre></details>}
              {step.requiresApproval && <div className="rounded-lg border p-3 text-xs break-all">Approval: {step.approvedAt ? `${step.approvedBy?.name ?? 'Actor no longer available'} · ${formatDateTime(step.approvedAt, userTimeZone, { format: 'datetime' })}` : 'Not approved'}<p>Plan digest: {step.approvedPlanDigest ?? 'Not recorded'}</p></div>}
              <details className="text-xs"><summary className="cursor-pointer">Verification result</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{formatDiagnosticEvidence(step.verificationResult)}</pre></details>
              {step.attemptCount > step.attempts.length && <p className="text-xs text-muted-foreground">Showing latest {step.attempts.length} of {step.attemptCount} attempts.</p>}
              {step.attempts.length > 0 && (
                <div className="pl-4 border-l-2 border-border/80 space-y-1 text-xs text-muted-foreground">
                  {step.attempts.map(att => (
                    <div key={att.id} className="space-y-2 rounded-lg border p-3">
                      <span>Attempt #{att.attemptNumber}:</span>
                      <RunbookStatusBadge status={att.status} size="sm" />
                      {att.exitCode !== null && (
                        <span>Exit code: {att.exitCode}</span>
                      )}
                      {att.errorCode && !att.errorMessage && <p className="text-destructive">{att.errorCode}</p>}
                      {att.errorMessage && (
                        <span className="text-rose-600 dark:text-rose-400 font-medium">
                          {att.errorCode ? `${att.errorCode}: ` : ''}{redactRunbookOutput(att.errorMessage)}
                        </span>
                      )}
                      <p>Target: {att.targetAgent?.name ?? att.targetAgentPool?.name ?? 'Control plane'} · Claimed by: {att.claimedAgent?.name ?? 'Unclaimed'}</p>
                      <p>Lease expires: {att.leaseExpiresAt ? formatDateTime(att.leaseExpiresAt, userTimeZone, { format: 'datetime' }) : 'No lease'}</p>
                      <p className="break-all">Plan digest: {att.planDigest ?? 'Not recorded'}</p>
                      <p>Started: {att.startedAt ? formatDateTime(att.startedAt, userTimeZone, { format: 'datetime' }) : 'Not started'} · Completed: {att.completedAt ? formatDateTime(att.completedAt, userTimeZone, { format: 'datetime' }) : 'Pending'}</p>
                      {att.outputPreview && <details><summary className="cursor-pointer">View bounded output</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{redactRunbookOutput(att.outputPreview)}</pre></details>}
                      <details><summary className="cursor-pointer">Verification evidence: before / after</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{formatDiagnosticEvidence({ before: att.preState, after: att.postState })}</pre></details>
                      <p>Artifacts: {att._count.artifacts} (latest {att.artifacts.length})</p>
                      {att.artifacts.map(artifact => <p key={artifact.id} className="break-all">{artifact.kind} · {artifact.sizeBytes} bytes{artifact.truncated ? ' · Truncated' : ''} · SHA256 {artifact.sha256} · ID {artifact.id}</p>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {execution.steps.length === 0 && (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No steps defined in this execution.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
