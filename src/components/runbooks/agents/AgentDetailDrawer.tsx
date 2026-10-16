'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, KeyRound, Terminal } from 'lucide-react';
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
import { Pill } from '../ui/primitives';
import { ActionForm, ConfirmAction, SubmitButton } from '../RunbookControls';
import { formatDateTime } from '@/lib/timezone';
import { revokeAgentAction, updateSchedulingLabelsAction } from '@/app/(app)/runbooks/actions';

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
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="sticky top-0 z-10 space-y-2 border-b bg-background/95 px-6 py-5 pr-16 text-left backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex flex-wrap items-center gap-2">
            <RunbookStatusBadge status={agent.effectiveStatus} size="sm" />
            <span className="truncate font-mono text-[11px] text-muted-foreground select-all">
              {agent.id}
            </span>
          </div>
          <SheetTitle className="text-lg font-semibold tracking-tight">{agent.name}</SheetTitle>
          <SheetDescription className="font-mono text-xs text-muted-foreground">
            {agent.hostname || 'Awaiting enrollment handshake'} ·{' '}
            {agent.platform || 'Platform pending'} · v{agent.version || '—'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 px-6 py-6">
          {/* Diagnostic Error Banner if present */}
          {agent.lastError && (
            <div className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Last reported Agent error</span>
              </div>
              <p className="break-words font-mono text-[11px]">{agent.lastError}</p>
            </div>
          )}

          {/* Quick Fleet Health Grid */}
          <div className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-4 text-xs shadow-xs">
            <div>
              <span className="text-muted-foreground block text-[11px]">Heartbeat</span>
              <span className="font-semibold text-foreground">
                {agent.lastHeartbeatAt
                  ? formatDateTime(agent.lastHeartbeatAt, userTimeZone, { format: 'datetime' })
                  : 'Never received'}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Active jobs</span>
              <span className="font-semibold tabular-nums text-foreground">
                {agent.activeAttemptCount} running
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Queue & spool</span>
              <span className="font-medium tabular-nums text-foreground">
                {agent.spoolDepth} pending · {agent.deadLetterDepth} dead-letter
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[11px]">Pool memberships</span>
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
            <h4 className="flex items-center gap-1.5 text-sm font-semibold">
              <Terminal className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>Runtime capabilities & readiness</span>
            </h4>

            {/* Configured Capabilities Pills */}
            <div className="flex flex-wrap gap-1.5" aria-label="Configured capabilities">
              {Array.isArray(agent.capabilities) &&
                agent.capabilities
                  .filter((v): v is string => typeof v === 'string')
                  .map(v => (
                    <Badge
                      key={v}
                      variant="outline"
                      className="rounded-full bg-muted/40 font-mono text-[10px] font-medium"
                    >
                      {v.replace('RUNBOOK_', '').replaceAll('_', ' ')}
                    </Badge>
                  ))}
            </div>

            {/* Detailed capability breakdown rows */}
            {Array.isArray(agent.capabilityReport) && agent.capabilityReport.length > 0 ? (
              <div className="divide-y rounded-xl border bg-card">
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
                        <span className="font-semibold text-foreground">
                          {String(e.name || 'Runtime')}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Pill tone="neutral">
                            {e.configured ? 'Configured' : 'Not configured'}
                          </Pill>
                          <Pill tone={e.available ? 'success' : 'warning'}>
                            {e.available ? 'Available' : 'Unavailable'}
                          </Pill>
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
              <p className="text-xs text-muted-foreground">
                No granular capability report registered by Agent.
              </p>
            )}
          </div>

          {/* Trusted Signing Identities */}
          <div className="space-y-2 rounded-xl border bg-muted/30 p-4 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span>Trusted signing identities</span>
            </div>
            <div className="break-all font-mono text-[11px] text-muted-foreground">
              {Array.isArray(agent.trustedSigningKeys) && agent.trustedSigningKeys.length > 0
                ? agent.trustedSigningKeys
                    .filter((k): k is string => typeof k === 'string')
                    .join(', ')
                : 'No rotation acknowledgement recorded'}
            </div>
          </div>

          {/* Scheduling Labels Editor */}
          {canManage && (
            <details className="group rounded-xl border bg-card p-4 text-xs">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span>Scheduling labels</span>
                <span className="text-[11px] font-medium text-primary group-open:hidden">Edit</span>
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

          {canManage && agent.status !== 'REVOKED' && (
            <Link
              href={`/runbooks/agents/${agent.id}/setup`}
              className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Upgrade installed Agent · preserve identity
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          )}
          {/* Revoke Agent Security Guard */}
          {canManage && agent.status !== 'REVOKED' && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold text-foreground">Revoke this Agent</p>
                <p className="text-xs text-muted-foreground">
                  Removes execution authority immediately. This cannot be undone.
                </p>
              </div>
              <ConfirmAction
                action={revokeAgentAction.bind(null, agent.id)}
                title={`Revoke ${agent.name}?`}
                description="The Agent immediately loses execution authority. Running actions can no longer renew their lease and will self-fence."
                label="Revoke Agent"
                variant="destructive"
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
