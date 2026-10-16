'use client';

import React from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Cpu,
  KeyRound,
  Layers,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
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
import { ActionForm, ConfirmAction, SubmitButton } from '../RunbookControls';
import { formatDateTime } from '@/lib/timezone';
import { revokeAgentAction, updateSchedulingLabelsAction } from '@/app/(app)/runbooks/actions';
import { cn } from '@/lib/utils';

function getCapabilityIcon(type?: string) {
  switch (type) {
    case 'KUBERNETES':
      return <Boxes className="h-4 w-4 text-emerald-500" aria-hidden="true" />;
    case 'DOCKER':
    case 'PODMAN':
      return <Layers className="h-4 w-4 text-blue-500" aria-hidden="true" />;
    case 'SYSTEMD':
      return <Cpu className="h-4 w-4 text-violet-500" aria-hidden="true" />;
    case 'BASH':
      return <Terminal className="h-4 w-4 text-amber-500" aria-hidden="true" />;
    case 'LINUX_DIAGNOSTICS':
      return <Activity className="h-4 w-4 text-teal-500" aria-hidden="true" />;
    default:
      return <Server className="h-4 w-4 text-primary" aria-hidden="true" />;
  }
}

function getCapabilityDescription(type?: string, name?: string) {
  switch (type) {
    case 'KUBERNETES':
      return 'Orchestrate in-cluster workloads, scale deployments, rollout status & pod telemetry.';
    case 'DOCKER':
      return 'Manage containers, inspect runtime health, read logs, and restart services.';
    case 'PODMAN':
      return 'Manage rootless containers and query container pod state.';
    case 'SYSTEMD':
      return 'Inspect service unit state, start, stop, and restart host services.';
    case 'BASH':
      return 'Execute shell commands constrained by local allowlist regex patterns.';
    case 'LINUX_DIAGNOSTICS':
      return 'Read-only host diagnostics for CPU, memory, disk, network, and journal logs.';
    default:
      return `Runtime executor capability for ${name || 'actions'}.`;
  }
}

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
                  ? formatDateTime(agent.lastHeartbeatAt, userTimeZone, {
                      format: 'datetime',
                      includeTimeZone: true,
                    })
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

          {/* Runtime Environment & Capabilities Section */}
          {(() => {
            const report = Array.isArray(agent.capabilityReport)
              ? agent.capabilityReport.filter(
                  (
                    entry
                  ): entry is {
                    name: string;
                    type: string;
                    configured: boolean;
                    available: boolean;
                    reason?: string | null;
                  } => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))
                )
              : [];

            const activeCapabilities = report.filter(e => e.configured && e.available);
            const unavailableCapabilities = report.filter(e => e.configured && !e.available);
            const outOfScopeCapabilities = report.filter(e => !e.configured);

            const hasK8s =
              activeCapabilities.some(e => e.type === 'KUBERNETES') ||
              (Array.isArray(agent.capabilities) &&
                agent.capabilities.includes('RUNBOOK_KUBERNETES'));
            const hasDocker =
              activeCapabilities.some(e => e.type === 'DOCKER') ||
              (Array.isArray(agent.capabilities) &&
                (agent.capabilities.includes('RUNBOOK_DOCKER_RUNTIME') ||
                  agent.capabilities.includes('RUNBOOK_DOCKER')));
            const hasSystemd =
              activeCapabilities.some(e => e.type === 'SYSTEMD') ||
              (Array.isArray(agent.capabilities) && agent.capabilities.includes('RUNBOOK_SYSTEMD'));

            const runtimeEnv = hasK8s
              ? {
                  title: 'Kubernetes Cluster (In-Cluster Pod)',
                  badge: 'Kubernetes',
                  icon: <Boxes className="h-3.5 w-3.5 text-emerald-500" />,
                  badgeClassName:
                    'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  description:
                    'Running as a containerized pod inside a Kubernetes cluster with direct API access and in-cluster ServiceAccount authentication.',
                }
              : hasDocker
                ? {
                    title: 'Docker Container Host',
                    badge: 'Docker Host',
                    icon: <Layers className="h-3.5 w-3.5 text-blue-500" />,
                    badgeClassName:
                      'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
                    description:
                      'Connected to local Docker daemon socket (/var/run/docker.sock) for container lifecycle and health management.',
                  }
                : hasSystemd
                  ? {
                      title: 'Native Linux Host (Systemd)',
                      badge: 'Systemd Host',
                      icon: <Cpu className="h-3.5 w-3.5 text-violet-500" />,
                      badgeClassName:
                        'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
                      description:
                        'Running directly on a Linux host with systemd service unit management capabilities.',
                    }
                  : {
                      title: `${agent.platform || 'Linux'} Agent Host`,
                      badge: 'Agent Host',
                      icon: <Server className="h-3.5 w-3.5 text-primary" />,
                      badgeClassName:
                        'border-muted-foreground/30 bg-muted/40 text-muted-foreground',
                      description: 'Standard runtime execution agent.',
                    };

            return (
              <div className="space-y-4">
                {/* Runtime Environment Identity Card */}
                <div className="rounded-xl border bg-card/60 p-4 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Hosting Environment
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'font-mono text-[10px] font-semibold gap-1.5',
                        runtimeEnv.badgeClassName
                      )}
                    >
                      {runtimeEnv.icon}
                      <span>{runtimeEnv.badge}</span>
                    </Badge>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      {runtimeEnv.title}
                    </h4>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {runtimeEnv.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50 text-[11px] font-mono text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground/70">Node/Host:</span>
                      <span className="text-foreground">{agent.hostname || 'Unknown'}</span>
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground/70">OS:</span>
                      <span className="text-foreground">{agent.platform || 'Linux'}</span>
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-muted-foreground/70">Agent:</span>
                      <span className="text-foreground">v{agent.version || '2.0.0'}</span>
                    </span>
                  </div>
                </div>

                {/* Active Capabilities Header & Cards */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Terminal className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      <span>Active Capabilities ({activeCapabilities.length})</span>
                    </h4>
                    <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-medium">
                      {activeCapabilities.length > 0
                        ? 'Policy & Runtime Verified'
                        : 'No Active Capabilities'}
                    </span>
                  </div>

                  {activeCapabilities.length > 0 ? (
                    <div className="space-y-2">
                      {activeCapabilities.map((e, index) => (
                        <div
                          key={index}
                          className="rounded-xl border bg-card p-3 shadow-2xs space-y-1.5 hover:border-border transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60 text-foreground ring-1 ring-border/50">
                                {getCapabilityIcon(e.type)}
                              </div>
                              <span className="font-semibold text-xs text-foreground">
                                {String(e.name || 'Runtime')}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Available</span>
                              </span>
                            </div>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-normal pl-9">
                            {getCapabilityDescription(e.type, e.name)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                      No active capabilities available on this agent.
                    </div>
                  )}
                </div>

                {/* Configured but Unavailable Warning (if any) */}
                {unavailableCapabilities.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Configuration Warnings ({unavailableCapabilities.length})</span>
                    </h4>
                    <div className="space-y-2">
                      {unavailableCapabilities.map((e, index) => (
                        <div
                          key={index}
                          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between font-semibold text-foreground">
                            <div className="flex items-center gap-1.5">
                              {getCapabilityIcon(e.type)}
                              <span>{e.name}</span>
                            </div>
                            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300 font-medium">
                              Binary Unavailable
                            </span>
                          </div>
                          <p className="text-[11px] text-amber-800 dark:text-amber-300 font-mono">
                            {e.reason ||
                              'Configured in policy, but binary or daemon access is unavailable.'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Out-of-Scope / Policy Disabled Capabilities (Collapsed Disclosure) */}
                {outOfScopeCapabilities.length > 0 && (
                  <details className="group rounded-xl border bg-muted/20 p-3 text-xs">
                    <summary className="flex cursor-pointer items-center justify-between font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground/80" />
                        <span>
                          {outOfScopeCapabilities.length} unconfigured{' '}
                          {outOfScopeCapabilities.length === 1 ? 'capability' : 'capabilities'} (
                          {outOfScopeCapabilities.map(e => e.name).join(', ')})
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground/70 group-open:hidden">
                        Show
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground/70 hidden group-open:inline">
                        Hide
                      </span>
                    </summary>
                    <div className="mt-2.5 divide-y divide-border/40 border-t border-border/40 pt-2 space-y-1">
                      <p className="text-[10px] text-muted-foreground mb-1.5">
                        These capabilities are intentionally disabled in this agent&apos;s local
                        policy configuration:
                      </p>
                      {outOfScopeCapabilities.map((e, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between py-1.5 text-[11px]"
                        >
                          <div className="flex items-center gap-2 text-foreground font-mono">
                            <span className="text-muted-foreground">•</span>
                            <span>{e.name}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            Disabled by local policy
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })()}

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
