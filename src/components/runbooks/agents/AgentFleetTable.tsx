'use client';

import React, { useState } from 'react';
import { Bot, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Textarea } from '@/components/ui/shadcn/textarea';
import EmptyState from '@/components/ui/EmptyState';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
import { AgentCapabilitySummary } from './AgentCapabilitySummary';
import {
  AgentDetailDrawer,
  type AgentItemData,
} from './AgentDetailDrawer';
import {
  ActionForm,
  ConfirmAction,
  SubmitButton,
} from '../RunbookControls';
import { formatDateTime } from '@/lib/timezone';
import {
  revokeAgentAction,
  updateSchedulingLabelsAction,
} from '@/app/(app)/runbooks/actions';

export type AgentFleetTableProps = {
  agents: AgentItemData[];
  userTimeZone: string;
  canManage: boolean;
};

export function AgentFleetTable({ agents, userTimeZone, canManage }: AgentFleetTableProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentItemData | null>(null);

  return (
    <div className="space-y-4">
      {/* High-density fleet list/cards */}
      <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {agents.map(agent => {
          const isRevoked = agent.status === 'REVOKED';

          return (
            <div
              key={agent.id}
              className="flex flex-col justify-between rounded-xl border bg-card/80 p-4 shadow-2xs transition-all hover:bg-card hover:border-primary/40 space-y-3.5"
            >
              {/* Header: Name, Host, Status */}
              <div className="flex items-start justify-between gap-2.5">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-sm sm:text-base tracking-tight text-foreground truncate">
                      {agent.name}
                    </h3>
                    <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                      v{agent.version || '2.0.0'}
                    </Badge>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground truncate">
                    {agent.hostname || 'Awaiting enrollment handshake'}
                  </p>
                </div>
                <RunbookStatusBadge status={agent.effectiveStatus} />
              </div>

              {/* Core Fleet Metrics */}
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/20 p-2.5 text-xs text-muted-foreground">
                <div>
                  <span className="text-[11px] block">Platform / Host</span>
                  <span className="font-medium text-foreground truncate block">
                    {agent.platform || 'Linux'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] block">Heartbeat</span>
                  <span className="font-medium text-foreground truncate block">
                    {agent.lastHeartbeatAt
                      ? formatDateTime(agent.lastHeartbeatAt, userTimeZone, { format: 'datetime' })
                      : 'Never'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] block">Pools</span>
                  <span className="font-medium text-foreground truncate block">
                    {agent.poolMemberships.map(p => p.pool.name).join(', ') || 'None'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] block">Jobs & Spool</span>
                  <span className="font-medium text-foreground truncate block">
                    {agent.activeAttemptCount} running · {agent.deadLetterDepth} dead-letter
                  </span>
                </div>
              </div>

              {/* Capabilities Bar */}
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">Capabilities</span>
                <AgentCapabilitySummary capabilities={agent.capabilities} />
              </div>

              {/* Granular capability diagnostics report (if present) */}
              {Array.isArray(agent.capabilityReport) && agent.capabilityReport.length > 0 && (
                <div className="rounded-lg border bg-muted/40 p-2.5 space-y-1 text-xs">
                  {agent.capabilityReport.map((entry, index) => {
                    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
                    const e = entry as {
                      name?: string;
                      configured?: boolean;
                      available?: boolean;
                      reason?: string;
                    };
                    return (
                      <p key={index} className="text-xs font-mono text-muted-foreground">
                        {String(e.name || 'Runtime')} · configured {e.configured ? '✓' : '—'} · available{' '}
                        {e.available ? '✓' : '—'} {e.reason ? `· ${e.reason}` : ''}
                      </p>
                    );
                  })}
                </div>
              )}

              {/* Error indicator */}
              {agent.lastError && (
                <p className="break-words rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive font-mono">
                  {agent.lastError}
                </p>
              )}

              {/* Scheduling labels accordion */}
              {canManage && (
                <details className="rounded-lg border bg-card p-2.5 text-xs">
                  <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                    Scheduling labels
                  </summary>
                  <div className="pt-2">
                    <ActionForm action={updateSchedulingLabelsAction}>
                      <input type="hidden" name="id" value={agent.id} />
                      <input type="hidden" name="kind" value="agent" />
                      <Textarea
                        name="labels"
                        aria-label={`Labels for ${agent.name}`}
                        defaultValue={JSON.stringify(agent.labels)}
                        className="font-mono text-xs min-h-[60px]"
                      />
                      <div className="mt-2 flex justify-end">
                        <SubmitButton size="sm">Save scheduling labels</SubmitButton>
                      </div>
                    </ActionForm>
                  </div>
                </details>
              )}

              {/* Actions Footer */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedAgent(agent)}
                  className="h-8 text-xs gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>Inspect Agent</span>
                </Button>

                {canManage && !isRevoked && (
                  <ConfirmAction
                    action={revokeAgentAction.bind(null, agent.id)}
                    title={`Revoke ${agent.name}?`}
                    description="The Agent immediately loses execution authority. Running actions can no longer renew their lease and will self-fence."
                    label="Revoke Agent"
                    variant="destructive"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {agents.length === 0 && (
        <EmptyState
          icon={<Bot />}
          title="No Agents enrolled"
          description="Enroll an outbound Agent to enable diagnostic collection and safe remediation."
        />
      )}

      {/* Slide-over Agent Detail Drawer */}
      <AgentDetailDrawer
        agent={selectedAgent}
        open={Boolean(selectedAgent)}
        onOpenChange={open => !open && setSelectedAgent(null)}
        userTimeZone={userTimeZone}
        canManage={canManage}
      />
    </div>
  );
}
