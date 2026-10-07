import React from 'react';
import { resolveEffectiveAgentStatus } from '@/lib/runbooks/presentation/contracts';
import type { RunbookAgentStatus } from '@prisma/client';
import Link from 'next/link';
import { Bot, HardDrive, ShieldCheck, Terminal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { formatDateTime } from '@/lib/timezone';

export type HealthDetailCardsProps = {
  localWorker: {
    running: boolean;
    lastError?: string | null;
    lastRunbookError?: string | null;
    lane: string;
    lastSuccessAt?: Date | null;
  };
  pending: number;
  oldest: number;
  artifacts: { count: number; sizeBytes: number };
  unknown: number;
  expiredLeases: number;
  circuits: number;
  deadLetters: number;
  unhealthyAgents: Array<{
    id: string;
    name: string;
    status: RunbookAgentStatus;
    lastHeartbeatAt: Date | null;
    lastError: string | null;
    spoolDepth: number;
    deadLetterDepth: number;
  }>;
  totalAgentsCount: number;
  totalUnhealthy?: number;
  now: Date;
  userTimeZone: string;
};

export function HealthDetailCards({
  localWorker,
  pending,
  oldest,
  artifacts,
  unknown,
  expiredLeases,
  circuits,
  deadLetters,
  unhealthyAgents,
  totalAgentsCount,
  totalUnhealthy,
  now,
  userTimeZone,
}: HealthDetailCardsProps) {
  return (
    <div className="space-y-4">
      {/* 3 Technical Detail Cards */}
      <div className="grid gap-3.5 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {/* 1. Execution Plane */}
        <Card className="rounded-xl border bg-card/80 shadow-2xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <span>Execution Plane</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {(() => {
              const runbookWorkerError =
                localWorker.running &&
                (localWorker.lane === 'runbook' ? localWorker.lastError : localWorker.lastRunbookError);
              return (
                <DetailRow
                  label="Local worker"
                  value={
                    localWorker.running
                      ? runbookWorkerError
                        ? 'Needs attention'
                        : 'Running'
                      : 'Not observed in this process'
                  }
                  attention={Boolean(runbookWorkerError)}
                />
              );
            })()}
            <DetailRow label="Worker lane" value={localWorker.lane} />
            <DetailRow
              label="Last successful cycle"
              value={
                localWorker.lastSuccessAt
                  ? formatDateTime(localWorker.lastSuccessAt, userTimeZone, { format: 'datetime' })
                  : 'Not observed'
              }
            />
            <p className="text-[11px] text-muted-foreground pt-1.5 border-t border-border/40">
              In split deployments web processes do not observe dedicated background runners.
              Monitor readiness endpoints independently.
            </p>
          </CardContent>
        </Card>

        {/* 2. Queue & Storage */}
        <Card className="rounded-xl border bg-card/80 shadow-2xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-primary" />
              <span>Queue & Artifact Storage</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <DetailRow label="Pending step attempts" value={pending} attention={pending > 50} />
            <DetailRow
              label="Oldest pending attempt"
              value={`${oldest}s`}
              attention={oldest > 300}
            />
            <DetailRow label="Total artifacts" value={artifacts.count} />
            <DetailRow
              label="Storage consumption"
              value={`${(artifacts.sizeBytes / 1048576).toFixed(1)} MiB`}
            />
          </CardContent>
        </Card>

        {/* 3. Safety Controls */}
        <Card className="rounded-xl border bg-card/80 shadow-2xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>Safety & Circuit Controls</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <DetailRow
              label="Unknown outcomes (historical)"
              value={unknown}
              attention={unknown > 0}
            />
            <DetailRow
              label="Expired active leases"
              value={expiredLeases}
              attention={expiredLeases > 0}
            />
            <DetailRow
              label="Services at circuit threshold"
              value={circuits}
              attention={circuits > 0}
            />
            <DetailRow
              label="Dead-letter results"
              value={deadLetters}
              attention={deadLetters > 0}
            />
          </CardContent>
        </Card>
      </div>

      {/* Agents Requiring Attention Card */}
      <Card className="rounded-xl border bg-card/80 shadow-2xs">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <span>Agents Requiring Operator Attention</span>
            </CardTitle>
            {totalUnhealthy && totalUnhealthy > 20 ? (
              <span className="text-xs text-muted-foreground font-normal">
                Showing first 20 of {totalUnhealthy}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {totalUnhealthy && totalUnhealthy > 20 ? (
            <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                Showing first 20 of {totalUnhealthy} agents requiring attention
              </span>
              <Link
                href="/runbooks/agents?attention=1"
                className="font-medium text-primary hover:underline"
              >
                View all {totalUnhealthy} →
              </Link>
            </div>
          ) : null}
          {unhealthyAgents.map(agent => (
            <Link
              key={agent.id}
              href={`/runbooks/agents?attention=1&q=${encodeURIComponent(agent.name)}`}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border/80 bg-muted/20 p-3 text-xs transition-colors hover:bg-muted/40 hover:border-primary/40"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground text-sm">{agent.name}</span>
                </div>
                <p className="text-muted-foreground text-[11px]">
                  Last heartbeat{' '}
                  {agent.lastHeartbeatAt
                    ? formatDateTime(agent.lastHeartbeatAt, userTimeZone, { format: 'datetime' })
                    : 'never received'}{' '}
                  · {agent.spoolDepth} pending · {agent.deadLetterDepth} dead letter
                </p>
                {agent.lastError && (
                  <p className="font-mono text-destructive text-[11px] break-words pt-1">
                    {agent.lastError}
                  </p>
                )}
              </div>
              <RunbookStatusBadge
                status={resolveEffectiveAgentStatus(agent, now)}
              />
            </Link>
          ))}

          {unhealthyAgents.length === 0 && (
            <EmptyState
              title="No Agent alerts"
              description={
                totalAgentsCount
                  ? `All ${totalAgentsCount} enrolled Agents have registered healthy heartbeats.`
                  : 'No Agents enrolled. Add an outbound Agent to enable host-level execution.'
              }
              size="sm"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DetailRow({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: React.ReactNode;
  attention?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          attention ? 'font-semibold text-destructive' : 'font-medium text-foreground'
        }
      >
        {value}
      </span>
    </div>
  );
}
