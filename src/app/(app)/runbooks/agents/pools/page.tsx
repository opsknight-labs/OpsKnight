import Link from 'next/link';
import { Network, Server, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';
import { FleetPageShell } from '@/components/runbooks/agents/FleetPageShell';
import { fleetHref } from '@/components/runbooks/agents/fleet-routes';
import { SearchableRunbookSelect } from '@/components/runbooks/SearchableRunbookSelect';
import {
  ActionForm,
  ConfigureSheet,
  ConfirmAction,
  FormSelect,
  SubmitButton,
} from '@/components/runbooks/RunbookControls';
import {
  RunbookPagination,
  runbookPageQuery,
  RUNBOOK_PAGE_SIZE,
} from '@/components/runbooks/RunbookPagination';
import { EmptyHint, Pill, SectionCard } from '@/components/runbooks/ui/primitives';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import {
  addAgentToPoolAction,
  createAgentPoolAction,
  removeAgentFromPoolAction,
  updateSchedulingLabelsAction,
} from '../../actions';

export const revalidate = 0;

const POOLS_PATH = '/runbooks/agents/pools';
const MEMBER_PAGE_SIZE = 20;

function labelEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).map(([key, entry]) => [key, String(entry)]);
}

export default async function RunbookAgentPoolsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const [permissions, user, navigation] = await Promise.all([
    getUserPermissions(),
    getCurrentUser(),
    getRunbookNavigationSummary(),
  ]);
  const userTimeZone = getUserTimeZone(user);
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_AGENT_MANAGE);
  const canManageSecrets = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  const { query, page: requestedPage } = runbookPageQuery(await searchParams);
  const selectedId = query.pool ?? '';
  const requestedMemberPage = Math.max(1, Math.min(10000, Number(query.memberPage) || 1));

  const [poolTotal, selected] = await Promise.all([
    prisma.runbookAgentPool.count(),
    selectedId
      ? prisma.runbookAgentPool.findUnique({
          where: { id: selectedId },
          select: {
            id: true,
            name: true,
            mode: true,
            _count: { select: { members: true } },
          },
        })
      : Promise.resolve(null),
  ]);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(poolTotal / RUNBOOK_PAGE_SIZE)));
  const memberPage = selected
    ? Math.min(
        requestedMemberPage,
        Math.max(1, Math.ceil(selected._count.members / MEMBER_PAGE_SIZE))
      )
    : 1;
  const [pools, members] = await Promise.all([
    prisma.runbookAgentPool.findMany({
      skip: (page - 1) * RUNBOOK_PAGE_SIZE,
      take: RUNBOOK_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        description: true,
        mode: true,
        matchLabels: true,
        bindings: {
          take: 5,
          distinct: ['serviceId'],
          orderBy: { serviceId: 'asc' },
          select: { service: { select: { id: true, name: true } } },
        },
        _count: { select: { bindings: true, members: true } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    selected
      ? prisma.runbookAgentPoolMember.findMany({
          where: { poolId: selected.id },
          skip: (memberPage - 1) * MEMBER_PAGE_SIZE,
          take: MEMBER_PAGE_SIZE,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            source: true,
            createdAt: true,
            agent: { select: { id: true, name: true, hostname: true, status: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const memberHref = (target: number) =>
    fleetHref(POOLS_PATH, { page, pool: selected?.id, memberPage: target });

  return (
    <FleetPageShell
      title="Agent Pools"
      section="Pools"
      icon={Network}
      description="Group Agents that can safely share an execution target, or that represent distinct hosts. Services target pools through automation rules."
      navigation={navigation}
      canManageSecrets={canManageSecrets}
      actions={
        canManage ? (
          <ConfigureSheet
            title="Create Agent pool"
            description="Choose target semantics explicitly."
            trigger={<Button>Create pool</Button>}
          >
            <ActionForm
              action={createAgentPoolAction}
              className="space-y-4"
              successMessage="Pool created"
            >
              <Field label="Name">
                <Input name="name" aria-label="Pool name" required />
              </Field>
              <Field label="Description">
                <Input name="description" aria-label="Pool description" />
              </Field>
              <Field label="Match labels (JSON)">
                <Textarea name="matchLabels" aria-label="Pool match labels" defaultValue="{}" />
              </Field>
              <p className="text-xs text-muted-foreground">
                Agents whose scheduling labels match every key join automatically as dynamic
                members.
              </p>
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
        ) : undefined
      }
    >
      {selected && (
        <SectionCard
          id="pool-members"
          icon={Users}
          title={<span id="pool-members-title">Members of {selected.name}</span>}
          description="Membership changes affect future claims and write-target validation. Dynamic members follow the pool selector and Agent labels."
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href={fleetHref(POOLS_PATH, { page })}>Close members</Link>
            </Button>
          }
          className="border-primary/30"
          bodyClassName="space-y-4"
        >
          <div aria-labelledby="pool-members-title" className="space-y-4">
            {members.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableCaption className="sr-only">Members of {selected.name}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map(member => (
                      <TableRow key={member.id}>
                        <TableCell>
                          <span className="font-medium">{member.agent.name}</span>
                          {member.agent.hostname && (
                            <span className="block text-xs text-muted-foreground">
                              {member.agent.hostname}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Pill tone={member.source === 'EXPLICIT' ? 'brand' : 'neutral'}>
                            {member.source === 'EXPLICIT' ? 'Explicit' : 'Via selector'}
                          </Pill>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {formatDateTime(member.createdAt, userTimeZone, { format: 'date' })}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && member.source === 'EXPLICIT' ? (
                            <ConfirmAction
                              action={removeAgentFromPoolAction.bind(null, member.id)}
                              title={`Remove ${member.agent.name}?`}
                              description="This Agent will no longer receive new work targeted to this pool."
                              label="Remove"
                              variant="outline"
                              successMessage="Agent removed from pool"
                            />
                          ) : member.source !== 'EXPLICIT' ? (
                            <span className="text-xs text-muted-foreground">Via selector</span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyHint
                icon={Users}
                title="No members"
                description="Add an Agent explicitly or adjust the pool selector."
              />
            )}
            <nav
              aria-label="Member pagination"
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <span className="tabular-nums text-muted-foreground">
                Members {members.length} of {selected._count.members}
              </span>
              <span className="flex gap-3">
                {memberPage > 1 && (
                  <Link className="text-primary" href={memberHref(memberPage - 1)}>
                    Previous members
                  </Link>
                )}
                {memberPage * MEMBER_PAGE_SIZE < selected._count.members && (
                  <Link className="text-primary" href={memberHref(memberPage + 1)}>
                    Next members
                  </Link>
                )}
              </span>
            </nav>
            {canManage && (
              <ActionForm
                action={addAgentToPoolAction}
                className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-end"
                successMessage="Agent added to pool"
              >
                <input type="hidden" name="poolId" value={selected.id} />
                <div className="min-w-0 flex-1">
                  <SearchableRunbookSelect
                    kind="agent"
                    name="agentId"
                    label="Agent to add"
                    required
                  />
                </div>
                <SubmitButton>Add Agent</SubmitButton>
              </ActionForm>
            )}
          </div>
        </SectionCard>
      )}

      {pools.length === 0 ? (
        <EmptyHint
          icon={Network}
          title="No Agent pools"
          description="Group Agents that can safely share an execution target. Automation rules can then target the pool instead of a single Agent."
          className="bg-card"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pools.map(pool => {
            const selectors = labelEntries(pool.matchLabels);
            const isSelected = pool.id === selected?.id;
            return (
              <article
                key={pool.id}
                aria-label={pool.name}
                className={cn(
                  'flex flex-col rounded-xl border bg-card shadow-xs transition-colors',
                  isSelected && 'border-primary/50 ring-1 ring-primary/30'
                )}
              >
                <div className="space-y-2 border-b px-5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                        <Network className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <h2 className="break-words text-sm font-semibold">{pool.name}</h2>
                    </div>
                    <Pill tone={pool.mode === 'SHARED_TARGET' ? 'info' : 'neutral'}>
                      {pool.mode === 'SHARED_TARGET' ? 'Shared target' : 'Local hosts'}
                    </Pill>
                  </div>
                  {pool.description && (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {pool.description}
                    </p>
                  )}
                </div>
                <div className="flex-1 space-y-4 px-5 py-4 text-sm">
                  <dl className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-muted/40 px-3 py-2">
                      <dt className="text-[11px] text-muted-foreground">Agents</dt>
                      <dd className="text-lg font-semibold tabular-nums">{pool._count.members}</dd>
                    </div>
                    <div className="rounded-lg bg-muted/40 px-3 py-2">
                      <dt className="text-[11px] text-muted-foreground">Rules</dt>
                      <dd className="text-lg font-semibold tabular-nums">{pool._count.bindings}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    {pool.mode === 'SHARED_TARGET'
                      ? 'Any healthy member can operate the same target.'
                      : 'Each Agent represents a different machine. Select a specific Agent for writes.'}
                  </p>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      Label selector
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectors.length > 0 ? (
                        selectors.map(([key, value]) => (
                          <span
                            key={key}
                            className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                          >
                            {key}={value}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Explicit membership only
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      Services using this pool
                    </span>
                    {pool.bindings.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5">
                        {pool.bindings.map(binding => (
                          <li key={binding.service.id}>
                            <Link
                              href={`/services/${binding.service.id}?tab=runbooks`}
                              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Server aria-hidden="true" className="h-3 w-3" />
                              {binding.service.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not targeted by any service</p>
                    )}
                  </div>
                  {canManage && (
                    <details className="group rounded-lg border px-3 py-2">
                      <summary className="cursor-pointer rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Dynamic label selector
                      </summary>
                      <ActionForm action={updateSchedulingLabelsAction} className="mt-2 space-y-2">
                        <input type="hidden" name="id" value={pool.id} />
                        <input type="hidden" name="kind" value="pool" />
                        <Textarea
                          name="labels"
                          aria-label={`Selector for ${pool.name}`}
                          defaultValue={JSON.stringify(pool.matchLabels)}
                          className="font-mono text-xs"
                        />
                        <SubmitButton size="sm" variant="outline">
                          Save pool selector
                        </SubmitButton>
                      </ActionForm>
                    </details>
                  )}
                </div>
                <div className="border-t px-5 py-3">
                  <Button asChild variant={isSelected ? 'secondary' : 'outline'} size="sm">
                    <Link
                      href={fleetHref(POOLS_PATH, { page, pool: pool.id })}
                      aria-current={isSelected ? 'true' : undefined}
                    >
                      Manage pool
                    </Link>
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <RunbookPagination
        page={page}
        total={poolTotal}
        query={selected ? { pool: selected.id, memberPage: String(memberPage) } : {}}
      />
    </FleetPageShell>
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
