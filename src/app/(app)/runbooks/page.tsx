import { Workflow } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability, getUserPermissions } from '@/lib/rbac';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import RunbookLibrary, { CreateRunbookDialog } from '@/components/runbooks/RunbookLibrary';
import { RunbookNavigation } from '@/components/runbooks/RunbookControls';

export const revalidate = 0;
export default async function RunbooksPage() {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const [permissions, runbooks, executionCount, agents] = await Promise.all([
    getUserPermissions(),
    prisma.runbook.findMany({
      where: { archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        publishedVersion: { select: { version: true } },
        draftVersion: { select: { version: true } },
        _count: { select: { bindings: true, executions: true } },
      },
    }),
    prisma.runbookExecution.count({
      where: { status: { in: ['QUEUED', 'RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] } },
    }),
    prisma.runbookAgent.groupBy({ by: ['status'], _count: { id: true } }),
  ]);
  const canManage = permissions.capabilities.includes(CAPABILITIES.RUNBOOK_MANAGE);
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <DetailHeroBanner
        tag="RUNBOOK AUTOMATION"
        title="Runbooks"
        icon={<Workflow className="h-8 w-8" />}
        subtitle="Build, version and automate operational recovery. Execution stays isolated from critical paging."
        statsPlacement="bottom"
        stats={[
          { label: 'Published', value: runbooks.filter(item => item.publishedVersion).length },
          { label: 'Active executions', value: executionCount },
          {
            label: 'Online Agents',
            value: agents.find(row => row.status === 'ONLINE')?._count.id ?? 0,
          },
          {
            label: 'Needs attention',
            value: agents
              .filter(row => ['OFFLINE', 'DEGRADED'].includes(row.status))
              .reduce((sum, row) => sum + row._count.id, 0),
            href: '/runbooks/health',
          },
        ]}
        actions={canManage ? <CreateRunbookDialog /> : undefined}
      />
      <RunbookNavigation />
      <RunbookLibrary
        canManage={canManage}
        runbooks={runbooks.map(item => ({
          id: item.id,
          name: item.name,
          description: item.description,
          publishedVersion: item.publishedVersion?.version ?? null,
          draftVersion: item.draftVersion?.version ?? null,
          bindings: item._count.bindings,
          executions: item._count.executions,
          updatedAt: item.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
