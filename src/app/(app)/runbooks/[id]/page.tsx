import { getRunbookNavigationSummary } from '@/lib/runbooks/presentation/summaries';
import { RunbookModuleNav } from '@/components/runbooks/RunbookModuleNav';
import { RunbookPagination, runbookPageQuery } from '@/components/runbooks/RunbookPagination';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Copy, History, Settings2 } from 'lucide-react';
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
import { RunbookPageHeader } from '@/components/runbooks/RunbookPageHeader';
import { RunbookMetricStrip } from '@/components/runbooks/RunbookMetricStrip';
import DetailTabs from '@/components/ui/DetailTabs';
import EmptyState from '@/components/ui/EmptyState';
import RunbookBuilder from '@/components/runbooks/RunbookBuilder';
import {
  ActionForm,
  ConfirmAction,
  ConfigureSheet,
  StatusBadge,
  SubmitButton,
} from '@/components/runbooks/RunbookControls';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { formatDateTime, getUserTimeZone } from '@/lib/timezone';

export const revalidate = 0;
export default async function RunbookDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const { id } = await params;
  const { query, page: rawVersionPage } = runbookPageQuery(await searchParams);
  const rawBindingPage = Math.max(1, Math.min(10000, Number(query.bindingPage) || 1));
  const navigationPromise = getRunbookNavigationSummary();
  const permissionsPromise = getUserPermissions();
  const userPromise = getCurrentUser();

  const runbookMeta = await prisma.runbook.findUnique({
    where: { id },
    select: {
      _count: { select: { versions: true, bindings: true } },
    },
  });
  if (!runbookMeta) notFound();

  const versionPage = Math.min(rawVersionPage, Math.max(1, Math.ceil(runbookMeta._count.versions / 20)));
  const bindingPage = Math.min(rawBindingPage, Math.max(1, Math.ceil(runbookMeta._count.bindings / 20)));

  const [permissions, user, runbook, navigation] = await Promise.all([
    permissionsPromise,
    userPromise,
    prisma.runbook.findUnique({
      where: { id },
      include: {
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
            _count: { select: { executions: true } },
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
          select: { id: true, status: true, incidentId: true, createdAt: true },
        },
        _count: { select: { executions: true, bindings: true, versions: true } },
      },
    }),
    navigationPromise,
  ]);
  if (!runbook) notFound();
  const userTimeZone = getUserTimeZone(user);
  const isArchived = Boolean(runbook.archivedAt);
  const hasManageCapability = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE);
  const canManage = hasManageCapability && !isArchived;
  const canPublish =
    permissions.capabilities.includes(CAPABILITIES.RUNBOOK_PUBLISH) && !isArchived;
  const deleteEligibility = hasManageCapability
    ? await checkRunbookDeleteEligibility(id)
    : null;

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
        error: 'This runbook cannot be deleted. Check its execution history and published versions, then try again.',
      };
    }
    redirect('/runbooks');
  }

  async function handleRestoreRunbook() {
    'use server';
    await restoreRunbookAction(id);
  }
  const selectedVersion = query.version ? await prisma.runbookVersion.findFirst({ where: { id: query.version, runbookId: id }, include: { inputs: { orderBy: { sequence: 'asc' } } } }) : null;
  const source = selectedVersion ?? runbook.draftVersion ?? runbook.publishedVersion;
  const builder = source ? (
    <div className="space-y-4">
      {!runbook.draftVersion && canManage && (
        <ActionForm action={cloneVersionAction.bind(null, source.id, runbook.id)}>
          <SubmitButton pendingLabel="Cloning…">
            <Copy className="h-4 w-4" />
            Create next editable draft
          </SubmitButton>
        </ActionForm>
      )}
      <RunbookBuilder
        key={source.id}
        initialDefinition={parseRunbookDefinition(source.definition)}
        initialInputs={source.inputs.map(
          ({ key, label, type, required, defaultValue, description, sequence }) => ({
            key,
            label,
            type: type === 'SELECT' ? 'STRING' : type,
            required,
            ...(defaultValue === null ? {} : { defaultValue }),
            description,
            sequence,
          })
        )}
        action={saveDraftAction.bind(null, source.id, runbook.id)}
        initialDraftRevision={source.draftRevision}
        readOnly={!canManage || source.state !== 'DRAFT'}
      />
    </div>
  ) : (
    <EmptyState title="No definition available" />
  );
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <RunbookPageHeader
        breadcrumbs={[
          { label: 'Runbooks', href: '/runbooks' },
          { label: runbook.name },
        ]}
        title={runbook.name}
        description={runbook.description || runbook.slug}
        badge={
          <div className="flex items-center gap-1.5">
            {runbook.publishedVersion && (
              <Badge variant="success">Published v{runbook.publishedVersion.version}</Badge>
            )}
            {runbook.draftVersion && (
              <Badge variant="warning">Draft v{runbook.draftVersion.version}</Badge>
            )}
            {runbook.archivedAt && <Badge variant="secondary">Archived</Badge>}
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canPublish && runbook.draftVersion && (
              <ConfirmAction
                action={publishDraftAction.bind(null, runbook.draftVersion.id, runbook.id)}
                label="Publish draft"
                variant="default"
                title={`Publish immutable v${runbook.draftVersion.version}?`}
                description="Only the saved draft is published. Save any builder changes first. Published definitions cannot be edited."
              />
            )}
            {hasManageCapability && (
              <ConfirmAction
                action={duplicateRunbookAction.bind(null, runbook.id)}
                label="Duplicate"
                variant="outline"
                title={`Duplicate ${runbook.name}?`}
                description={
                  runbook.draftVersion
                    ? `Creates a new draft copy of this runbook based on its current draft (v${runbook.draftVersion.version}).`
                    : runbook.publishedVersion
                    ? `Creates a new draft copy of this runbook based on its published version (v${runbook.publishedVersion.version}).`
                    : 'Creates a new draft copy of this runbook with identical metadata.'
                }
              />
            )}
            {isArchived && hasManageCapability && (
              <ConfirmAction
                action={handleRestoreRunbook}
                label="Restore Runbook"
                variant="default"
                title={`Restore ${runbook.name}?`}
                description="Restores this runbook to the active library. All service bindings will remain disabled until re-enabled."
              />
            )}
            {canManage && (
              <ConfigureSheet
                title="Runbook details"
                description="Stable metadata shared by every version."
                trigger={
                  <Button variant="secondary" size="sm">
                    <Settings2 className="h-4 w-4" />
                    Details
                  </Button>
                }
              >
                <ActionForm
                  action={updateRunbookMetadataAction.bind(null, runbook.id)}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label htmlFor="metadata-name">Name</Label>
                    <Input
                      id="metadata-name"
                      name="name"
                      defaultValue={runbook.name}
                      required
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="metadata-slug">Slug</Label>
                    <Input
                      id="metadata-slug"
                      name="slug"
                      defaultValue={runbook.slug}
                      required
                      maxLength={120}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="metadata-description">Description</Label>
                    <Textarea
                      id="metadata-description"
                      name="description"
                      defaultValue={runbook.description}
                    />
                  </div>
                  <SubmitButton>Save details</SubmitButton>
                </ActionForm>
                <ConfirmAction
                  action={archiveRunbookAction.bind(null, runbook.id)}
                  title={`Archive ${runbook.name}?`}
                  description="This removes the Runbook from the active library and prevents new executions. Existing execution history is retained."
                  label="Archive Runbook"
                />
              </ConfigureSheet>
            )}
          </div>
        }
      />
      {isArchived && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-sm">This runbook is archived</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Archived runbooks cannot be edited, published, or executed. Historical executions are preserved.
              </p>
            </div>
            {hasManageCapability && (
              <ConfirmAction
                action={handleRestoreRunbook}
                title={`Restore ${runbook.name}?`}
                description="Restores this runbook to the active library. All service bindings will remain disabled until re-enabled."
                label="Restore Runbook"
                variant="outline"
              />
            )}
          </div>
        </div>
      )}
      <RunbookMetricStrip
        stats={[
          { label: 'Services', value: runbook._count.bindings },
          { label: 'Executions', value: runbook._count.executions },
          { label: 'Versions', value: runbook._count.versions },
        ]}
      />
      <RunbookModuleNav summary={navigation} />
      <DetailTabs
        tabs={[
          { id: 'builder', label: 'Builder & Inputs', content: builder },
          {
            id: 'versions',
            label: 'Versions',
            icon: <History className="h-4 w-4" />,
            count: runbook._count.versions,
            content: (
              <section className="space-y-3">
                <RunbookPagination page={versionPage} total={runbook._count.versions} query={query} />
                {runbook.versions.map(version => (
                  <div
                    key={version.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
                  >
                    <div className="space-y-1">
                      <h2 className="font-semibold"><Link className="text-primary hover:underline" href={`/runbooks/${id}?version=${version.id}&tab=builder`}>Version {version.version}</Link></h2>
                      <p className="break-all text-xs text-muted-foreground">
                        {version._count.executions} executions · checksum{' '}
                        {version.checksum.slice(0, 12)}
                      </p>
                    </div>
                    <StatusBadge status={version.state} />
                  </div>
                ))}
              </section>
            ),
          },
          {
            id: 'bindings',
            label: 'Service Bindings',
            count: runbook._count.bindings,
            content: (
              <section className="space-y-3">
                {runbook._count.bindings > 20 && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground pb-2">
                    <span>
                      Showing {(bindingPage - 1) * 20 + 1}–{Math.min(bindingPage * 20, runbook._count.bindings)} of {runbook._count.bindings} bindings
                    </span>
                    <div className="flex gap-2">
                      {bindingPage > 1 && (
                        <Link className="text-primary hover:underline" href={`/runbooks/${id}?tab=bindings&bindingPage=${bindingPage - 1}`}>
                          Previous
                        </Link>
                      )}
                      {bindingPage * 20 < runbook._count.bindings && (
                        <Link className="text-primary hover:underline" href={`/runbooks/${id}?tab=bindings&bindingPage=${bindingPage + 1}`}>
                          Next
                        </Link>
                      )}
                    </div>
                  </div>
                )}
                {runbook.bindings.map(binding => (
                  <Link
                    key={binding.id}
                    href={`/services/${binding.service.id}?tab=runbooks`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:border-primary/30"
                  >
                    <span className="font-semibold">{binding.service.name}</span>
                    <Badge variant="outline">{binding.enabled ? binding.mode : 'DISABLED'}</Badge>
                  </Link>
                ))}
                {runbook.bindings.length === 0 && (
                  <EmptyState
                    title="No service bindings"
                    description="Attach this published Runbook from a service’s Runbooks tab."
                  />
                )}
              </section>
            ),
          },
          {
            id: 'executions',
            label: 'Executions',
            count: runbook._count.executions,
            content: (
              <section className="space-y-3">
                <Link className="text-sm text-primary hover:underline" href={`/runbooks/executions?runbook=${runbook.id}`}>View all executions</Link>
                {runbook.executions.map(execution => (
                  <div
                    key={execution.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
                  >
                    <div>
                      <p className="text-sm">
                        {formatDateTime(execution.createdAt, userTimeZone, { format: 'datetime' })}
                      </p>
                      <Link className="block text-sm text-primary hover:underline" href={`/runbooks/executions/${execution.id}`}>Open full execution</Link>
                      {execution.incidentId && (
                        <Link
                          className="text-sm text-primary hover:underline"
                          href={`/incidents/${execution.incidentId}?tab=runbooks`}
                        >
                          Inspect incident execution
                        </Link>
                      )}
                    </div>
                    <StatusBadge status={execution.status} />
                  </div>
                ))}
                {runbook.executions.length === 0 && (
                  <EmptyState
                    title="No executions yet"
                    description="Execution history appears after responders start this Runbook."
                  />
                )}
              </section>
            ),
          },
        ]}
      />
      {hasManageCapability && (
        <div className="rounded-xl border border-destructive/20 bg-card p-5 space-y-4">
          <div>
            <h3 className="font-semibold text-sm text-foreground">Danger Zone</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Lifecycle operations and irreversible entity state changes.
            </p>
          </div>
          <div className="divide-y divide-border/60">
            {/* Archive / Restore row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
              <div>
                <p className="text-xs font-medium text-foreground">
                  {isArchived ? 'Restore to active library' : 'Archive runbook'}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isArchived
                    ? 'Re-enables this runbook for ongoing management. Bindings remain disabled until reviewed.'
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

            {/* Permanent deletion row */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 py-3">
              <div className="space-y-1 max-w-xl">
                <p className="text-xs font-medium text-destructive">Permanently delete runbook</p>
                {deleteEligibility?.canDelete ? (
                  <p className="text-xs text-muted-foreground">
                    This runbook has zero published versions and zero executions. Deletion is permanent and cannot be undone.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {deleteEligibility?.reason ?? 'This runbook has historical executions or published versions and cannot be deleted. Archive it instead.'}
                  </p>
                )}
              </div>
              {deleteEligibility?.canDelete && (
                <ConfigureSheet
                  title={`Delete ${runbook.name}`}
                  description={`To permanently delete this runbook, type its exact slug "${runbook.slug}" or name "${runbook.name}" to confirm.`}
                  trigger={
                    <Button variant="destructive" size="sm" className="h-8 text-xs">
                      Delete runbook
                    </Button>
                  }
                >
                  <ActionForm action={handleDeleteRunbook} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="delete-confirmation" className="text-xs">
                        Confirm runbook name or slug
                      </Label>
                      <Input
                        id="delete-confirmation"
                        name="confirmation"
                        placeholder={runbook.slug}
                        required
                        className="text-xs font-mono"
                      />
                    </div>
                    <SubmitButton variant="destructive" pendingLabel="Deleting…">
                      Permanently delete runbook
                    </SubmitButton>
                  </ActionForm>
                </ConfigureSheet>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
