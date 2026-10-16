import React from 'react';
import { resolveEffectiveAgentStatus } from '@/lib/runbooks/presentation/contracts';
import type { RunbookAgentStatus } from '@prisma/client';
import Link from 'next/link';
import { Bot, CheckCircle2, HardDrive, ShieldCheck, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyHint, SectionCard } from '../ui/primitives';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
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
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <SectionCard icon={Terminal} title="Execution plane" bodyClassName="space-y-0 p-0">
          <dl className="divide-y text-xs">
            {(() => {
              const runbookWorkerError =
                localWorker.running &&
                (localWorker.lane === 'runbook'
                  ? localWorker.lastError
                  : localWorker.lastRunbookError);
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
          </dl>
          <p className="border-t px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
            In split deployments web processes do not observe dedicated background runners. Monitor
            readiness endpoints independently.
          </p>
        </SectionCard>

        <SectionCard icon={HardDrive} title="Queue & artifact storage" bodyClassName="p-0">
          <dl className="divide-y text-xs">
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
          </dl>
        </SectionCard>

        <SectionCard icon={ShieldCheck} title="Safety & circuit controls" bodyClassName="p-0">
          <dl className="divide-y text-xs">
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
          </dl>
        </SectionCard>
      </div>

      <SectionCard icon={Bot} title="Agents requiring operator attention" bodyClassName="space-y-3">
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
        {unhealthyAgents.length > 0 && (
          <ul className="divide-y overflow-hidden rounded-lg border">
            {unhealthyAgents.map(agent => (
              <li key={agent.id}>
                <Link
                  href={`/runbooks/agents?attention=1&q=${encodeURIComponent(agent.name)}`}
                  className="flex flex-col justify-between gap-3 p-3 text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 space-y-1">
                    <span className="text-sm font-semibold text-foreground">{agent.name}</span>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      Last heartbeat{' '}
                      {agent.lastHeartbeatAt
                        ? formatDateTime(agent.lastHeartbeatAt, userTimeZone, {
                            format: 'datetime',
                          })
                        : 'never received'}{' '}
                      · {agent.spoolDepth} pending · {agent.deadLetterDepth} dead letter
                    </p>
                    {agent.lastError && (
                      <p className="break-words font-mono text-[11px] text-destructive">
                        {agent.lastError}
                      </p>
                    )}
                  </div>
                  <RunbookStatusBadge status={resolveEffectiveAgentStatus(agent, now)} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {unhealthyAgents.length === 0 && (
          <EmptyHint
            icon={CheckCircle2}
            title="No Agent alerts"
            description={
              totalAgentsCount
                ? `All ${totalAgentsCount} enrolled Agents have registered healthy heartbeats.`
                : 'No Agents enrolled. Add an outbound Agent to enable host-level execution.'
            }
          />
        )}
      </SectionCard>
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
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'flex items-center gap-1.5 text-right tabular-nums',
          attention ? 'font-semibold text-destructive' : 'font-medium text-foreground'
        )}
      >
        {attention && (
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
        )}
        {value}
      </dd>
    </div>
  );
}
