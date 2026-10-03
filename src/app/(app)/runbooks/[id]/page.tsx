import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Archive, Copy, History, Save, ShieldCheck } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getUserPermissions } from '@/lib/rbac';
import {
  archiveRunbookAction,
  cloneVersionAction,
  publishDraftAction,
  saveDraftAction,
  updateRunbookMetadataAction,
} from '../actions';
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
        publishedVersion: true,
        versions: {
          orderBy: { version: 'desc' },
          include: { _count: { select: { executions: true } } },
        },
        bindings: {
          include: { service: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    }),
  ]);
  if (!runbook) notFound();
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE);
  const canPublish = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_PUBLISH);
  const sourceVersion = runbook.publishedVersion ?? runbook.versions[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 sm:p-6 lg:p-8">
      <Link
        href="/runbooks"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to runbooks
      </Link>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-3xl font-semibold">{runbook.name}</h1>
            {runbook.archivedAt && <Badge variant="secondary">Archived</Badge>}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{runbook.slug}</p>
        </div>
        {canManage && !runbook.archivedAt && (
          <form action={archiveRunbookAction.bind(null, runbook.id)}>
            <Button type="submit" variant="outline">
              <Archive /> Archive
            </Button>
          </form>
        )}
      </header>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Runbook details</CardTitle>
            <CardDescription>Stable identity shared by every version.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={updateRunbookMetadataAction.bind(null, runbook.id)}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" defaultValue={runbook.name} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" name="slug" defaultValue={runbook.slug} required />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" defaultValue={runbook.description} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" variant="outline">
                  <Save /> Save details
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {runbook.draftVersion ? (
        <Card className="border-amber-300/70">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">Draft v{runbook.draftVersion.version}</CardTitle>
                <CardDescription>
                  Definition and typed inputs are validated on the server before saving.
                </CardDescription>
              </div>
              <Badge variant="secondary">DRAFT</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {canManage ? (
              <form
                action={saveDraftAction.bind(null, runbook.draftVersion.id, runbook.id)}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="definition">Definition JSON</Label>
                  <Textarea
                    id="definition"
                    name="definition"
                    className="min-h-[360px] font-mono text-xs"
                    spellCheck={false}
                    defaultValue={JSON.stringify(runbook.draftVersion.definition, null, 2)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inputs">Typed inputs JSON</Label>
                  <Textarea
                    id="inputs"
                    name="inputs"
                    className="min-h-[180px] font-mono text-xs"
                    spellCheck={false}
                    defaultValue={JSON.stringify(
                      runbook.draftVersion.inputs.map(
                        ({ key, label, type, required, defaultValue, description, sequence }) => ({
                          key,
                          label,
                          type,
                          required,
                          ...(defaultValue === null ? {} : { defaultValue }),
                          description,
                          sequence,
                        })
                      ),
                      null,
                      2
                    )}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit">
                    <Save /> Save draft
                  </Button>
                  {canPublish && (
                    <Button
                      type="submit"
                      variant="outline"
                      formAction={publishDraftAction.bind(
                        null,
                        runbook.draftVersion.id,
                        runbook.id
                      )}
                    >
                      <ShieldCheck /> Publish immutable v{runbook.draftVersion.version}
                    </Button>
                  )}
                </div>
              </form>
            ) : (
              <pre className="overflow-auto rounded-md bg-muted p-4 text-xs">
                {JSON.stringify(runbook.draftVersion.definition, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      ) : sourceVersion && canManage ? (
        <Card>
          <CardContent className="flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-semibold">Published v{sourceVersion.version} is immutable</h2>
              <p className="text-sm text-muted-foreground">
                Clone it to create the next editable draft.
              </p>
            </div>
            <form action={cloneVersionAction.bind(null, sourceVersion.id, runbook.id)}>
              <Button type="submit">
                <Copy /> Create next draft
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5" /> Version history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {runbook.versions.map(version => (
              <div
                key={version.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div>
                  <div className="font-medium">Version {version.version}</div>
                  <div className="text-xs text-muted-foreground">
                    {version._count.executions} executions · {version.checksum.slice(0, 12)}
                  </div>
                </div>
                <Badge variant={version.state === 'PUBLISHED' ? 'default' : 'secondary'}>
                  {version.state}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Service bindings</CardTitle>
            <CardDescription>Reusable configuration attached at service scope.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {runbook.bindings.map(binding => (
              <Link
                key={binding.id}
                href={`/services/${binding.service.id}?tab=runbooks`}
                className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/40"
              >
                <span className="font-medium">{binding.service.name}</span>
                <div className="flex gap-2">
                  <Badge variant="outline">{binding.mode}</Badge>
                  {!binding.enabled && <Badge variant="secondary">Disabled</Badge>}
                </div>
              </Link>
            ))}
            {runbook.bindings.length === 0 && (
              <p className="text-sm text-muted-foreground">Not attached to any service yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
