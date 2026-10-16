import Link from 'next/link';
import { redirect } from 'next/navigation';
import { KeyRound, Lock, ShieldOff } from 'lucide-react';
import { z } from 'zod';
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
  createRunbookSecretAction,
  grantRunbookSecretAction,
  revokeRunbookSecretGrantAction,
  rotateRunbookSecretAction,
} from '../../actions';

export const revalidate = 0;

const SECRETS_PATH = '/runbooks/agents/secrets';
const GRANT_PAGE_SIZE = 20;

export default async function RunbookSecretsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUser()]);
  const canManageSecrets = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_SECRET_MANAGE);
  if (!canManageSecrets) redirect('/runbooks/agents');
  const userTimeZone = getUserTimeZone(user);
  const { query, page: requestedPage } = runbookPageQuery(await searchParams);
  const selectedSecret = z.string().cuid().safeParse(query.secret);
  const selectedId = selectedSecret.success ? selectedSecret.data : '';
  const requestedGrantPage = Math.max(1, Math.min(10000, Number(query.grantPage) || 1));

  const [navigation, secretTotal, selected] = await Promise.all([
    getRunbookNavigationSummary(),
    prisma.runbookSecret.count(),
    selectedId
      ? prisma.runbookSecret.findUnique({
          where: { id: selectedId },
          select: {
            id: true,
            name: true,
            description: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { grants: true } },
          },
        })
      : Promise.resolve(null),
  ]);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(secretTotal / RUNBOOK_PAGE_SIZE)));
  const grantPage = selected
    ? Math.min(requestedGrantPage, Math.max(1, Math.ceil(selected._count.grants / GRANT_PAGE_SIZE)))
    : 1;
  const [secrets, grants] = await Promise.all([
    prisma.runbookSecret.findMany({
      skip: (page - 1) * RUNBOOK_PAGE_SIZE,
      take: RUNBOOK_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
        _count: { select: { grants: true } },
      },
      orderBy: { name: 'asc' },
    }),
    selected
      ? prisma.runbookSecretGrant.findMany({
          where: { secretId: selected.id },
          skip: (grantPage - 1) * GRANT_PAGE_SIZE,
          take: GRANT_PAGE_SIZE,
          orderBy: { id: 'asc' },
          select: {
            id: true,
            createdAt: true,
            agent: { select: { name: true } },
            agentPool: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const grantHref = (target: number) =>
    fleetHref(SECRETS_PATH, { page, secret: selected?.id, grantPage: target });

  return (
    <FleetPageShell
      title="Scoped Secrets"
      section="Secrets"
      icon={KeyRound}
      description="Credentials are encrypted at rest and resolved only by the Agents or pools they are granted to. Values are never displayed; secret-backed Agent steps require HTTPS."
      navigation={navigation}
      canManageSecrets={canManageSecrets}
      actions={
        <ConfigureSheet
          title="Create scoped secret"
          description="Grant the credential only to the Agent or pool that requires it."
          trigger={<Button>Create secret</Button>}
        >
          <ActionForm
            action={createRunbookSecretAction}
            className="space-y-4"
            successMessage="Secret created"
          >
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
            <SearchableRunbookSelect
              kind="target"
              name="target"
              label="Initial secret grant"
              required
            />
            <SubmitButton>Create encrypted secret</SubmitButton>
          </ActionForm>
        </ConfigureSheet>
      }
    >
      <div
        className={`grid gap-6 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]' : ''}`}
      >
        <section aria-label="Secrets" className="min-w-0 space-y-4">
          {secrets.length === 0 ? (
            <EmptyHint
              icon={KeyRound}
              title="No scoped secrets"
              description="Create encrypted credentials and grant each to a specific Agent or pool."
              className="bg-card"
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs">
              <Table>
                <TableCaption className="sr-only">Scoped secrets</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Description</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Grants</TableHead>
                    <TableHead className="hidden sm:table-cell">Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {secrets.map(secret => {
                    const isSelected = secret.id === selected?.id;
                    return (
                      <TableRow key={secret.id} data-state={isSelected ? 'selected' : undefined}>
                        <TableCell className="break-all">
                          <span className="flex items-center gap-2 font-mono text-xs font-medium">
                            <Lock
                              aria-hidden="true"
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            />
                            {secret.name}
                          </span>
                        </TableCell>
                        <TableCell className="hidden max-w-[20rem] truncate text-xs text-muted-foreground md:table-cell">
                          {secret.description || '—'}
                        </TableCell>
                        <TableCell>
                          <span
                            className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs tracking-widest text-muted-foreground"
                            aria-label="Secret value hidden"
                          >
                            ••••••••
                          </span>
                        </TableCell>
                        <TableCell>
                          <Pill tone={secret._count.grants ? 'brand' : 'warning'}>
                            <span className="tabular-nums">{secret._count.grants}</span>
                            {secret._count.grants === 1 ? ' grant' : ' grants'}
                          </Pill>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-xs sm:table-cell">
                          {formatDateTime(secret.updatedAt, userTimeZone, { format: 'date' })}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant={isSelected ? 'secondary' : 'outline'} size="sm">
                            <Link
                              href={fleetHref(SECRETS_PATH, { page, secret: secret.id })}
                              aria-current={isSelected ? 'true' : undefined}
                            >
                              Manage grants / Rotate
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <RunbookPagination
            page={page}
            total={secretTotal}
            query={selected ? { secret: selected.id, grantPage: String(grantPage) } : {}}
          />
        </section>

        {selected && (
          <SectionCard
            icon={Lock}
            title={
              <span id="secret-detail-title" className="break-all font-mono">
                {selected.name}
              </span>
            }
            description={
              <>
                {selected.description || 'No description'} · Created{' '}
                {formatDateTime(selected.createdAt, userTimeZone, { format: 'date' })} · Updated{' '}
                {formatDateTime(selected.updatedAt, userTimeZone, { format: 'date' })}
              </>
            }
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link href={fleetHref(SECRETS_PATH, { page })}>Close</Link>
              </Button>
            }
            className="min-w-0 self-start border-primary/30"
            bodyClassName="space-y-6"
          >
            <div aria-labelledby="secret-detail-title" className="space-y-6">
              <section aria-labelledby="secret-grants-title" className="space-y-3">
                <h3 id="secret-grants-title" className="text-sm font-semibold">
                  Grants
                </h3>
                {grants.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs">
                    <Table>
                      <TableCaption className="sr-only">Grants for {selected.name}</TableCaption>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Target</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {grants.map(grant => (
                          <TableRow key={grant.id}>
                            <TableCell className="text-sm">
                              {grant.agentPool?.name ?? grant.agent?.name ?? 'Deleted target'}
                              <span className="block text-[11px] text-muted-foreground">
                                Granted{' '}
                                {formatDateTime(grant.createdAt, userTimeZone, { format: 'date' })}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Pill tone={grant.agentPool ? 'info' : 'neutral'}>
                                {grant.agentPool ? 'Pool' : 'Agent'}
                              </Pill>
                            </TableCell>
                            <TableCell className="text-right">
                              <ConfirmAction
                                action={revokeRunbookSecretGrantAction.bind(null, grant.id)}
                                title="Revoke this secret grant?"
                                description="The target can no longer resolve this credential for new steps. Previously resolved values cannot be recalled."
                                label="Revoke grant"
                                variant="outline"
                                successMessage="Grant revoked"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyHint
                    icon={ShieldOff}
                    title="Not granted"
                    description="No Agent or pool can resolve this secret."
                  />
                )}
                <nav
                  aria-label="Grant pagination"
                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <span className="tabular-nums text-muted-foreground">
                    Grants {grants.length} of {selected._count.grants}
                  </span>
                  <span className="flex gap-3">
                    {grantPage > 1 && (
                      <Link className="text-primary" href={grantHref(grantPage - 1)}>
                        Previous grants
                      </Link>
                    )}
                    {grantPage * GRANT_PAGE_SIZE < selected._count.grants && (
                      <Link className="text-primary" href={grantHref(grantPage + 1)}>
                        Next grants
                      </Link>
                    )}
                  </span>
                </nav>
                <ActionForm
                  action={grantRunbookSecretAction.bind(null, selected.id)}
                  className="space-y-3"
                  successMessage="Access granted"
                >
                  <SearchableRunbookSelect
                    kind="target"
                    name="target"
                    label="Grant to target"
                    required
                  />
                  <SubmitButton>Grant access</SubmitButton>
                </ActionForm>
              </section>

              <section
                aria-labelledby="secret-rotate-title"
                className="space-y-3.5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5"
              >
                <h3 id="secret-rotate-title" className="text-sm font-semibold">
                  Rotate value
                </h3>
                <ActionForm
                  action={rotateRunbookSecretAction.bind(null, selected.id)}
                  className="space-y-3"
                  successMessage="Secret rotated"
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
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      name="confirmRotation"
                      required
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    />
                    I understand new steps resolve the new value immediately and the previous value
                    cannot be restored.
                  </label>
                  <SubmitButton pendingLabel="Rotating…" variant="outline">
                    Rotate secret
                  </SubmitButton>
                </ActionForm>
              </section>
            </div>
          </SectionCard>
        )}
      </div>
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
