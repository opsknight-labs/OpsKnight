import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { assertCapability, getCurrentUser } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { getAppUrl } from '@/lib/app-url';
import { getAgentDistribution } from '@/lib/runbooks/distribution';
import { getExecutionSigningKey } from '@/lib/runbooks/execution-signing';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import AgentSetupInstructions from '@/components/runbooks/AgentSetupInstructions';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { EmptyHint, Pill } from '@/components/runbooks/ui/primitives';
import { Button } from '@/components/ui/shadcn/button';
import {
  ArrowLeft,
  ArrowUpCircle,
  Cpu,
  Info,
  Network,
  Server,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AgentLifecyclePage({ params }: { params: Promise<{ id: string }> }) {
  await assertCapability(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const id = z
    .string()
    .cuid()
    .parse((await params).id);

  const [agent, user] = await Promise.all([
    prisma.runbookAgent.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        hostname: true,
        platform: true,
        version: true,
        lastHeartbeatAt: true,
        createdAt: true,
        poolMemberships: {
          select: { pool: { select: { id: true, name: true, mode: true } } },
        },
      },
    }),
    getCurrentUser(),
  ]);

  if (!agent) notFound();

  const userTimeZone = getUserTimeZone(user);
  const breadcrumbs = [
    { label: 'Runbooks', href: '/runbooks' },
    { label: 'Execution Infrastructure', href: '/runbooks/agents' },
    { label: agent.name, href: '/runbooks/agents' },
    { label: 'Setup & Upgrade' },
  ];

  if (agent.status === 'REVOKED') {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
        <RunbookPageHeader title={`Upgrade ${agent.name}`} breadcrumbs={breadcrumbs} />
        <EmptyHint
          icon={ShieldX}
          title="This identity is revoked. Create a new enrollment to replace it."
          description="Revoked Agents cannot be upgraded in place. Enroll a new Agent with a new deployment name and volume."
          className="bg-card"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/runbooks/agents">Return to Agents</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const [appUrl, distribution, key] = await Promise.all([
    getAppUrl(),
    getAgentDistribution(),
    getExecutionSigningKey(),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      <RunbookPageHeader
        title={`${agent.name} · Agent Lifecycle & Setup`}
        icon={ArrowUpCircle}
        breadcrumbs={breadcrumbs}
        description="Verify container image, Agent-reachable URL, and deployment manifests. Upgrades preserve enrolled identity volumes, local policies, and historical run logs."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5 shadow-2xs">
              <Link href="/runbooks/agents">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>Agent Fleet</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5 shadow-2xs">
              <Link href="/runbooks/agents/security">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>Fleet Security</span>
              </Link>
            </Button>
          </div>
        }
      />

      {/* Hero Agent Identity & Live Metadata Card */}
      <section
        aria-label="Agent Overview"
        className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs p-5 sm:p-6 shadow-xs space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-5">
          <div className="flex items-start gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <Server className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-foreground truncate">
                  {agent.name}
                </h2>
                <RunbookStatusBadge status={agent.status} size="sm" />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                <span>ID: {agent.id}</span>
                <span>·</span>
                <span>
                  Enrolled {formatDateTime(agent.createdAt, userTimeZone, { format: 'date' })}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Pill tone="info" icon={Cpu}>
              {agent.platform || 'Container / Linux'}
            </Pill>
            {agent.poolMemberships.length > 0 && (
              <Pill tone="neutral" icon={Network}>
                {agent.poolMemberships.map(m => m.pool.name).join(', ')}
              </Pill>
            )}
          </div>
        </div>

        {/* Specs Grid */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5">
            <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Hostname
            </dt>
            <dd
              className="mt-1 text-xs font-semibold text-foreground truncate"
              title={agent.hostname || 'Unreported'}
            >
              {agent.hostname || 'Awaiting handshake'}
            </dd>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5">
            <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Version
            </dt>
            <dd className="mt-1 text-xs font-semibold text-foreground">
              {agent.version ? `v${agent.version}` : 'Not reported'}
            </dd>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5">
            <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Heartbeat
            </dt>
            <dd className="mt-1 text-xs font-semibold text-foreground">
              {agent.lastHeartbeatAt
                ? formatDateTime(agent.lastHeartbeatAt, userTimeZone, { format: 'datetime' })
                : 'None recorded'}
            </dd>
          </div>
          <div className="rounded-xl border border-border/50 bg-muted/30 px-3.5 py-2.5">
            <dt className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Pools
            </dt>
            <dd className="mt-1 text-xs font-semibold text-foreground truncate">
              {agent.poolMemberships.length > 0
                ? agent.poolMemberships.map(m => m.pool.name).join(', ')
                : 'Explicit target only'}
            </dd>
          </div>
        </dl>

        {/* Operational Context Banner */}
        <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="leading-relaxed">
            You are managing the deployment for an existing enrolled Agent. Upgrading or restarting
            this Agent keeps its persistent volume, credentials, and execution claims intact. To
            replace a compromised host, revoke this identity from the Fleet table and register a new
            Agent.
          </p>
        </div>
      </section>

      {/* Deployment & Setup Instructions */}
      <AgentSetupInstructions
        agentId={agent.id}
        token=""
        executionPublicKey={key.publicKey}
        appUrl={appUrl}
        distribution={distribution}
        initialOperation="upgrade"
        expiresAt="2000-01-01T00:00:00Z"
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <Link href="/runbooks/agents">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Return to Agent health and diagnostics</span>
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <Link href="/runbooks/agents/pools">
            <Network className="h-4 w-4" aria-hidden="true" />
            <span>Manage Agent Pools</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}
