'use client';

import React from 'react';
import { AlertTriangle, KeyRound, Terminal } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/shadcn/sheet';
import { Badge } from '@/components/ui/shadcn/badge';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { RunbookStatusBadge } from '../RunbookStatusBadge';
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

export type AgentItemData = {
  id: string;
  name: string;
  hostname: string | null;
  status: string;
  effectiveStatus: string;
  platform: string | null;
  version: string | null;
  lastHeartbeatAt: string | null;
  capabilities: unknown;
  capabilityReport: unknown;
  labels: unknown;
  poolMemberships: Array<{ pool: { id: string; name: string } }>;
  activeAttemptCount: number;
  spoolDepth: number;
  deadLetterDepth: number;
  trustedSigningKeys: unknown;
  lastError: string | null;
  totalPoolCount?: number;
};

export type AgentDetailDrawerProps = {
  agent: AgentItemData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userTimeZone: string;
  canManage: boolean;
};

export function AgentDetailDrawer({
  agent,
  open,
  onOpenChange,
  userTimeZone,
  canManage,
}: AgentDetailDrawerProps) {
  if (!agent) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-6 space-y-6">
        <SheetHeader className="space-y-2 pb-4 border-b">
          <div className="flex items-center justify-between gap-3">
            <RunbookStatusBadge status={agent.effectiveStatus} />
            <span className="font-mono text-xs text-muted-foreground select-all">{agent.id}</span>
          </div>
          <SheetTitle className="text-xl font-bold tracking-tight">{agent.name}</SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {agent.hostname || 'Awaiting enrollment handshake'} · {agent.platform || 'Platform pending'} · v{agent.version || '—'}
          </SheetDescription>
        </SheetHeader>

        {/* Diagnostic Error Banner if present */}
        {agent.lastError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Last Reported Agent Error</span>
            </div>
            <p className="break-words font-mono text-[11px]">{agent.lastError}</p>
          </div>
        )}

        {/* Quick Fleet Health Grid */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3.5 text-xs">
          <div>
            <span className="text-muted-foreground block text-[11px]">Heartbeat</span>
            <span className="font-semibold text-foreground">
              {agent.lastHeartbeatAt
                ? formatDateTime(agent.lastHeartbeatAt, userTimeZone, { format: 'datetime' })
                : 'Never received'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Active Jobs</span>
            <span className="font-semibold text-foreground">{agent.activeAttemptCount} running</span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Queue & Spool</span>
            <span className="font-medium text-foreground">
              {agent.spoolDepth} pending · {agent.deadLetterDepth} dead-letter
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Pool Memberships</span>
            <span className="font-medium text-foreground">
              {agent.poolMemberships.map(p => p.pool.name).join(', ') || 'No pools'}
              {agent.totalPoolCount && agent.totalPoolCount > agent.poolMemberships.length ? (
                <span className="text-muted-foreground text-[10px] ml-1">
                  (+{agent.totalPoolCount - agent.poolMemberships.length} more)
                </span>
              ) : null}
            </span>
          </div>
        </div>

        {/* Runtime Capability Report */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-1.5">
            <Terminal className="h-4 w-4 text-primary" />
            <span>Runtime Capabilities & Readiness</span>
          </h4>

          {/* Configured Capabilities Pills */}
          <div className="flex flex-wrap gap-1.5" aria-label="Configured capabilities">
            {Array.isArray(agent.capabilities) &&
              agent.capabilities
                .filter((v): v is string => typeof v === 'string')
                .map(v => (
                  <Badge key={v} variant="outline" className="text-xs">
                    {v.replace('RUNBOOK_', '').replaceAll('_', ' ')}
                  </Badge>
                ))}
          </div>

          {/* Detailed capability breakdown rows */}
          {Array.isArray(agent.capabilityReport) && agent.capabilityReport.length > 0 ? (
            <div className="rounded-lg border bg-card divide-y">
              {agent.capabilityReport.map((entry, index) => {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
                const e = entry as {
                  name?: string;
                  type?: string;
                  configured?: boolean;
                  available?: boolean;
                  reason?: string;
                };
                return (
                  <div key={index} className="p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{String(e.name || 'Runtime')}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          configured {e.configured ? '✓' : '—'}
                        </span>
                        <span
                          className={
                            e.available
                              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                              : 'text-amber-600 dark:text-amber-400 font-medium'
                          }
                        >
                          available {e.available ? '✓' : '—'}
                        </span>
                      </div>
                    </div>
                    {e.reason && (
                      <p className="text-muted-foreground text-[11px] font-mono break-words">
                        {e.reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              No granular capability report registered by Agent.
            </p>
          )}
        </div>

        {/* Trusted Signing Identities */}
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3.5 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span>Trusted Signing Identities</span>
          </div>
          <div className="break-all font-mono text-[11px] text-muted-foreground">
            {Array.isArray(agent.trustedSigningKeys) && agent.trustedSigningKeys.length > 0
              ? agent.trustedSigningKeys.filter((k): k is string => typeof k === 'string').join(', ')
              : 'No rotation acknowledgement recorded'}
          </div>
        </div>

        {/* Scheduling Labels Editor */}
        {canManage && (
          <details className="rounded-lg border bg-card p-3.5 text-xs group">
            <summary className="cursor-pointer font-semibold text-foreground list-none flex items-center justify-between">
              <span>Scheduling labels</span>
              <span className="text-muted-foreground text-[11px] group-open:hidden">Edit</span>
            </summary>
            <div className="pt-3">
              <ActionForm action={updateSchedulingLabelsAction}>
                <input type="hidden" name="id" value={agent.id} />
                <input type="hidden" name="kind" value="agent" />
                <Textarea
                  name="labels"
                  aria-label={`Labels for ${agent.name}`}
                  defaultValue={JSON.stringify(agent.labels)}
                  className="font-mono text-xs min-h-[70px]"
                />
                <div className="mt-2.5 flex justify-end">
                  <SubmitButton size="sm">Save scheduling labels</SubmitButton>
                </div>
              </ActionForm>
            </div>
          </details>
        )}

        {/* Revoke Agent Security Guard */}
        {canManage && agent.status !== 'REVOKED' && (
          <div className="pt-4 border-t">
            <ConfirmAction
              action={revokeAgentAction.bind(null, agent.id)}
              title={`Revoke ${agent.name}?`}
              description="The Agent immediately loses execution authority. Running actions can no longer renew their lease and will self-fence."
              label="Revoke Agent"
              variant="destructive"
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
