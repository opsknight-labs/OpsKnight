'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRunbookRefresh } from '../useRunbookRefresh';
import { AlertTriangle, Bot, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import { EmptyHint } from '../ui/primitives';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { AgentCapabilitySummary } from './AgentCapabilitySummary';
import { AgentDetailDrawer, type AgentItemData } from './AgentDetailDrawer';
import { formatDateTime } from '@/lib/timezone';

export type AgentFleetTableProps = {
  agents: AgentItemData[];
  userTimeZone: string;
  canManage: boolean;
  filtered?: boolean;
};

const STATUS_DOT = new Map([
  ['ONLINE', 'bg-emerald-500'],
  ['DEGRADED', 'bg-amber-500'],
  ['OFFLINE', 'bg-rose-500'],
  ['ENROLLING', 'bg-sky-500'],
  ['REVOKED', 'bg-muted-foreground/50'],
]);

function unavailableReasons(report: unknown): string[] {
  if (!Array.isArray(report)) return [];
  return report.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const item = entry as { configured?: boolean; available?: boolean; reason?: string };
    // Only flag as an issue if the capability was configured by policy but failed runtime detection
    return item.configured && !item.available && item.reason ? [item.reason] : [];
  });
}

function labelChips(labels: unknown): Array<[string, string]> {
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return [];
  return Object.entries(labels).map(([key, value]) => [key, String(value)]);
}

function capabilityCount(capabilities: unknown) {
  return Array.isArray(capabilities)
    ? capabilities.filter(value => typeof value === 'string').length
    : 0;
}

function poolSummary(agent: AgentItemData) {
  const names = agent.poolMemberships.map(member => member.pool.name).join(', ') || 'None';
  const extra =
    agent.totalPoolCount && agent.totalPoolCount > agent.poolMemberships.length
      ? ` (+${agent.totalPoolCount - agent.poolMemberships.length} more)`
      : '';
  return names + extra;
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        STATUS_DOT.get(status) ?? 'bg-muted-foreground/50'
      )}
    />
  );
}

function Heartbeat({ value, userTimeZone }: { value: string | null; userTimeZone: string }) {
  if (!value) return <span className="text-muted-foreground">Never</span>;
  return (
    <time
      dateTime={value}
      title={formatDateTime(value, userTimeZone, { format: 'datetime' })}
      suppressHydrationWarning
    >
      {formatDateTime(value, userTimeZone, { format: 'relative' })}
    </time>
  );
}

function LabelChips({ labels, max = 3 }: { labels: unknown; max?: number }) {
  const chips = labelChips(labels);
  if (chips.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.slice(0, max).map(([key, value]) => (
        <span
          key={key}
          className="max-w-[10rem] truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
        >
          {key}={value}
        </span>
      ))}
      {chips.length > max && (
        <span className="self-center text-[10px] text-muted-foreground">+{chips.length - max}</span>
      )}
    </div>
  );
}

export function AgentFleetTable({
  agents,
  userTimeZone,
  canManage,
  filtered = true,
}: AgentFleetTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedAgent = agents.find(agent => agent.id === selectedId) ?? null;
  const router = useRouter();
  useRunbookRefresh(router, { enabled: true, refreshOnFocus: true });

  if (agents.length === 0) {
    return (
      <EmptyHint
        icon={Bot}
        title={filtered ? 'No Agents match these filters' : 'No active Agents'}
        description={
          filtered
            ? 'Adjust or reset the filters to see the rest of the fleet.'
            : 'Revoked Agents are hidden. Filter by the Revoked status to review them.'
        }
        className="bg-card"
      />
    );
  }

  return (
    <div>
      <div className="hidden overflow-x-auto rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs lg:block">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Agent fleet</caption>
          <thead className="border-b border-border/60 bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              {[
                'Agent',
                'Status',
                'Version · Platform',
                'Labels',
                'Last heartbeat',
                'Capabilities',
                'Workload',
                'Pools',
              ].map(title => (
                <th className="px-4 py-2.5 font-medium" key={title} scope="col">
                  {title}
                </th>
              ))}
              <th className="px-4 py-2.5 text-right font-medium" scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {agents.map(agent => {
              const reasons = unavailableReasons(agent.capabilityReport);
              const caps = capabilityCount(agent.capabilities);
              return (
                <tr
                  key={agent.id}
                  onClick={() => setSelectedId(agent.id)}
                  className={cn(
                    'cursor-pointer align-top transition-colors hover:bg-muted/30',
                    selectedId === agent.id && 'bg-primary/5'
                  )}
                >
                  <td className="max-w-[18rem] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot status={agent.effectiveStatus} />
                      <button
                        type="button"
                        onClick={event => {
                          event.stopPropagation();
                          setSelectedId(agent.id);
                        }}
                        className="truncate rounded-sm text-sm font-semibold text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {agent.name}
                      </button>
                    </div>
                    <p className="mt-0.5 truncate pl-4 font-mono text-[11px] text-muted-foreground">
                      {agent.hostname || 'Not reported'}
                    </p>
                    {reasons.map((reason, index) => (
                      <p
                        key={index}
                        className="mt-1 flex items-start gap-1 pl-4 text-[11px] text-amber-700 dark:text-amber-400"
                      >
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>{reason}</span>
                      </p>
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    <RunbookStatusBadge status={agent.effectiveStatus} size="sm" />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-foreground">
                      {agent.version ? `v${agent.version}` : 'Not reported'}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {agent.platform || 'Not reported'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <LabelChips labels={agent.labels} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Heartbeat value={agent.lastHeartbeatAt} userTimeZone={userTimeZone} />
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {caps > 0 ? (
                      `${caps} configured`
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                    <span className="text-foreground">{agent.activeAttemptCount} running</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {agent.spoolDepth} spooled ·{' '}
                      <span
                        className={cn(
                          agent.deadLetterDepth > 0 &&
                            'font-medium text-rose-600 dark:text-rose-400'
                        )}
                      >
                        {agent.deadLetterDepth} dead-letter
                      </span>
                    </span>
                  </td>
                  <td className="max-w-[12rem] truncate px-4 py-3" title={poolSummary(agent)}>
                    {poolSummary(agent)}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={event => event.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedId(agent.id)}
                      className="h-8 gap-1 text-xs"
                    >
                      Inspect Agent
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-3 lg:hidden">
        {agents.map(agent => {
          const reasons = unavailableReasons(agent.capabilityReport);
          return (
            <li
              key={agent.id}
              className="space-y-3.5 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-5 shadow-xs transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusDot status={agent.effectiveStatus} />
                    <h3 className="truncate !text-sm !leading-snug font-semibold text-foreground">
                      {agent.name}
                    </h3>
                  </div>
                  <p className="mt-0.5 truncate pl-4 font-mono text-[11px] text-muted-foreground">
                    {agent.hostname || 'Awaiting enrollment handshake'}
                  </p>
                </div>
                <RunbookStatusBadge status={agent.effectiveStatus} size="sm" />
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                <div className="min-w-0">
                  <dt className="text-[11px] text-muted-foreground">Version · Platform</dt>
                  <dd className="truncate font-medium text-foreground">
                    {agent.version ? `v${agent.version}` : 'Not reported'} ·{' '}
                    {agent.platform || 'Not reported'}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[11px] text-muted-foreground">Last heartbeat</dt>
                  <dd className="truncate font-medium text-foreground">
                    <Heartbeat value={agent.lastHeartbeatAt} userTimeZone={userTimeZone} />
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[11px] text-muted-foreground">Pools</dt>
                  <dd className="truncate font-medium text-foreground">{poolSummary(agent)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-[11px] text-muted-foreground">Workload</dt>
                  <dd className="truncate font-medium tabular-nums text-foreground">
                    {agent.activeAttemptCount} running · {agent.deadLetterDepth} dead-letter
                  </dd>
                </div>
              </dl>

              <div className="space-y-1.5">
                <span className="text-[11px] text-muted-foreground">Capabilities</span>
                <AgentCapabilitySummary capabilities={agent.capabilities} />
              </div>
              <LabelChips labels={agent.labels} max={4} />

              {reasons.map((reason, index) => (
                <p
                  key={index}
                  className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400"
                >
                  <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{reason}</span>
                </p>
              ))}
              {agent.lastError && (
                <p className="break-words rounded-lg border border-destructive/20 bg-destructive/5 p-2.5 font-mono text-[11px] text-destructive">
                  {agent.lastError}
                </p>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedId(agent.id)}
                className="h-8 w-full gap-1 text-xs"
              >
                Inspect Agent
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>

      <AgentDetailDrawer
        agent={selectedAgent}
        open={Boolean(selectedAgent)}
        onOpenChange={open => !open && setSelectedId(null)}
        userTimeZone={userTimeZone}
        canManage={canManage}
      />
    </div>
  );
}
