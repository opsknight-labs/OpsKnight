import Link from 'next/link';
import {
  CheckCircle2,
  Circle,
  Clock3,
  Download,
  Lightbulb,
  Play,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { getUserPermissions } from '@/lib/rbac';
import { computePlanDigest } from '@/lib/runbooks/definition';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
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
  startIncidentRunbookAction,
} from './runbook-actions';

export default async function IncidentRunbooks({
  incidentId,
  serviceId,
}: {
  incidentId: string;
  serviceId: string;
}) {
  const [permissions, bindings, executions, suggestions] = await Promise.all([
    getUserPermissions(),
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
  const canApprove = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_APPROVE);
  return (
    <div className="space-y-4">
      {suggestions.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/40 dark:bg-amber-950/10">
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
                  <form
                    action={startIncidentRunbookAction.bind(null, incidentId, suggestion.bindingId)}
                  >
                    <Button type="submit" size="sm">
                      <Play /> Start suggestion
                    </Button>
                  </form>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {bindings.length > 0 && (
        <Card>
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
                  <form action={startIncidentRunbookAction.bind(null, incidentId, binding.id)}>
                    <Button type="submit" size="sm">
                      <Play /> Start
                    </Button>
                  </form>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {executions.map(execution => (
        <Card key={execution.id}>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{execution.runbook.name}</CardTitle>
                <CardDescription>
                  Version {execution.runbookVersion.version} · started{' '}
                  {execution.createdAt.toLocaleString()}
                </CardDescription>
              </div>
              <Badge
                variant={
                  execution.status === 'SUCCEEDED'
                    ? 'default'
                    : execution.status === 'FAILED'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {execution.status.replaceAll('_', ' ')}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
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
              return (
                <div key={step.id} className="rounded-md border p-3">
                  <div className="flex items-start gap-3">
                    <StepIcon status={step.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{step.name}</span>
                        <Badge variant="outline">{step.riskClass.replaceAll('_', ' ')}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {step.status.replaceAll('_', ' ')}
                        {step.outputPreview ? ` · ${step.outputPreview.slice(0, 160)}` : ''}
                      </div>
                      {step.outputArtifactId && (
                        <Link
                          href={`/api/runbook-artifacts/${step.outputArtifactId}`}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline"
                        >
                          <Download className="h-3.5 w-3.5" /> Download full output
                        </Link>
                      )}
                      {step.status === 'WAITING_APPROVAL' && canApprove && (
                        <form
                          className="mt-3"
                          action={approveIncidentRunbookStepAction.bind(
                            null,
                            incidentId,
                            execution.id,
                            step.id,
                            digest
                          )}
                        >
                          <Button type="submit" size="sm">
                            <ShieldCheck /> Approve exact plan
                          </Button>
                        </form>
                      )}
                      {step.status === 'UNKNOWN' && (
                        <p className="mt-2 text-xs font-medium text-amber-700">
                          The action may have executed. Verify the target before retrying.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {canExecute &&
              !['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(execution.status) && (
                <form
                  className="pt-2"
                  action={cancelIncidentRunbookAction.bind(null, incidentId, execution.id)}
                >
                  <Button type="submit" variant="outline" size="sm">
                    Cancel execution
                  </Button>
                </form>
              )}
          </CardContent>
        </Card>
      ))}
      {bindings.length === 0 && executions.length === 0 && suggestions.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No runbooks are attached to this incident&apos;s service.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === 'SUCCEEDED') return <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />;
  if (status === 'FAILED' || status === 'UNKNOWN')
    return <XCircle className="mt-0.5 h-4 w-4 text-rose-600" />;
  if (status.startsWith('WAITING') || status === 'RUNNING')
    return <Clock3 className="mt-0.5 h-4 w-4 text-amber-600" />;
  return <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />;
}
