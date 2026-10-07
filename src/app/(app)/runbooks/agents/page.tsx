import Link from 'next/link';
import { getRunbookDatabaseNow, getRunbookFleetSummary, getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import { resolveEffectiveAgentStatus } from '@/lib/runbooks/presentation/contracts';
import { SearchableRunbookSelect } from '@/components/runbooks/SearchableRunbookSelect';
import { KeyRound, Network } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { getAppUrl } from '@/lib/app-url';
import AgentEnrollmentForm from '@/components/runbooks/AgentEnrollmentForm';
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookMetricStrip } from '@/components/runbooks/RunbookMetricStrip';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { AgentFleetTable } from '@/components/runbooks/agents/AgentFleetTable';
import EmptyState from '@/components/ui/EmptyState';
import {
  ActionForm,
  ConfigureSheet,
  ConfirmAction,
  FormSelect,
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
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
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
  const [permissions, user, appUrl] = await Promise.all([
    getUserPermissions(),
    getCurrentUser(),
    getAppUrl(),
  ]);
  const userTimeZone = getUserTimeZone(user);
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const canManageSecrets = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  const { query, page: requestedPage } = runbookPageQuery(await searchParams);
  const [now, fleet, navigation, poolTotal, secretTotal] = await Promise.all([getRunbookDatabaseNow(), getRunbookFleetSummary(), getRunbookNavigationSummary(), prisma.runbookAgentPool.count(), canManageSecrets ? prisma.runbookSecret.count() : Promise.resolve(0)]);
  const tab = ['agents', 'pools', 'secrets', 'security'].includes(query.tab) && (query.tab !== 'secrets' || canManageSecrets) ? query.tab : 'agents';
  const onlineSince = new Date(now.getTime() - 90000);
  const memberPage = Math.max(1, Math.min(10000, Number(query.memberPage) || 1));
  const grantPage = Math.max(1, Math.min(10000, Number(query.grantPage) || 1));
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
  const panelTotal = tab === 'pools' ? poolTotal : tab === 'secrets' ? secretTotal : agentTotal;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(panelTotal / RUNBOOK_PAGE_SIZE)));
  const signingKeys = canManage && tab === 'security'
    ? await prisma.runbookExecutionSigningKey.findMany({
        where: { state: { not: 'RETIRED' } },
        select: { id: true, publicKey: true, state: true, retiredAt: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  const budget = tab === 'security' ? await prisma.systemSettings.findUnique({ where: { id: 'default' } }) : null;
  const [agents, pools, secrets, signingKey] = await Promise.all([
    tab === 'agents' ? prisma.runbookAgent.findMany({
      where: agentWhere,
      skip: (page - 1) * RUNBOOK_PAGE_SIZE,
      take: RUNBOOK_PAGE_SIZE,
      include: { poolMemberships: { include: { pool: true }, take: 20 } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }) : Promise.resolve([]),
    tab === 'pools' ? prisma.runbookAgentPool.findMany({
      skip: (page - 1) * RUNBOOK_PAGE_SIZE, take: RUNBOOK_PAGE_SIZE,
      include: {
        members: { skip: (memberPage - 1) * 20, take: 20, orderBy: { id: 'asc' }, include: { agent: { select: { id: true, name: true } } } },
        _count: { select: { bindings: true, members: true } },
      },
      orderBy: { name: 'asc' },
    }) : Promise.resolve([]),
    canManageSecrets && tab === 'secrets'
      ? prisma.runbookSecret.findMany({
          skip: (page - 1) * RUNBOOK_PAGE_SIZE, take: RUNBOOK_PAGE_SIZE,
          select: {
            id: true,
            name: true,
            description: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { grants: true } },
            grants: {
              skip: (grantPage - 1) * 20, take: 20, orderBy: { id: 'asc' },
              include: { agent: { select: { name: true } }, agentPool: { select: { name: true } } },
            },
          },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    canManage && tab === 'security'
      ? prisma.runbookExecutionSigningKey.findFirst({
          where: { state: 'ACTIVE' },
          select: { publicKey: true },
        })
      : Promise.resolve(null),
  ]);

  const agentListData = agents.map(agent => {
    const effectiveStatus = resolveEffectiveAgentStatus(agent, now);

    return {
      id: agent.id,
      name: agent.name,
      hostname: agent.hostname,
      status: agent.status,
      effectiveStatus,
      platform: agent.platform,
      version: agent.version,
      lastHeartbeatAt: agent.lastHeartbeatAt?.toISOString() ?? null,
      capabilities: agent.capabilities,
      capabilityReport: agent.capabilityReport,
      labels: agent.labels,
      poolMemberships: agent.poolMemberships,
      activeAttemptCount: agent.activeAttemptCount,
      spoolDepth: agent.spoolDepth,
      deadLetterDepth: agent.deadLetterDepth,
      trustedSigningKeys: agent.trustedSigningKeys,
      lastError: agent.lastError,
    };
  });

  const agentPanel = (
    <section className="space-y-4">
      <AgentFleetTable
        agents={agentListData}
        userTimeZone={userTimeZone}
        canManage={canManage}
      />
    </section>
  );

  const securityPanel = (
    <section className="space-y-4">
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
                    ? ` · Grace ends ${formatDateTime(key.retiredAt, userTimeZone, { format: 'datetime' })}`
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
                  {pool._count.members} Agents · {pool._count.bindings} bindings
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
                {canManage && <ActionForm action={addAgentToPoolAction} className="space-y-3">
                  <input type="hidden" name="poolId" value={pool.id} />
                  <SearchableRunbookSelect kind="agent" name="agentId" label="Agent to add" required />
                  <SubmitButton>Add Agent</SubmitButton>
                </ActionForm>}
                <p className="text-xs text-muted-foreground">Members {pool.members.length} of {pool._count.members}</p>
                {memberPage > 1 && <Link className="text-primary text-xs" href={`/runbooks/agents?tab=pools&page=${page}&memberPage=${memberPage - 1}`}>Previous members</Link>}
                {memberPage * 20 < pool._count.members && <Link className="text-primary text-xs" href={`/runbooks/agents?tab=pools&page=${page}&memberPage=${memberPage + 1}`}>Next members</Link>}
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
      {canManageSecrets && (
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
            <SearchableRunbookSelect kind="target" name="target" label="Initial secret grant" required />
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
                Created {formatDateTime(secret.createdAt, userTimeZone, { format: 'date' })} · Updated{' '}
                {formatDateTime(secret.updatedAt, userTimeZone, { format: 'date' })}
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
                <p className="text-xs text-muted-foreground">Grants {secret.grants.length} of {secret._count.grants}</p>
                {grantPage > 1 && <Link className="text-primary text-xs" href={`/runbooks/agents?tab=secrets&page=${page}&grantPage=${grantPage - 1}`}>Previous grants</Link>}
                {grantPage * 20 < secret._count.grants && <Link className="text-primary text-xs" href={`/runbooks/agents?tab=secrets&page=${page}&grantPage=${grantPage + 1}`}>Next grants</Link>}
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
                {canManageSecrets && (
                  <ActionForm
                    action={grantRunbookSecretAction.bind(null, secret.id)}
                    className="space-y-3"
                  >
                    <SearchableRunbookSelect kind="target" name="target" label="Grant to target" required />
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
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 md:p-6">
      {/* Compact Page Header */}
      <RunbookPageHeader
        title="Execution Infrastructure"
        description="Outbound-only native Agents, explicit worker pools, and cryptographically isolated credentials."
        actions={
          canManage ? (
            <ConfigureSheet
              title="Enroll an Agent"
              description="Single-use enrollment tokens expire after 15 minutes. The private key never leaves the Agent."
              trigger={<Button>Add Agent</Button>}
            >
              <AgentEnrollmentForm userTimeZone={userTimeZone} appUrl={appUrl} />
            </ConfigureSheet>
          ) : undefined
        }
      />

      {/* Modern Metric Strip */}
      <RunbookMetricStrip
        stats={[
          {
            label: 'Enrolled Agents',
            value: fleet.enrolled,
            subtext: `${fleet.online} online · ${fleet.offline} offline · ${fleet.enrolling} enrolling`,
            tone: fleet.online > 0 ? 'success' : 'default',
          },
          {
            label: 'Worker Pools',
            value: poolTotal,
            subtext: 'Target pools',
          },
          {
            label: 'Pending Results',
            value: fleet.spoolDepth,
            subtext: 'Spool depth',
          },
          {
            label: 'Dead Letters',
            value: fleet.deadLetterDepth,
            tone: fleet.deadLetterDepth > 0 ? 'warning' : 'default',
            subtext: 'Unclaimed events',
          },
        ]}
      />

      {/* Persistent Module Navigation */}
      <RunbookModuleNav summary={navigation} />

      {/* Search & Attribute Filters */}
      {tab === 'agents' && <RunbookFilters
        query={query}
        fields={[
          { name: 'q', label: 'Search Agents' },
          { name: 'pool', label: 'Pool ID' },
          { name: 'platform', label: 'Platform' },
          { name: 'capability', label: 'Capability' },
          { name: 'label', label: 'Label (key=value)' },
        ]}
        statusOptions={Object.values(RunbookAgentStatus).map(value => ({ value, label: value }))}
      />}

      {/* Automatic Remediation Budgets Policy */}
      {tab === 'security' && permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE) && (
        <details className="rounded-xl border bg-card/60 p-4 shadow-2xs">
          <summary className="cursor-pointer font-semibold text-sm">
            Automatic remediation budgets
          </summary>
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

      {/* Tabbed Infrastructure Modules */}
      <nav aria-label="Infrastructure sections" className="flex gap-2 overflow-x-auto">
        {['agents', 'pools', ...(canManageSecrets ? ['secrets'] : []), 'security'].map(section => <Link key={section} href={`/runbooks/agents?tab=${section}`} aria-current={tab === section ? 'page' : undefined} className={`rounded-md px-4 py-2 text-sm capitalize ${tab === section ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>{section}</Link>)}
      </nav>
      {tab === 'agents' ? agentPanel : tab === 'pools' ? poolPanel : tab === 'secrets' ? secretPanel : securityPanel}
      {tab !== 'security' && <RunbookPagination page={page} total={panelTotal} query={query} />}

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
