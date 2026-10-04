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
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Label } from '@/components/ui/shadcn/label';
import { RunbookAgentStatus, type Prisma } from '@prisma/client';
import { runbookAgentFilterSchema } from '@/lib/runbooks/schemas';
import { schedulingLabelsSchema } from '@/lib/runbooks/pool-labels';
import {
  RunbookFilters,
  RunbookPagination,
  runbookPageQuery,
  RUNBOOK_PAGE_SIZE,
} from '@/components/runbooks/RunbookPagination';
import {
  addAgentToPoolAction,
  createAgentPoolAction,
  createRunbookSecretAction,
  grantRunbookSecretAction,
  removeAgentFromPoolAction,
  revokeAgentAction,
  revokeRunbookSecretGrantAction,
  rotateRunbookSecretAction,
  updateSchedulingLabelsAction,
  rotateExecutionSigningIdentityAction,
  updateIncidentRemediationBudgetAction,
} from '../actions';

export const revalidate = 0;
export default async function RunbookAgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const permissions = await getUserPermissions();
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const canManageSecrets = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  const { query, page: requestedPage } = runbookPageQuery(await searchParams);
  const [databaseClock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
  if (!databaseClock) throw new Error('Database clock query returned no rows.');
  const onlineSince = new Date(databaseClock.now.getTime() - 90000);
  const statusFilter = Object.values(RunbookAgentStatus).find(status => status === query.status);
  const label = query.label ?? '';
  const split = label.indexOf('=');
  const labelKey = split > 0 ? label.slice(0, split) : '';
  const labelValue = split > 0 ? label.slice(split + 1) : '';
  const labels = schedulingLabelsSchema.safeParse(
    labelKey && labelValue ? { [labelKey]: labelValue } : {}
  );
  const filter = runbookAgentFilterSchema.parse({
    status: statusFilter,
    q: query.q,
    poolId: query.pool,
    platform: query.platform?.slice(0, 100),
    capability: query.capability?.slice(0, 100),
    labels: labels.success ? labels.data : undefined,
    page: requestedPage,
  });
  const agentWhere: Prisma.RunbookAgentWhereInput = {
    ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    ...(statusFilter === 'OFFLINE'
      ? {
          OR: [
            { status: 'OFFLINE' },
            {
              status: { in: ['ONLINE', 'DEGRADED'] },
              OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: onlineSince } }],
            },
          ],
        }
      : statusFilter === 'ONLINE' || statusFilter === 'DEGRADED'
        ? { status: statusFilter, lastHeartbeatAt: { gte: onlineSince } }
        : statusFilter
          ? { status: statusFilter }
          : {}),
    ...(filter.poolId ? { poolMemberships: { some: { poolId: filter.poolId } } } : {}),
    ...(filter.platform ? { platform: filter.platform } : {}),
    ...(filter.capability ? { capabilities: { array_contains: [filter.capability] } } : {}),
    ...(filter.labels
      ? {
          AND: Object.entries(filter.labels).map(([key, value]) => ({
            labels: { path: [key], equals: value },
          })),
        }
      : {}),
  };
  const agentTotal = await prisma.runbookAgent.count({ where: agentWhere });
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(agentTotal / RUNBOOK_PAGE_SIZE)));
  const signingKeys = canManage
    ? await prisma.runbookExecutionSigningKey.findMany({
        where: { state: { not: 'RETIRED' } },
        select: { id: true, publicKey: true, state: true, retiredAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const budget = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const [agents, pools, secrets, signingKey] = await Promise.all([
    prisma.runbookAgent.findMany({
      where: agentWhere,
      skip: (page - 1) * RUNBOOK_PAGE_SIZE,
      take: RUNBOOK_PAGE_SIZE,
      include: { poolMemberships: { include: { pool: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
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
      ? prisma.runbookExecutionSigningKey.findFirst({
          where: { state: 'ACTIVE' },
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
          <p className="mt-3 text-xs">
            For overlapping rotation, set OPSKNIGHT_EXECUTION_PUBLIC_KEYS to this trusted key map on
            every Agent, wait for fleet acknowledgement, then activate NEXT. RETIRING keys have a
            24-hour grace period.
          </p>
          <code className="mt-2 block break-all text-xs">
            {JSON.stringify(Object.fromEntries(signingKeys.map(key => [key.id, key.publicKey])))}
          </code>
          <ActionForm action={rotateExecutionSigningIdentityAction}>
            <input type="hidden" name="operation" value="stage" />
            <SubmitButton disabled={signingKeys.some(key => key.state === 'NEXT')}>
              Stage next signing identity
            </SubmitButton>
          </ActionForm>
          {signingKeys
            .filter(key => key.state !== 'ACTIVE')
            .map(key => (
              <ActionForm key={key.id} action={rotateExecutionSigningIdentityAction}>
                <input
                  type="hidden"
                  name="operation"
                  value={key.state === 'NEXT' ? 'activate' : 'retire'}
                />
                <input type="hidden" name="keyId" value={key.id} />
                <p className="mt-2 text-xs">
                  {key.state} · {key.id}
                  {key.state === 'RETIRING' && key.retiredAt
                    ? ` · Grace ends ${key.retiredAt.toLocaleString()}`
                    : ''}
                </p>
                <SubmitButton>
                  {key.state === 'NEXT'
                    ? 'Activate acknowledged identity'
                    : 'Retire after grace period'}
                </SubmitButton>
              </ActionForm>
            ))}
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
                  <dt className="text-muted-foreground">Trusted signing identities</dt>
                  <dd className="break-all">
                    {Array.isArray(agent.trustedSigningKeys)
                      ? agent.trustedSigningKeys
                          .filter((key): key is string => typeof key === 'string')
                          .join(', ') || 'No rotation acknowledgement'
                      : 'No rotation acknowledgement'}
                  </dd>
                  <dt className="text-muted-foreground">Spool</dt>
                  <dd>
                    {agent.spoolDepth} pending · {agent.deadLetterDepth} dead letter
                  </dd>
                </dl>
                {Array.isArray(agent.capabilityReport) &&
                  agent.capabilityReport.map((entry, index) => {
                    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
                    return (
                      <p key={index} className="text-xs">
                        {String(entry.name)} · configured {entry.configured ? '✓' : '—'} · available{' '}
                        {entry.available ? '✓' : '—'} {entry.reason ? `· ${entry.reason}` : ''}
                      </p>
                    );
                  })}
                {canManage && (
                  <details>
                    <summary className="cursor-pointer text-xs">Scheduling labels</summary>
                    <ActionForm action={updateSchedulingLabelsAction}>
                      <input type="hidden" name="id" value={agent.id} />
                      <input type="hidden" name="kind" value="agent" />
                      <Textarea
                        name="labels"
                        aria-label={`Labels for ${agent.name}`}
                        defaultValue={JSON.stringify(agent.labels)}
                      />
                      <SubmitButton>Save scheduling labels</SubmitButton>
                    </ActionForm>
                  </details>
                )}
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
            <Field label="Match labels (JSON)">
              <Textarea name="matchLabels" aria-label="Pool match labels" defaultValue="{}" />
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
              {canManage && (
                <details>
                  <summary className="cursor-pointer text-xs">Dynamic label selector</summary>
                  <ActionForm action={updateSchedulingLabelsAction}>
                    <input type="hidden" name="id" value={pool.id} />
                    <input type="hidden" name="kind" value="pool" />
                    <Textarea
                      name="labels"
                      aria-label={`Selector for ${pool.name}`}
                      defaultValue={JSON.stringify(pool.matchLabels)}
                    />
                    <SubmitButton>Save pool selector</SubmitButton>
                  </ActionForm>
                </details>
              )}
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
                    <span className="text-sm">
                      {member.agent.name} · {member.source.toLowerCase()}
                    </span>
                    {canManage && member.source === 'EXPLICIT' && (
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
      <RunbookFilters
        query={query}
        fields={[
          { name: 'q', label: 'Search Agents' },
          { name: 'pool', label: 'Pool ID' },
          { name: 'platform', label: 'Platform' },
          { name: 'capability', label: 'Capability' },
          { name: 'label', label: 'Label (key=value)' },
        ]}
        statusOptions={Object.values(RunbookAgentStatus).map(value => ({ value, label: value }))}
      />
      <RunbookPagination page={page} total={agentTotal} query={query} />
      {permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE) && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-semibold">Automatic remediation budgets</summary>
          <ActionForm
            action={updateIncidentRemediationBudgetAction}
            className="mt-3 grid gap-3 sm:grid-cols-3"
          >
            <Field label="Automatic executions per incident">
              <Input
                name="executions"
                aria-label="Automatic executions per incident"
                type="number"
                min={0}
                max={100}
                defaultValue={budget?.runbookAutoExecutionsPerIncident ?? 3}
              />
            </Field>
            <Field label="Automatic writes per incident">
              <Input
                name="writes"
                aria-label="Automatic writes per incident"
                type="number"
                min={0}
                max={100}
                defaultValue={budget?.runbookAutoWritesPerIncident ?? 3}
              />
            </Field>
            <Field label="Automatic non-idempotent actions per incident">
              <Input
                name="nonIdempotent"
                aria-label="Automatic non-idempotent actions per incident"
                type="number"
                min={0}
                max={100}
                defaultValue={budget?.runbookAutoNonIdempotentPerIncident ?? 0}
              />
            </Field>
            <SubmitButton>Save remediation budgets</SubmitButton>
          </ActionForm>
        </details>
      )}
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
