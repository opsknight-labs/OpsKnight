import { Bot, KeyRound, Network } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getUserPermissions } from '@/lib/rbac';
import AgentEnrollmentForm from '@/components/runbooks/AgentEnrollmentForm';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import DetailTabs from '@/components/ui/DetailTabs';
import EmptyState from '@/components/ui/EmptyState';
import {
  ActionForm,
  ConfigureSheet,
  ConfirmAction,
  FormSelect,
  RunbookNavigation,
  StatusBadge,
  SubmitButton,
} from '@/components/runbooks/RunbookControls';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
  rotateRunbookSecretAction,
} from '../actions';

export const revalidate = 0;
export default async function RunbookAgentsPage() {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const permissions = await getUserPermissions();
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const canManageSecrets = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  const [databaseClock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
  if (!databaseClock) throw new Error('Database clock query returned no rows.');
  const [agents, pools, secrets, signingKey] = await Promise.all([
    prisma.runbookAgent.findMany({
      include: { poolMemberships: { include: { pool: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.runbookAgentPool.findMany({
      include: {
        members: { include: { agent: { select: { id: true, name: true } } } },
        _count: { select: { bindings: true } },
      },
      orderBy: { name: 'asc' },
    }),
    canManageSecrets
      ? prisma.runbookSecret.findMany({
          select: {
            id: true,
            name: true,
            description: true,
            createdAt: true,
            updatedAt: true,
            grants: {
              include: { agent: { select: { name: true } }, agentPool: { select: { name: true } } },
            },
          },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    canManage
      ? prisma.runbookExecutionSigningKey.findUnique({
          where: { id: 'default' },
          select: { publicKey: true },
        })
      : Promise.resolve(null),
  ]);
  const activeAgents = agents.filter(agent => agent.status !== 'REVOKED');
  const targetOptions = [
    ...pools.map(pool => ({ value: `pool:${pool.id}`, label: `Pool · ${pool.name}` })),
    ...activeAgents.map(agent => ({ value: `agent:${agent.id}`, label: `Agent · ${agent.name}` })),
  ];
  const agentPanel = (
    <section className="space-y-4">
      {canManage && (
        <ConfigureSheet
          title="Enroll an Agent"
          description="Single-use enrollment tokens expire after 15 minutes. The private key never leaves the Agent."
          trigger={<Button>Add Agent</Button>}
        >
          <AgentEnrollmentForm />
        </ConfigureSheet>
      )}
      {canManage && signingKey && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Pinned execution public key
          </summary>
          <p className="mt-3 text-xs text-muted-foreground">
            Set OPSKNIGHT_EXECUTION_PUBLIC_KEY on every Agent. Verify the value through your trusted
            OpsKnight session.
          </p>
          <code className="mt-2 block break-all select-all text-xs">{signingKey.publicKey}</code>
        </details>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map(agent => {
          const status =
            agent.status === 'ONLINE' &&
            (!agent.lastHeartbeatAt ||
              databaseClock.now.getTime() - agent.lastHeartbeatAt.getTime() > 90000)
              ? 'OFFLINE'
              : agent.status;
          return (
            <Card key={agent.id} className="rounded-xl">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="text-base">{agent.name}</CardTitle>
                  <StatusBadge status={status} />
                </div>
                <CardDescription>{agent.hostname || 'Awaiting enrollment'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <p className="text-muted-foreground">
                  {agent.platform || 'Platform pending'} · v{agent.version || '—'}
                </p>
                <div className="flex flex-wrap gap-1" aria-label="Configured capabilities">
                  {Array.isArray(agent.capabilities) &&
                    agent.capabilities
                      .filter((value): value is string => typeof value === 'string')
                      .map(value => (
                        <Badge key={value} variant="outline">
                          {value.replace('RUNBOOK_', '').replaceAll('_', ' ')}
                        </Badge>
                      ))}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-muted-foreground">Heartbeat</dt>
                  <dd className="break-words">
                    {agent.lastHeartbeatAt?.toLocaleString() || 'Never'}
                  </dd>
                  <dt className="text-muted-foreground">Pools</dt>
                  <dd>{agent.poolMemberships.map(item => item.pool.name).join(', ') || 'None'}</dd>
                  <dt className="text-muted-foreground">Jobs</dt>
                  <dd>{agent.activeAttemptCount} running</dd>
                  <dt className="text-muted-foreground">Spool</dt>
                  <dd>
                    {agent.spoolDepth} pending · {agent.deadLetterDepth} dead letter
                  </dd>
                </dl>
                {agent.lastError && (
                  <p className="break-words rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
                    {agent.lastError}
                  </p>
                )}
                {canManage && agent.status !== 'REVOKED' && (
                  <ConfirmAction
                    action={revokeAgentAction.bind(null, agent.id)}
                    title={`Revoke ${agent.name}?`}
                    description="The Agent immediately loses execution authority. Running actions can no longer renew their lease and will self-fence."
                    label="Revoke Agent"
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {agents.length === 0 && (
        <EmptyState
          icon={<Bot />}
          title="No Agents enrolled"
          description="Enroll an outbound Agent for diagnostics and approved remediation."
        />
      )}
    </section>
  );
  const poolPanel = (
    <section className="space-y-4">
      {canManage && (
        <ConfigureSheet
          title="Create Agent pool"
          description="Choose target semantics explicitly."
          trigger={<Button>Create pool</Button>}
        >
          <ActionForm action={createAgentPoolAction} className="space-y-4">
            <Field label="Name">
              <Input name="name" aria-label="Pool name" required />
            </Field>
            <Field label="Description">
              <Input name="description" aria-label="Pool description" />
            </Field>
            <FormSelect
              name="mode"
              label="Pool semantics"
              defaultValue="SHARED_TARGET"
              options={[
                { value: 'SHARED_TARGET', label: 'Shared target · any healthy member' },
                { value: 'LOCAL_HOSTS', label: 'Local hosts · distinct machines' },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Writes to a multi-member local-host pool require a specific Agent.
            </p>
            <SubmitButton>Create pool</SubmitButton>
          </ActionForm>
        </ConfigureSheet>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {pools.map(pool => (
          <Card key={pool.id} className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">{pool.name}</CardTitle>
              <CardDescription>{pool.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{pool.mode.replaceAll('_', ' ')}</Badge>
                <Badge variant="secondary">
                  {pool.members.length} Agents · {pool._count.bindings} bindings
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {pool.mode === 'SHARED_TARGET'
                  ? 'Any healthy member can operate the same target.'
                  : 'Each Agent represents a different machine. Select a specific Agent for writes.'}
              </p>
              <ConfigureSheet
                title={`Manage ${pool.name}`}
                description="Membership changes affect future claims and write-target validation."
                trigger={
                  <Button variant="outline" size="sm">
                    Manage pool
                  </Button>
                }
              >
                {pool.members.map(member => (
                  <div
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <span className="text-sm">{member.agent.name}</span>
                    {canManage && (
                      <ConfirmAction
                        action={removeAgentFromPoolAction.bind(null, member.id)}
                        title={`Remove ${member.agent.name}?`}
                        description="This Agent will no longer receive new work targeted to this pool."
                        label="Remove"
                        variant="outline"
                      />
                    )}
                  </div>
                ))}
                {canManage &&
                  activeAgents.some(
                    agent => !pool.members.some(member => member.agentId === agent.id)
                  ) && (
                    <ActionForm action={addAgentToPoolAction} className="space-y-3">
                      <input type="hidden" name="poolId" value={pool.id} />
                      <FormSelect
                        name="agentId"
                        label="Agent to add"
                        options={activeAgents
                          .filter(
                            agent => !pool.members.some(member => member.agentId === agent.id)
                          )
                          .map(agent => ({ value: agent.id, label: agent.name }))}
                      />
                      <SubmitButton>Add Agent</SubmitButton>
                    </ActionForm>
                  )}
                {pool.members.length === 0 && <EmptyState title="No members" size="sm" />}
              </ConfigureSheet>
            </CardContent>
          </Card>
        ))}
      </div>
      {pools.length === 0 && (
        <EmptyState
          icon={<Network />}
          title="No Agent pools"
          description="Group Agents that can safely share an execution target."
        />
      )}
    </section>
  );
  const secretPanel = (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Credentials are encrypted at rest. Values are never displayed; secret-backed Agent steps
        require HTTPS.
      </p>
      {targetOptions.length > 0 && (
        <ConfigureSheet
          title="Create scoped secret"
          description="Grant the credential only to the Agent or pool that requires it."
          trigger={<Button>Create secret</Button>}
        >
          <ActionForm action={createRunbookSecretAction} className="space-y-4">
            <Field label="Name">
              <Input name="name" aria-label="Secret name" required />
            </Field>
            <Field label="Value">
              <Input
                name="value"
                aria-label="Secret value"
                type="password"
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="Description">
              <Input name="description" aria-label="Secret description" />
            </Field>
            <FormSelect name="target" label="Initial secret grant" options={targetOptions} />
            <SubmitButton>Create encrypted secret</SubmitButton>
          </ActionForm>
        </ConfigureSheet>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {secrets.map(secret => (
          <Card key={secret.id} className="rounded-xl">
            <CardHeader>
              <CardTitle className="text-base">{secret.name}</CardTitle>
              <CardDescription>{secret.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="font-mono text-muted-foreground" aria-label="Secret value hidden">
                ••••••••••••••••
              </p>
              <p className="text-xs text-muted-foreground">
                Created {secret.createdAt.toLocaleDateString()} · Updated{' '}
                {secret.updatedAt.toLocaleDateString()}
              </p>
              <p className="text-sm text-muted-foreground">
                Granted to{' '}
                {secret.grants
                  .map(grant => grant.agentPool?.name ?? grant.agent?.name ?? 'Deleted target')
                  .join(', ') || 'no targets'}
              </p>
              <ConfigureSheet
                title={`Manage ${secret.name}`}
                description="Values stay hidden. Review grants and rotate credentials when needed."
                trigger={
                  <Button variant="outline" size="sm">
                    Manage grants / Rotate
                  </Button>
                }
              >
                {secret.grants.map(grant => (
                  <div
                    key={grant.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <span className="text-sm">
                      {grant.agentPool?.name ?? grant.agent?.name ?? 'Deleted target'}
                    </span>
                    <ConfirmAction
                      action={revokeRunbookSecretGrantAction.bind(null, grant.id)}
                      title="Revoke this secret grant?"
                      description="The target can no longer resolve this credential for new steps. Previously resolved values cannot be recalled."
                      label="Revoke grant"
                      variant="outline"
                    />
                  </div>
                ))}
                {targetOptions.length > 0 && (
                  <ActionForm
                    action={grantRunbookSecretAction.bind(null, secret.id)}
                    className="space-y-3"
                  >
                    <FormSelect name="target" label="Grant to target" options={targetOptions} />
                    <SubmitButton>Grant access</SubmitButton>
                  </ActionForm>
                )}
                <ActionForm
                  action={rotateRunbookSecretAction.bind(null, secret.id)}
                  className="space-y-3 border-t pt-4"
                >
                  <Field label="New secret value">
                    <Input
                      name="value"
                      aria-label="New secret value"
                      type="password"
                      required
                      autoComplete="new-password"
                    />
                  </Field>
                  <SubmitButton pendingLabel="Rotating…" variant="outline">
                    Rotate secret
                  </SubmitButton>
                </ActionForm>
              </ConfigureSheet>
            </CardContent>
          </Card>
        ))}
      </div>
      {secrets.length === 0 && (
        <EmptyState
          icon={<KeyRound />}
          title="No scoped secrets"
          description="Create encrypted credentials and grant each to a specific Agent or pool."
        />
      )}
    </section>
  );
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <DetailHeroBanner
        tag="RUNBOOK AUTOMATION"
        title="Execution infrastructure"
        subtitle="Outbound-only Agents, explicit execution pools and least-privilege credentials."
        icon={<Bot className="h-8 w-8" />}
        statsPlacement="bottom"
        stats={[
          { label: 'Agents', value: activeAgents.length },
          { label: 'Pools', value: pools.length },
          {
            label: 'Pending results',
            value: agents.reduce((sum, agent) => sum + agent.spoolDepth, 0),
          },
          {
            label: 'Dead letters',
            value: agents.reduce((sum, agent) => sum + agent.deadLetterDepth, 0),
          },
        ]}
      />
      <RunbookNavigation />
      <DetailTabs
        tabs={[
          { id: 'agents', label: 'Agents', count: agents.length, content: agentPanel },
          { id: 'pools', label: 'Pools', count: pools.length, content: poolPanel },
          ...(canManageSecrets
            ? [{ id: 'secrets', label: 'Secrets', count: secrets.length, content: secretPanel }]
            : []),
        ]}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
