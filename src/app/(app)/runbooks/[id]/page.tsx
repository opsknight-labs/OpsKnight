import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookOpen, Copy, History, Settings2 } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getUserPermissions } from '@/lib/rbac';
import { parseRunbookDefinition } from '@/lib/runbooks/definition';
import {
  archiveRunbookAction,
  cloneVersionAction,
  publishDraftAction,
  saveDraftAction,
  updateRunbookMetadataAction,
} from '../actions';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
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

export const revalidate = 0;
export default async function RunbookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const { id } = await params;
  const [permissions, runbook] = await Promise.all([
    getUserPermissions(),
    prisma.runbook.findUnique({
      where: { id },
      include: {
        draftVersion: { include: { inputs: { orderBy: { sequence: 'asc' } } } },
        publishedVersion: { include: { inputs: { orderBy: { sequence: 'asc' } } } },
        versions: {
          orderBy: { version: 'desc' },
          include: { inputs: true, _count: { select: { executions: true } } },
        },
        bindings: {
          include: { service: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
        executions: {
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { id: true, status: true, incidentId: true, createdAt: true },
        },
        _count: { select: { executions: true, bindings: true } },
      },
    }),
  ]);
  if (!runbook) notFound();
  const canManage =
    permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE) && !runbook.archivedAt;
  const canPublish =
    permissions.capabilities.includes(CAPABILITIES.RUNBOOK_PUBLISH) && !runbook.archivedAt;
  const source = runbook.draftVersion ?? runbook.publishedVersion ?? runbook.versions[0];
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
        readOnly={!canManage || source.state !== 'DRAFT'}
      />
    </div>
  ) : (
    <EmptyState title="No definition available" />
  );
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <DetailHeroBanner
        breadcrumb={{ label: 'Runbooks', href: '/runbooks', current: runbook.name }}
        tag="RUNBOOK"
        title={runbook.name}
        subtitle={runbook.description || runbook.slug}
        icon={<BookOpen className="h-8 w-8" />}
        statsPlacement="bottom"
        badges={
          <>
            {runbook.publishedVersion && (
              <Badge variant="success">Published v{runbook.publishedVersion.version}</Badge>
            )}
            {runbook.draftVersion && (
              <Badge variant="warning">Draft v{runbook.draftVersion.version}</Badge>
            )}
            {runbook.archivedAt && <Badge variant="secondary">Archived</Badge>}
          </>
        }
        stats={[
          { label: 'Services', value: runbook._count.bindings },
          { label: 'Executions', value: runbook._count.executions },
          { label: 'Versions', value: runbook.versions.length },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {canPublish && runbook.draftVersion && (
              <ConfirmAction
                action={publishDraftAction.bind(null, runbook.draftVersion.id, runbook.id)}
                label="Publish draft"
                variant="default"
                title={`Publish immutable v${runbook.draftVersion.version}?`}
                description="Only the saved draft is published. Save any builder changes first. Published definitions cannot be edited."
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
      <DetailTabs
        tabs={[
          { id: 'builder', label: 'Builder & Inputs', content: builder },
          {
            id: 'versions',
            label: 'Versions',
            icon: <History className="h-4 w-4" />,
            count: runbook.versions.length,
            content: (
              <section className="space-y-3">
                {runbook.versions.map(version => (
                  <div
                    key={version.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
                  >
                    <div className="space-y-1">
                      <h2 className="font-semibold">Version {version.version}</h2>
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
            count: runbook.bindings.length,
            content: (
              <section className="space-y-3">
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
                {runbook.executions.map(execution => (
                  <div
                    key={execution.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
                  >
                    <div>
                      <p className="text-sm">{execution.createdAt.toLocaleString()}</p>
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
    </div>
  );
}
