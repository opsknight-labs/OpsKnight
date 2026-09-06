import prisma from '@/lib/prisma';
import Link from 'next/link';
import { MobileEmptyState } from '@/components/mobile/MobileUtils';
import MobileCard from '@/components/mobile/MobileCard';
import { ChevronRight } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function MobilePoliciesPage() {
  const policies = await prisma.escalationPolicy.findMany({
    orderBy: { name: 'asc' },
    include: {
      steps: {
        orderBy: { stepOrder: 'asc' },
      },
      _count: {
        select: { services: true },
      },
    },
  });

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
          Escalation Policies
        </h1>
        <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">
          {policies.length} policies
        </p>
      </div>

      {/* Policy List */}
      <div className="flex flex-col gap-3">
        {policies.length === 0 ? (
          <MobileEmptyState
            icon="!"
            title="No policies"
            description="Use desktop to create escalation policies"
          />
        ) : (
          policies.map(policy => (
            <Link key={policy.id} href={`/m/policies/${policy.id}`} className="no-underline">
              <MobileCard padding="md" className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                    {policy.name}
                  </div>
                  {policy.description && (
                    <div className="mt-1 text-xs text-[color:var(--text-secondary)]">
                      {policy.description}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-[color:var(--text-muted)]">
                    <span>Steps: {policy.steps.length}</span>
                    <span>•</span>
                    <span>Services: {policy._count.services}</span>
                  </div>
                </div>

                <ChevronRight className="mt-1 h-4 w-4 text-[color:var(--text-muted)]" />
              </MobileCard>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
