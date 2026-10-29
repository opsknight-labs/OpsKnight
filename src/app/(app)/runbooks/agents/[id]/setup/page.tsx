import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { assertCapability, getCurrentUser } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { getAppUrl } from '@/lib/app-url';
import { getAgentDistribution } from '@/lib/runbooks/distribution';
import { getExecutionSigningKey } from '@/lib/runbooks/execution-signing';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import AgentSetupInstructions from '@/components/runbooks/AgentSetupInstructions';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/shadcn/alert';
import { EmptyHint } from '@/components/runbooks/ui/primitives';
import {
  ArrowLeft,
  Activity,
  Cpu,
  Info,
  Network,
  Server,
  ShieldCheck,
  ShieldX,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AgentLifecyclePage({ params }: { params: Promise<{ id: string }> }) {
  await assertCapability(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const id = z
    .string()
    .cuid()
    .parse((await params).id);

  const [agent, user, navigation] = await Promise.all([
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
    getRunbookNavigationSummary(),
  ]);

  if (!agent) notFound();

  const userTimeZone = getUserTimeZone(user);

  if (agent.status === 'REVOKED') {
    return (
      <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
        <DetailHeroBanner
          breadcrumb={{
            label: 'Agent Fleet',
            href: '/runbooks/agents',
            current: agent.name,
          }}
          tag="Execution Infrastructure"
          title={agent.name}
          icon={
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
              <Server className="h-6 w-6" aria-hidden="true" />
            </div>
          }
          badges={
            <Badge variant="danger" size="xs" className="uppercase font-bold text-[10px] gap-1">
              <XCircle className="h-3 w-3" />
              Revoked
            </Badge>
          }
          actions={
            <Button
              asChild
              variant="outline"
              size="sm"
              className="bg-zinc-800/80 text-white border-zinc-700 hover:bg-zinc-700 text-xs gap-1.5 h-8"
            >
              <Link href="/runbooks/agents">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Return to Fleet</span>
              </Link>
            </Button>
          }
        />
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
      </main>
    );
  }

  const [appUrl, distribution, key] = await Promise.all([
    getAppUrl(),
    getAgentDistribution(),
    getExecutionSigningKey(),
  ]);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Centralized Flagship Hero Banner matching Services and Settings */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Agent Fleet',
          href: '/runbooks/agents',
          current: agent.name,
        }}
        tag="Execution Infrastructure"
        title={agent.name}
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Server className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        badges={
          <>
            <Badge
              variant={
                agent.status === 'ONLINE'
                  ? 'success'
                  : agent.status === 'DEGRADED'
                    ? 'warning'
                    : 'neutral'
              }
              size="xs"
              className="uppercase font-bold text-[10px] gap-1"
            >
              {agent.status === 'ONLINE' && <CheckCircle2 className="h-3 w-3" />}
              {agent.status === 'DEGRADED' && <AlertTriangle className="h-3 w-3" />}
              {agent.status === 'OFFLINE' && <XCircle className="h-3 w-3" />}
              <span>{agent.status}</span>
            </Badge>

            <Badge
              variant="outline"
              size="xs"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px]"
            >
              <Cpu className="h-3 w-3 mr-1" />
              <span>{agent.platform || 'Container / Linux'}</span>
            </Badge>

            {agent.version && (
              <Badge
                variant="outline"
                size="xs"
                className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/20 text-[10px] font-mono"
              >
                v{agent.version}
              </Badge>
            )}

            <Badge
              variant="outline"
              size="xs"
              className="bg-primary-foreground/10 text-primary-foreground/80 border-primary-foreground/20 text-[10px]"
            >
              <Network className="h-3 w-3 mr-1" />
              {agent.poolMemberships.length > 0
                ? `${agent.poolMemberships.length} Pool${agent.poolMemberships.length > 1 ? 's' : ''}`
                : 'Direct Target'}
            </Badge>
          </>
        }
        subtitle={
          <div className="space-y-1">
            <p className="text-xs text-primary-foreground/85 leading-relaxed max-w-3xl">
              Deployment manifests, secure runner handshake verification, and persistent identity
              lifecycle for {agent.name}.
            </p>
            <p className="text-[11px] text-primary-foreground/70">
              Enrolled {formatDateTime(agent.createdAt, userTimeZone, { format: 'date' })} •
              Hostname: {agent.hostname || 'Awaiting handshake'} • Last Heartbeat:{' '}
              {agent.lastHeartbeatAt
                ? formatDateTime(agent.lastHeartbeatAt, userTimeZone, {
                    format: 'datetime',
                    includeTimeZone: true,
                  })
                : 'None recorded'}
            </p>
          </div>
        }
        stats={[
          {
            label: 'Status',
            value: agent.status,
            icon: <Activity className="h-3.5 w-3.5" />,
          },
          {
            label: 'Hostname',
            value: agent.hostname || 'Awaiting handshake',
            icon: <Server className="h-3.5 w-3.5" />,
            tooltip: agent.hostname || undefined,
          },
          {
            label: 'Version',
            value: agent.version ? `v${agent.version}` : 'Enrolled',
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
          },
          {
            label: 'Assigned Pools',
            value:
              agent.poolMemberships.length > 0
                ? agent.poolMemberships.map(m => m.pool.name).join(', ')
                : 'Direct target only',
            icon: <Network className="h-3.5 w-3.5" />,
            tooltip: agent.poolMemberships.map(m => m.pool.name).join(', '),
          },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="bg-zinc-800/80 text-white border-zinc-700 hover:bg-zinc-700 text-xs gap-1.5 h-8 shadow-xs"
            >
              <Link href="/runbooks/agents">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Agent Fleet</span>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="bg-zinc-800/80 text-white border-zinc-700 hover:bg-zinc-700 text-xs gap-1.5 h-8 shadow-xs"
            >
              <Link href="/runbooks/agents/pools">
                <Network className="h-3.5 w-3.5 text-primary" />
                <span>Manage Pools</span>
              </Link>
            </Button>
          </div>
        }
      />

      <RunbookModuleNav summary={navigation} />

      {/* Operational Context Notice Banner matching Services */}
      <Alert className="border-primary/20 bg-primary/5 dark:bg-primary/10 text-primary">
        <Info className="h-4 w-4 shrink-0 text-primary" />
        <AlertTitle className="text-xs font-bold text-foreground">
          Enrolled Agent Lifecycle Context
        </AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          You are managing deployment configuration for an existing enrolled runner (
          <strong className="text-foreground">{agent.name}</strong>). Upgrades and restarts preserve
          local identity volumes, encryption credentials, and execution claims. To replace a
          compromised host, revoke this identity from the Fleet table and register a new Agent.
        </AlertDescription>
      </Alert>

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

      {/* Fleet Navigation Footer */}
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
    </main>
  );
}
