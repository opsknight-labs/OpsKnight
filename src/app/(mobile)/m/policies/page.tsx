import prisma from '@/lib/prisma';
import { ShieldCheck } from 'lucide-react';
import {
  MobileIconTile,
  MobileListCard,
  MobileListMeta,
  MobileListRow,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import { assertCanListPolicies } from '@/lib/rbac';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

export default async function MobilePoliciesPage() {
  await requirePageAccess('/m/policies');
  await assertCanListPolicies();
  const policies = await prisma.escalationPolicy.findMany({
    orderBy: { name: 'asc' },
    include: {
      steps: { orderBy: { stepOrder: 'asc' } },
      _count: { select: { services: true } },
    },
  });

  return (
    <div className="responsive-page space-y-4">
      <MobileListMeta>
        {policies.length} {policies.length === 1 ? 'policy' : 'policies'}
      </MobileListMeta>

      {policies.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck aria-hidden="true" />}
          title="No escalation policies"
          description="Policies decide who is paged next when nobody acknowledges. Create them from the desktop workspace."
          size="sm"
        />
      ) : (
        <MobileListCard label="Escalation policies">
          {policies.map(policy => (
            <MobileListRow
              key={policy.id}
              href={`/m/policies/${policy.id}`}
              leading={<MobileIconTile icon={ShieldCheck} />}
              title={policy.name}
              subtitle={`${policy.steps.length} ${policy.steps.length === 1 ? 'step' : 'steps'} · ${policy._count.services} ${policy._count.services === 1 ? 'service' : 'services'}`}
            />
          ))}
        </MobileListCard>
      )}
    </div>
  );
}
