import prisma from '@/lib/prisma';
import Link from 'next/link';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/shadcn/card';

export const dynamic = 'force-dynamic';

export default async function MobilePoliciesPage() {
  const policies = await prisma.escalationPolicy.findMany({
    orderBy: { name: 'asc' },
    include: {
      steps: { orderBy: { stepOrder: 'asc' } },
      _count: { select: { services: true } },
    },
  });

  return (
    <div className="responsive-page space-y-4">
      <div className="px-0.5 text-[11px] text-muted-foreground">
        {policies.length} {policies.length === 1 ? 'policy' : 'policies'}
      </div>

      {policies.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck aria-hidden="true" />}
          title="No escalation policies"
          description="Policies will appear here when they are available."
          size="sm"
        />
      ) : (
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          {policies.map((policy, index) => (
            <Link
              key={policy.id}
              href={`/m/policies/${policy.id}`}
              className={`flex min-h-[68px] min-w-0 items-center gap-3 px-3.5 py-3 text-card-foreground transition-colors hover:bg-accent/40 ${
                index > 0 ? 'border-t border-border/70' : ''
              }`}
            >
              <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-foreground">{policy.name}</span>
                <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                  {policy.steps.length} {policy.steps.length === 1 ? 'step' : 'steps'} · {policy._count.services} {policy._count.services === 1 ? 'service' : 'services'}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
