import Link from 'next/link';
import { BookOpenCheck, Bot, Clock3, Plus, Workflow } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getUserPermissions } from '@/lib/rbac';
import { createRunbookAction } from './actions';
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

export default async function RunbooksPage() {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const [permissions, runbooks, executionCount, agentCount] = await Promise.all([
    getUserPermissions(),
    prisma.runbook.findMany({
      where: { archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        publishedVersion: { select: { id: true, version: true, publishedAt: true } },
        draftVersion: { select: { id: true, version: true, updatedAt: true } },
        _count: { select: { bindings: true, executions: true } },
      },
    }),
    prisma.runbookExecution.count({
      where: { status: { notIn: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] } },
    }),
    prisma.runbookAgent.count({ where: { status: { in: ['ONLINE', 'DEGRADED'] } } }),
  ]);
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE);

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-rose-600">
            <Workflow className="h-4 w-4" /> Automation control plane
          </div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Runbooks</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Versioned, auditable operational workflows. Published versions are immutable and
            execution remains isolated from critical paging.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/runbooks/agents">
              <Bot /> Agents
            </Link>
          </Button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Runbook overview">
        <Metric
          label="Published runbooks"
          value={runbooks.filter(item => item.publishedVersion).length}
          icon={<BookOpenCheck />}
        />
        <Metric label="Active executions" value={executionCount} icon={<Clock3 />} />
        <Metric label="Available agents" value={agentCount} icon={<Bot />} />
      </section>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plus className="h-5 w-5" /> Create runbook
            </CardTitle>
            <CardDescription>
              Start with a safe manual step, then edit and publish the draft.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={createRunbookAction}
              className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end"
            >
              <div className="space-y-2">
                <Label htmlFor="runbook-name">Name</Label>
                <Input
                  id="runbook-name"
                  name="name"
                  required
                  maxLength={200}
                  placeholder="Linux service recovery"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="runbook-slug">Slug</Label>
                <Input
                  id="runbook-slug"
                  name="slug"
                  required
                  maxLength={120}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="linux-service-recovery"
                />
              </div>
              <Button type="submit">Create draft</Button>
              <div className="space-y-2 lg:col-span-3">
                <Label htmlFor="runbook-description">Description</Label>
                <Textarea
                  id="runbook-description"
                  name="description"
                  maxLength={5000}
                  placeholder="When and how responders should use this runbook."
                />
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {runbooks.map(runbook => (
          <Link
            key={runbook.id}
            href={`/runbooks/${runbook.id}`}
            className="group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <Card className="h-full transition-colors group-hover:border-rose-300">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-lg">{runbook.name}</CardTitle>
                  <Badge variant={runbook.publishedVersion ? 'default' : 'secondary'}>
                    {runbook.publishedVersion ? `v${runbook.publishedVersion.version}` : 'Draft'}
                  </Badge>
                </div>
                <CardDescription className="line-clamp-2 min-h-10">
                  {runbook.description || 'No description yet.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{runbook._count.bindings} service bindings</span>
                <span>{runbook._count.executions} executions</span>
                {runbook.draftVersion && <span>v{runbook.draftVersion.version} draft</span>}
              </CardContent>
            </Card>
          </Link>
        ))}
        {runbooks.length === 0 && (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No runbooks yet. Create the first reusable operational workflow above.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-700 [&_svg]:h-4 [&_svg]:w-4 dark:bg-rose-950/40 dark:text-rose-300">
          {icon}
        </span>
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
