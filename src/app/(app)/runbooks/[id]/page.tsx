import { randomUUID } from 'node:crypto';
import { RunbookPagination, runbookPageQuery } from '@/components/runbooks/RunbookPagination';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  Activity,
  Archive,
  CheckCircle2,
  FileX,
  Hash,
  History,
  Layers,
  LayoutDashboard,
  Lock,
  PencilLine,
  PlayCircle,
  Server,
  ShieldAlert,
  Users,
  Workflow,
} from 'lucide-react';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { parseRunbookDefinition } from '@/lib/runbooks/definition';
import { checkRunbookDeleteEligibility } from '@/lib/runbooks/lifecycle';
import { RunbookCannotDeleteError } from '@/lib/runbooks/errors';
import {
  archiveRunbookAction,
  cloneVersionAction,
  deleteRunbookAction,
  duplicateRunbookAction,
  publishDraftAction,
  restoreRunbookAction,
  saveDraftAction,
  updateRunbookMetadataAction,
} from '../actions';
import { retireVersionAction } from './version-actions';
import DetailTabs from '@/components/ui/DetailTabs';
import RunbookBuilder from '@/components/runbooks/RunbookBuilder';
import {
  ActionForm,
  ConfirmAction,
  ConfigureSheet,
  StatusBadge,
  SubmitButton,
} from '@/components/runbooks/RunbookControls';
import { EmptyHint, Pill, SectionCard } from '@/components/runbooks/ui/primitives';
import { RunbookOverview, computeSuccessRate } from '@/components/runbooks/detail/RunbookOverview';
import { VersionTimeline } from '@/components/runbooks/detail/VersionTimeline';
import { RunbookDetailsSheet } from '@/components/runbooks/detail/RunbookDetailsSheet';
import { RunbookActionsMenu } from '@/components/runbooks/detail/RunbookActionsMenu';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';

export const revalidate = 0;
export default async function RunbookDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const { id } = await params;
  const { query, page: rawVersionPage } = runbookPageQuery(await searchParams);
  const rawBindingPage = Math.max(1, Math.min(10000, Number(query.bindingPage) || 1));
  const permissionsPromise = getUserPermissions();
  const userPromise = getCurrentUser();

  const runbookMeta = await prisma.runbook.findUnique({
    where: { id },
    select: {
      _count: { select: { versions: true, bindings: true } },
    },
  });
  if (!runbookMeta) notFound();

  const versionPage = Math.min(
    rawVersionPage,
    Math.max(1, Math.ceil(runbookMeta._count.versions / 20))
  );
  const bindingPage = Math.min(
    rawBindingPage,
    Math.max(1, Math.ceil(runbookMeta._count.bindings / 20))
  );

  const [permissions, user, runbook, serviceCount, topServiceGroups] = await Promise.all([
    permissionsPromise,
    userPromise,
    prisma.runbook.findUnique({
      where: { id },
      include: {
        ownerTeam: { select: { id: true, name: true } },
        draftVersion: { include: { inputs: { orderBy: { sequence: 'asc' } } } },
        publishedVersion: { include: { inputs: { orderBy: { sequence: 'asc' } } } },
        versions: {
          orderBy: { version: 'desc' },
          skip: (versionPage - 1) * 20,
          take: 20,
          select: {
            id: true,
            version: true,
            state: true,
            publishedAt: true,
            createdAt: true,
            checksum: true,
            publishedBy: { select: { name: true, email: true } },
            _count: {
              select: {
                executions: true,
                bindings: { where: { versionStrategy: 'PINNED', detachedAt: null } },
              },
            },
          },
        },
        bindings: {
          include: { service: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (bindingPage - 1) * 20,
          take: 20,
        },
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: {
            id: true,
            status: true,
            incidentId: true,
            createdAt: true,
            runbookVersion: { select: { version: true } },
          },
        },
        _count: { select: { executions: true, bindings: true, versions: true } },
      },
    }),
    prisma.service.count({ where: { runbookBindings: { some: { runbookId: id } } } }),
    prisma.serviceAutomationRule.groupBy({
      by: ['serviceId'],
      where: { runbookId: id },
      _count: { _all: true },
      orderBy: { _count: { serviceId: 'desc' } },
      take: 5,
    }),
  ]);
  if (!runbook) notFound();
  const userTimeZone = getUserTimeZone(user);
  const isArchived = Boolean(runbook.archivedAt);
  const hasManageCapability = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE);
  const canManage = hasManageCapability && !isArchived;
  const canPublish = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_PUBLISH) && !isArchived;
  type NamedEntity = { id: string; name: string };
  const [deleteEligibility, topServiceNames, teams] = await Promise.all([
    hasManageCapability ? checkRunbookDeleteEligibility(id) : null,
    topServiceGroups.length
      ? prisma.service.findMany({
          where: { id: { in: topServiceGroups.map(group => group.serviceId) } },
          select: { id: true, name: true },
        })
      : Promise.resolve<NamedEntity[]>([]),
    canManage
      ? prisma.team.findMany({
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
          take: 500,
        })
      : Promise.resolve<NamedEntity[]>([]),
  ]);
  if (runbook.ownerTeam && !teams.some(team => team.id === runbook.ownerTeam!.id)) {
    teams.unshift(runbook.ownerTeam);
  }

  const runbookSlug = runbook.slug;
  const runbookName = runbook.name;

  async function handleDeleteRunbook(formData: FormData) {
    'use server';
    const confirmation = String(formData.get('confirmation') || '').trim();
    if (!confirmation) {
      return { error: 'Confirmation text is required to permanently delete this runbook.' };
    }
    if (confirmation !== runbookSlug.trim() && confirmation !== runbookName.trim()) {
      return {
        error: `Confirmation text "${confirmation}" did not match the Runbook name ("${runbookName}") or slug ("${runbookSlug}").`,
      };
    }
    try {
      await deleteRunbookAction(id, confirmation);
    } catch (err) {
      if (err instanceof RunbookCannotDeleteError) {
        return { error: err.message };
      }
      return {
        error:
          'This runbook cannot be deleted. Check its execution history and published versions, then try again.',
      };
    }
    redirect('/runbooks');
  }

  async function handleRestoreRunbook() {
    'use server';
    await restoreRunbookAction(id);
  }
  const selectedVersion = query.version
    ? await prisma.runbookVersion.findFirst({
        where: { id: query.version, runbookId: id },
        include: { inputs: { orderBy: { sequence: 'asc' } } },
      })
    : null;
  const source = selectedVersion ?? runbook.draftVersion ?? runbook.publishedVersion;
  const nextDraftSource = runbook.draftVersion
    ? null
    : (runbook.publishedVersion ?? runbook.versions[0] ?? null);
  const exportHref = `/api/runbooks/${id}/export`;
  const draftExportHref =
    runbook.draftVersion && runbook.publishedVersion
      ? `${exportHref}?version=${runbook.draftVersion.id}`
      : null;
  const formatTimestamp = (value: Date) =>
    formatDateTime(value, userTimeZone, { format: 'datetime', includeTimeZone: true });

  const sourceDefinition = source ? parseRunbookDefinition(source.definition) : null;
  const builder =
    source && sourceDefinition ? (
      <div className="space-y-4">
        {source.state !== 'DRAFT' && (
          <div
            role="note"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
          >
            <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Version {source.version} is {source.state.toLowerCase()} and read-only.
              {canManage &&
                !runbook.draftVersion &&
                ' Create the next editable draft to make changes.'}
            </span>
            {runbook.draftVersion && source.id !== runbook.draftVersion.id && (
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                href={`/runbooks/${id}?tab=builder`}
              >
                Open draft v{runbook.draftVersion.version}
              </Link>
            )}
          </div>
        )}
        <RunbookBuilder
          key={source.id}
          initialEditorTab={query.editor}
          initialStepIdentities={sourceDefinition.steps.map(() => randomUUID())}
          initialInputIdentities={source.inputs.map(() => randomUUID())}
          initialDefinition={sourceDefinition}
          initialInputs={source.inputs.map(
            ({ key, label, type, required, defaultValue, description, sequence, options }) => ({
              key,
              label,
              type,
              required,
              ...(defaultValue === null ? {} : { defaultValue }),
              description,
              sequence,
              ...(type === 'SELECT' ? { options } : {}),
            })
          )}
          action={saveDraftAction.bind(null, source.id, runbook.id)}
          initialDraftRevision={source.draftRevision}
          readOnly={!canManage || source.state !== 'DRAFT'}
        />
      </div>
    ) : (
      <EmptyHint
        icon={FileX}
        title="No definition available"
        description="This runbook has no saved version yet."
      />
    );

  const servicesById = new Map(topServiceNames.map(service => [service.id, service.name]));
  const overviewExecutions = runbook.executions.map(execution => ({
    id: execution.id,
    status: execution.status,
    createdAtLabel: formatTimestamp(execution.createdAt),
    incidentId: execution.incidentId,
    version: execution.runbookVersion?.version ?? null,
  }));
  const overview = (
    <RunbookOverview
      runbookId={id}
      publishedVersion={
        runbook.publishedVersion
          ? {
              version: runbook.publishedVersion.version,
              publishedAtLabel: runbook.publishedVersion.publishedAt
                ? formatTimestamp(runbook.publishedVersion.publishedAt)
                : null,
            }
          : null
      }
      draftVersion={
        runbook.draftVersion
          ? {
              version: runbook.draftVersion.version,
              revision: runbook.draftVersion.draftRevision,
            }
          : null
      }
      serviceCount={serviceCount}
      executionCount={runbook._count.executions}
      lastExecution={overviewExecutions[0] ?? null}
      successRate={computeSuccessRate(runbook.executions.map(execution => execution.status))}
      services={topServiceGroups.flatMap(group => {
        const name = servicesById.get(group.serviceId);
        return name ? [{ id: group.serviceId, name, ruleCount: group._count._all }] : [];
      })}
      recentExecutions={overviewExecutions.slice(0, 5)}
      definitionSummary={
        source && sourceDefinition
          ? {
              version: source.version,
              state: source.state,
              stepCount: sourceDefinition.steps.length,
              inputs: source.inputs.map(input => ({
                key: input.key,
                label: input.label,
                type: input.type,
                required: input.required,
              })),
            }
          : null
      }
    />
  );

  const publishedId = runbook.publishedVersionId;
  const publishedNumber = runbook.publishedVersion?.version;
  const versionItems = runbook.versions.map(version => ({
    id: version.id,
    version: version.version,
    state: version.state,
    isCurrentPublished: version.id === publishedId,
    isCurrentDraft: version.id === runbook.draftVersionId,
    publishedByLabel: version.publishedBy?.name || version.publishedBy?.email || null,
    publishedAtLabel: version.publishedAt ? formatTimestamp(version.publishedAt) : null,
    createdAtLabel: formatTimestamp(version.createdAt),
    checksum: version.checksum,
    executionCount: version._count.executions,
    pinnedRuleCount: version._count.bindings,
    viewHref: `/runbooks/${id}?version=${version.id}&tab=builder`,
    compareHref:
      publishedId && publishedNumber !== undefined && version.id !== publishedId
        ? version.version < publishedNumber
          ? `/runbooks/${id}/compare?base=${version.id}&next=${publishedId}`
          : `/runbooks/${id}/compare?base=${publishedId}&next=${version.id}`
        : null,
    restoreAction:
      canManage && !runbook.draftVersionId && version.state !== 'DRAFT'
        ? cloneVersionAction.bind(null, version.id, runbook.id)
        : undefined,
    retireAction:
      canPublish && version.state === 'PUBLISHED' && version.id !== publishedId
        ? retireVersionAction.bind(null, version.id, runbook.id)
        : undefined,
  }));

  const primaryAction =
    isArchived && hasManageCapability ? (
      <ConfirmAction
        action={handleRestoreRunbook}
        label="Restore Runbook"
        variant="default"
        title={`Restore ${runbook.name}?`}
        description="Restores this runbook to the active library. All service bindings will remain disabled until re-enabled."
        successMessage="Runbook restored"
      />
    ) : canPublish && runbook.draftVersion ? (
      <ConfirmAction
        action={publishDraftAction.bind(null, runbook.draftVersion.id, runbook.id)}
        label="Publish draft"
        variant="default"
        title={`Publish immutable v${runbook.draftVersion.version}?`}
        description="Only the saved draft is published. Save any builder changes first. Published definitions cannot be edited."
        successMessage="Draft published"
      />
    ) : canManage && nextDraftSource ? (
      <ActionForm
        action={cloneVersionAction.bind(null, nextDraftSource.id, runbook.id)}
        successMessage="Draft created"
      >
        <SubmitButton size="sm" pendingLabel="Creating draft…">
          <PencilLine className="h-4 w-4" aria-hidden="true" />
          Create next editable draft
        </SubmitButton>
      </ActionForm>
    ) : null;

  const successMetric = computeSuccessRate(runbook.executions.map(execution => execution.status));
  const successRateDisplay =
    successMetric.completed > 0
      ? `${Math.round((successMetric.succeeded / successMetric.completed) * 100)}%`
      : '100%';

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      {/* Canonical DetailHeroBanner */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Runbooks',
          href: '/runbooks',
          current: runbook.name,
        }}
        tag="Automation & Remediation Catalog"
        title={runbook.name}
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <Workflow className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        badges={
          <>
            {runbook.publishedVersion && (
              <Badge
                variant="outline"
                size="xs"
                className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px] font-mono gap-1"
              >
                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                Published v{runbook.publishedVersion.version}
              </Badge>
            )}
            {runbook.draftVersion && (
              <Badge
                variant="outline"
                size="xs"
                className="bg-amber-500/10 text-amber-300 border-amber-500/30 text-[10px] font-mono gap-1"
              >
                <PencilLine className="h-3 w-3 text-amber-400" />
                Draft v{runbook.draftVersion.version}
              </Badge>
            )}
            {isArchived && (
              <Badge
                variant="outline"
                size="xs"
                className="bg-rose-500/10 text-rose-300 border-rose-500/30 text-[10px] gap-1"
              >
                <Archive className="h-3 w-3 text-rose-400" />
                Archived
              </Badge>
            )}
            {runbook.ownerTeam ? (
              <Badge
                variant="outline"
                size="xs"
                className="bg-zinc-800/80 text-slate-300 border-zinc-700/80 text-[10px] gap-1"
              >
                <Users className="h-3 w-3 text-slate-400" />
                {runbook.ownerTeam.name}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                size="xs"
                className="bg-zinc-800/60 text-slate-400 border-zinc-700/60 text-[10px] gap-1"
              >
                <Users className="h-3 w-3" />
                No owner team
              </Badge>
            )}
            <Badge
              variant="outline"
              size="xs"
              className="bg-zinc-800/80 text-slate-300 border-zinc-700/80 text-[10px] font-mono gap-1"
            >
              <Hash className="h-3 w-3 text-slate-400" />
              {runbook.slug}
            </Badge>
          </>
        }
        subtitle={
          <div className="space-y-1.5">
            <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
              {runbook.description ||
                'Enterprise automated remediation runbook with guardrails, parameter bindings, and auditable history.'}
            </p>
            {runbook.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {runbook.tags.map(tag => (
                  <Link
                    key={tag}
                    href={`/runbooks?tag=${encodeURIComponent(tag)}`}
                    className="rounded-full bg-zinc-800/80 px-2.5 py-0.5 font-mono text-[10px] text-slate-300 border border-zinc-700/80 hover:bg-zinc-700/80 hover:text-white transition-colors"
                  >
                    #{tag}
                  </Link>
                ))}
              </div>
            )}
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {primaryAction}
            {canManage && (
              <RunbookDetailsSheet
                runbook={{
                  name: runbook.name,
                  slug: runbook.slug,
                  description: runbook.description,
                  ownerTeamId: runbook.ownerTeamId,
                  tags: runbook.tags,
                }}
                teams={teams}
                action={updateRunbookMetadataAction.bind(null, runbook.id)}
                archiveAction={archiveRunbookAction.bind(null, runbook.id)}
              />
            )}
            <RunbookActionsMenu
              runbookId={id}
              runbookName={runbook.name}
              canRun={Boolean(runbook.publishedVersion) && !isArchived}
              exportHref={runbook.publishedVersion || runbook.draftVersion ? exportHref : null}
              draftExportHref={draftExportHref}
              duplicateAction={
                hasManageCapability ? duplicateRunbookAction.bind(null, runbook.id) : undefined
              }
              duplicateDescription={
                runbook.draftVersion
                  ? `Creates a new draft copy based on the current draft (v${runbook.draftVersion.version}).`
                  : runbook.publishedVersion
                    ? `Creates a new draft copy based on the published version (v${runbook.publishedVersion.version}).`
                    : 'Creates a new draft copy with identical metadata.'
              }
            />
          </div>
        }
        stats={[
          {
            label: 'Live Version',
            value: runbook.publishedVersion ? `v${runbook.publishedVersion.version}` : 'None',
            subtext: runbook.publishedVersion?.publishedAt
              ? `Published ${formatTimestamp(runbook.publishedVersion.publishedAt)}`
              : 'No published build',
            icon: <CheckCircle2 className="h-4 w-4" />,
          },
          {
            label: 'Active Draft',
            value: runbook.draftVersion ? `v${runbook.draftVersion.version}` : 'None',
            subtext: runbook.draftVersion
              ? `Revision r${runbook.draftVersion.draftRevision}`
              : 'Working copy synced',
            icon: <PencilLine className="h-4 w-4" />,
          },
          {
            label: 'Bound Services',
            value: serviceCount,
            subtext: `${topServiceGroups.length} active service triggers`,
            icon: <Server className="h-4 w-4" />,
          },
          {
            label: 'Total Runs',
            value: runbook._count.executions,
            subtext: overviewExecutions[0]
              ? `Last ${overviewExecutions[0].createdAtLabel}`
              : 'No execution runs yet',
            icon: <History className="h-4 w-4" />,
          },
          {
            label: 'Success Rate',
            value: successRateDisplay,
            subtext: 'Across recorded runs',
            icon: <Activity className="h-4 w-4" />,
          },
        ]}
        alert={
          isArchived ? (
            <div
              role="note"
              className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200"
            >
              <Archive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">This runbook is archived</p>
                <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
                  It can’t be edited, published or run. Execution history is preserved.
                </p>
              </div>
            </div>
          ) : undefined
        }
      />
      <DetailTabs
        defaultTab={runbook.draftVersion ? 'builder' : 'overview'}
        tabs={[
          {
            id: 'overview',
            label: 'Overview',
            icon: <LayoutDashboard className="h-4 w-4" />,
            content: overview,
          },
          {
            id: 'builder',
            label: 'Workflow',
            icon: <Workflow className="h-4 w-4" />,
            content: builder,
          },
          {
            id: 'versions',
            label: 'Versions',
            icon: <History className="h-4 w-4" />,
            count: runbook._count.versions,
            content: (
              <SectionCard
                title="Version history"
                description="Published versions are immutable. Compare any version with the live one before rolling forward."
                icon={History}
                actions={
                  <RunbookPagination
                    page={versionPage}
                    total={runbook._count.versions}
                    query={query}
                  />
                }
              >
                <VersionTimeline versions={versionItems} />
              </SectionCard>
            ),
          },
          {
            id: 'bindings',
            label: 'Usage',
            icon: <Layers className="h-4 w-4" />,
            count: runbook._count.bindings,
            content: (
              <SectionCard
                title="Service bindings"
                description="Services that can run this runbook, and which version they follow."
                icon={Layers}
                bodyClassName="p-0"
                actions={
                  runbook._count.bindings > 20 ? (
                    <nav
                      aria-label="Binding pages"
                      className="flex items-center gap-3 text-xs text-muted-foreground"
                    >
                      <span className="tabular-nums">
                        {(bindingPage - 1) * 20 + 1}–
                        {Math.min(bindingPage * 20, runbook._count.bindings)} of{' '}
                        {runbook._count.bindings}
                      </span>
                      {bindingPage > 1 && (
                        <Link
                          className="font-medium text-primary hover:underline"
                          href={`/runbooks/${id}?tab=bindings&bindingPage=${bindingPage - 1}`}
                        >
                          Previous
                        </Link>
                      )}
                      {bindingPage * 20 < runbook._count.bindings && (
                        <Link
                          className="font-medium text-primary hover:underline"
                          href={`/runbooks/${id}?tab=bindings&bindingPage=${bindingPage + 1}`}
                        >
                          Next
                        </Link>
                      )}
                    </nav>
                  ) : undefined
                }
              >
                {runbook.bindings.length > 0 ? (
                  <ul className="divide-y">
                    {runbook.bindings.map(binding => (
                      <li key={binding.id}>
                        <Link
                          href={`/services/${binding.service.id}?tab=runbooks`}
                          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {binding.service.name}
                            </span>
                            {binding.name && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {binding.name}
                              </span>
                            )}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Pill tone={binding.versionStrategy === 'PINNED' ? 'info' : 'neutral'}>
                              {binding.versionStrategy === 'PINNED' ? 'Pinned' : 'Latest published'}
                            </Pill>
                            <Pill tone={binding.enabled ? 'success' : 'neutral'}>
                              {binding.enabled ? binding.mode : 'DISABLED'}
                            </Pill>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="p-5">
                    <EmptyHint
                      icon={Layers}
                      title="No service bindings"
                      description="Attach the published runbook from a service’s Runbooks tab."
                    />
                  </div>
                )}
              </SectionCard>
            ),
          },
          {
            id: 'executions',
            label: 'Executions',
            icon: <PlayCircle className="h-4 w-4" />,
            count: runbook._count.executions,
            content: (
              <SectionCard
                title="Recent executions"
                description="The latest 30 runs across all versions."
                icon={PlayCircle}
                bodyClassName="p-0"
                actions={
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/runbooks/executions?runbook=${runbook.id}`}>
                      View all executions
                    </Link>
                  </Button>
                }
              >
                {runbook.executions.length > 0 ? (
                  <ul className="divide-y">
                    {runbook.executions.map(execution => (
                      <li
                        key={execution.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <Link
                            className="block text-sm font-medium underline-offset-4 hover:underline"
                            href={`/runbooks/executions/${execution.id}`}
                          >
                            {formatTimestamp(execution.createdAt)}
                            <span className="sr-only"> · Open full execution</span>
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {execution.runbookVersion
                              ? `Version ${execution.runbookVersion.version}`
                              : 'Version unknown'}
                            {execution.incidentId && (
                              <>
                                {' · '}
                                <Link
                                  className="text-primary underline-offset-4 hover:underline"
                                  href={`/incidents/${execution.incidentId}?tab=runbooks`}
                                >
                                  Inspect incident execution
                                </Link>
                              </>
                            )}
                          </p>
                        </div>
                        <StatusBadge status={execution.status} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="p-5">
                    <EmptyHint
                      icon={PlayCircle}
                      title="No executions yet"
                      description="Run history appears here after responders start this runbook."
                    />
                  </div>
                )}
              </SectionCard>
            ),
          },
        ]}
      />
      {hasManageCapability && (
        <SectionCard
          tone="danger"
          icon={ShieldAlert}
          title="Danger zone"
          description="Lifecycle changes that affect every service using this runbook."
          bodyClassName="divide-y divide-border/60 py-0"
        >
          <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">
                {isArchived ? 'Restore to active library' : 'Archive runbook'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isArchived
                  ? 'Re-enables management. Bindings stay disabled until reviewed.'
                  : 'Disables all executions and bindings while preserving execution and audit history.'}
              </p>
            </div>
            {isArchived ? (
              <ConfirmAction
                action={handleRestoreRunbook}
                title={`Restore ${runbook.name}?`}
                description="Restores this runbook to the active library. All service bindings will remain disabled until re-enabled."
                label="Restore Runbook"
                variant="outline"
                successMessage="Runbook restored"
              />
            ) : (
              <ConfirmAction
                action={archiveRunbookAction.bind(null, runbook.id)}
                title={`Archive ${runbook.name}?`}
                description="This removes the Runbook from the active library and disables all bindings. Historical executions are preserved."
                label="Archive Runbook"
                variant="outline"
              />
            )}
          </div>

          <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-start">
            <div className="max-w-xl space-y-1">
              <p className="text-sm font-medium text-destructive">Permanently delete runbook</p>
              <p className="text-xs text-muted-foreground">
                {deleteEligibility?.canDelete
                  ? 'This runbook has no published versions and no executions. Deletion is permanent.'
                  : (deleteEligibility?.reason ??
                    'This runbook has historical executions or published versions and cannot be deleted. Archive it instead.')}
              </p>
            </div>
            {deleteEligibility?.canDelete && (
              <ConfigureSheet
                title={`Delete ${runbook.name}`}
                description={`To permanently delete this runbook, type its exact slug "${runbook.slug}" or name "${runbook.name}" to confirm.`}
                trigger={
                  <Button variant="destructive" size="sm" className="rounded-xl shadow-2xs">
                    Delete runbook
                  </Button>
                }
              >
                <ActionForm
                  action={handleDeleteRunbook}
                  className="space-y-4"
                  successMessage="Runbook deleted"
                >
                  <div className="space-y-2">
                    <Label htmlFor="delete-confirmation" className="text-xs">
                      Confirm runbook name or slug
                    </Label>
                    <Input
                      id="delete-confirmation"
                      name="confirmation"
                      placeholder={runbook.slug}
                      required
                      autoComplete="off"
                      className="font-mono text-xs rounded-xl"
                    />
                  </div>
                  <SubmitButton variant="destructive" pendingLabel="Deleting…">
                    Permanently delete runbook
                  </SubmitButton>
                </ActionForm>
              </ConfigureSheet>
            )}
          </div>
        </SectionCard>
      )}
    </main>
  );
}
