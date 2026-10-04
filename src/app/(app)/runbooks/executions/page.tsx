import Link from 'next/link';
import { Play } from 'lucide-react';
import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import EmptyState from '@/components/ui/EmptyState';
import { RunbookNavigation, StatusBadge } from '@/components/runbooks/RunbookControls';

export const revalidate = 0;
export default async function RunbookExecutionsPage() {
  await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
  const executions = await prisma.runbookExecution.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      status: true,
      createdAt: true,
      incidentId: true,
      runbook: { select: { id: true, name: true } },
      runbookVersion: { select: { version: true } },
    },
  });
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 md:p-6">
      <DetailHeroBanner
        tag="RUNBOOK AUTOMATION"
        title="Executions"
        subtitle="Recent execution history. Open an incident to inspect its exact plan, approvals and output."
        icon={<Play className="h-8 w-8" />}
      />
      <RunbookNavigation />
      <section className="space-y-3" aria-label="Recent executions">
        {executions.map(item => (
          <Link
            key={item.id}
            href={
              item.incidentId
                ? `/incidents/${item.incidentId}?tab=runbooks`
                : `/runbooks/${item.runbook.id}?tab=executions`
            }
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:border-primary/30"
          >
            <div>
              <h2 className="font-semibold">{item.runbook.name}</h2>
              <p className="text-xs text-muted-foreground">
                v{item.runbookVersion.version} · {item.createdAt.toLocaleString()}
              </p>
            </div>
            <StatusBadge status={item.status} />
          </Link>
        ))}
        {executions.length === 0 && (
          <EmptyState
            icon={<Play />}
            title="No executions yet"
            description="Attach a published workflow to a service, then start it from an incident."
          />
        )}
      </section>
    </div>
  );
}
