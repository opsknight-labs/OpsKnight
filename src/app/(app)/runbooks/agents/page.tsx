import Link from 'next/link';
import { Activity, ArrowLeft, Bot, KeyRound, Network, ShieldOff, Trash2 } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getUserPermissions } from '@/lib/rbac';
import AgentEnrollmentForm from '@/components/runbooks/AgentEnrollmentForm';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  addAgentToPoolAction,
  createAgentPoolAction,
  createRunbookSecretAction,
  grantRunbookSecretAction,
  removeAgentFromPoolAction,
  revokeAgentAction,
  revokeRunbookSecretGrantAction,
} from '../actions';

export const revalidate = 0;

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function TargetSelect({
  agents,
  pools,
}: {
  agents: { id: string; name: string }[];
  pools: { id: string; name: string }[];
}) {
  return (
    <select name="target" required className={selectClass} defaultValue="">
      <option value="" disabled>
        Select execution target
      </option>
      {pools.map(pool => (
        <option key={pool.id} value={`pool:${pool.id}`}>
          Pool · {pool.name}
        </option>
      ))}
      {agents.map(agent => (
        <option key={agent.id} value={`agent:${agent.id}`}>
          Agent · {agent.name}
        </option>
      ))}
    </select>
  );
}

export default async function RunbookAgentsPage() {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const permissions = await getUserPermissions();
  const canManageSecrets = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  const [agents, pools, secrets, executionSigningKey] = await Promise.all([
    prisma.runbookAgent.findMany({
      include: {
        poolMemberships: { include: { pool: true } },
        _count: { select: { claimedAttempts: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.runbookAgentPool.findMany({
      include: { members: { include: { agent: true } }, _count: { select: { bindings: true } } },
      orderBy: { name: 'asc' },
    }),
    canManageSecrets
      ? prisma.runbookSecret.findMany({
          include: { grants: { include: { agent: true, agentPool: true } } },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    prisma.runbookExecutionSigningKey.findUnique({
      where: { id: 'default' },
      select: { publicKey: true },
    }),
  ]);
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const activeAgents = agents.filter(agent => agent.status !== 'REVOKED');

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 sm:p-6 lg:p-8">
      {canManage && executionSigningKey && (
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">Pinned execution public key</p>
          <p className="mt-1 text-muted-foreground">
            Set OPSKNIGHT_EXECUTION_PUBLIC_KEY on each Agent. Verify this value through your trusted
            OpsKnight session.
          </p>
          <code className="mt-2 block break-all select-all text-xs">
            {executionSigningKey.publicKey}
          </code>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/runbooks"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Runbooks
        </Link>
        <Button asChild variant="outline" size="sm">
          <Link href="/runbooks/health">
            <Activity /> Health center
          </Link>
        </Button>
      </div>
      <header>
        <h1 className="font-heading text-3xl font-semibold">Execution agents</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Outbound-only, signed execution identities with explicit pools, local policy, and
          least-privilege secret grants.
        </p>
      </header>

      {canManage && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Add agent</CardTitle>
              <CardDescription>
                Enrollment tokens expire after 15 minutes and are single-use. The private key never
                leaves the agent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AgentEnrollmentForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Create agent pool</CardTitle>
              <CardDescription>
                Local-host retries stay on the same machine; shared targets may fail over.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createAgentPoolAction} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="pool-name">Name</Label>
                  <Input id="pool-name" name="name" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pool-description">Description</Label>
                  <Input id="pool-description" name="description" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pool-mode">Target semantics</Label>
                  <select id="pool-mode" name="mode" className={selectClass}>
                    <option value="SHARED_TARGET">Shared target (fail over)</option>
                    <option value="LOCAL_HOSTS">Local hosts (pin retries)</option>
                  </select>
                </div>
                <Button type="submit">
                  <Network /> Create pool
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-semibold">Agents</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map(agent => (
            <Card key={agent.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Bot className="h-4 w-4" /> {agent.name}
                    </CardTitle>
                    <CardDescription>
                      {agent.hostname || 'Hostname pending enrollment'}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      agent.status === 'ONLINE'
                        ? 'default'
                        : agent.status === 'REVOKED'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {agent.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-muted-foreground">
                <div>
                  Version {agent.version || '—'} · Platform {agent.platform || '—'}
                </div>
                <div>
                  Last heartbeat {agent.lastHeartbeatAt?.toLocaleString() || 'Never'} ·{' '}
                  {agent._count.claimedAttempts} attempts
                </div>
                <div>
                  Active {agent.activeAttemptCount} · Spool {agent.spoolDepth} · Quarantined{' '}
                  {agent.deadLetterDepth} · Policy {agent.policyHash?.slice(0, 12) || '—'}
                </div>
                <div>
                  {agent.poolMemberships.map(item => item.pool.name).join(', ') || 'No agent pool'}
                </div>
                {agent.lastError && (
                  <p className="rounded bg-destructive/10 p-2 text-destructive">
                    {agent.lastError}
                  </p>
                )}
                {canManage && agent.status !== 'REVOKED' && (
                  <form action={revokeAgentAction.bind(null, agent.id)}>
                    <Button type="submit" size="sm" variant="destructive">
                      <ShieldOff /> Revoke
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
          {agents.length === 0 && (
            <p className="text-sm text-muted-foreground">No agents enrolled.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-semibold">Agent pools</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {pools.map(pool => {
            const memberIds = new Set(pool.members.map(member => member.agentId));
            const available = activeAgents.filter(agent => !memberIds.has(agent.id));
            return (
              <Card key={pool.id}>
                <CardHeader>
                  <CardTitle className="text-base">{pool.name}</CardTitle>
                  <CardDescription>{pool.description || 'No description'}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex gap-2">
                    <Badge variant="outline">
                      {pool.mode === 'LOCAL_HOSTS' ? 'Local hosts' : 'Shared target'}
                    </Badge>
                    <Badge variant="secondary">{pool._count.bindings} bindings</Badge>
                  </div>
                  <div className="space-y-1">
                    {pool.members.map(member => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between rounded border px-2 py-1 text-muted-foreground"
                      >
                        <span>{member.agent.name}</span>
                        {canManage && (
                          <form action={removeAgentFromPoolAction.bind(null, member.id)}>
                            <Button
                              type="submit"
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${member.agent.name} from ${pool.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </form>
                        )}
                      </div>
                    ))}
                    {pool.members.length === 0 && (
                      <p className="text-muted-foreground">No members</p>
                    )}
                  </div>
                  {canManage && available.length > 0 && (
                    <form action={addAgentToPoolAction} className="flex gap-2">
                      <input type="hidden" name="poolId" value={pool.id} />
                      <select name="agentId" required className={selectClass} defaultValue="">
                        <option value="" disabled>
                          Add an agent
                        </option>
                        {available.map(agent => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="outline">
                        Add
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {pools.length === 0 && (
            <p className="text-sm text-muted-foreground">No pools configured.</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-xl font-semibold">Scoped secrets</h2>
        <p className="text-sm text-muted-foreground">
          Values are encrypted at rest and never displayed after creation. Every secret must be
          granted to a specific agent or pool.
        </p>
        {canManageSecrets && activeAgents.length + pools.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create secret</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createRunbookSecretAction} className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="secret-name">Name</Label>
                  <Input id="secret-name" name="name" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="secret-value">Value</Label>
                  <Input
                    id="secret-value"
                    name="value"
                    type="password"
                    required
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="secret-description">Description</Label>
                  <Input id="secret-description" name="description" />
                </div>
                <div className="space-y-1">
                  <Label>Initial grant</Label>
                  <TargetSelect agents={activeAgents} pools={pools} />
                </div>
                <Button type="submit" className="md:col-span-2 md:w-fit">
                  <KeyRound /> Create encrypted secret
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {secrets.map(secret => (
            <Card key={secret.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="h-4 w-4" /> {secret.name}
                </CardTitle>
                <CardDescription>{secret.description || 'No description'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  {secret.grants.map(grant => (
                    <div
                      key={grant.id}
                      className="flex items-center justify-between rounded border p-2 text-sm"
                    >
                      <span>
                        {grant.agentPool
                          ? `Pool · ${grant.agentPool.name}`
                          : `Agent · ${grant.agent?.name || 'Deleted'}`}
                      </span>
                      {canManageSecrets && (
                        <form action={revokeRunbookSecretGrantAction.bind(null, grant.id)}>
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            aria-label="Revoke grant"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </form>
                      )}
                    </div>
                  ))}
                  {secret.grants.length === 0 && (
                    <p className="text-sm text-destructive">No target can access this secret.</p>
                  )}
                </div>
                {canManageSecrets && activeAgents.length + pools.length > 0 && (
                  <form
                    action={grantRunbookSecretAction.bind(null, secret.id)}
                    className="flex gap-2"
                  >
                    <TargetSelect agents={activeAgents} pools={pools} />
                    <Button type="submit" variant="outline">
                      Grant
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
