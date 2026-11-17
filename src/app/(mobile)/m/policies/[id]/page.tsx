import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { CalendarClock, Clock3, Server, ShieldCheck, User, UsersRound } from 'lucide-react';
import {
  MobileDetailHeader,
  MobileIconTile,
  MobileListCard,
  MobileListRow,
  MobileSection,
  MobileToneBadge,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import { assertCanViewPolicy, getUserPermissions } from '@/lib/rbac';
import PolicyDependencies from '@/components/policies/PolicyDependencies';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ depPage?: string }>;
};

export default async function MobilePolicyDetailPage({ params, searchParams }: PageProps) {
  await requirePageAccess('/m/policies/[id]');
  const { id } = await params;
  await assertCanViewPolicy(id);
  const permissions = await getUserPermissions();

  const policy = await prisma.escalationPolicy.findUnique({
    where: { id },
    include: {
      steps: {
        orderBy: { stepOrder: 'asc' },
        include: {
          targetUser: {
            select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
          },
          targetTeam: { select: { id: true, name: true } },
          targetSchedule: { select: { id: true, name: true } },
        },
      },
      services: { select: { id: true, name: true } },
    },
  });

  if (!policy) {
    notFound();
  }

  // Group rules by stepOrder
  const stepsMap = new Map<number, typeof policy.steps>();
  policy.steps.forEach(rule => {
    const rules = stepsMap.get(rule.stepOrder) || [];
    rules.push(rule);
    stepsMap.set(rule.stepOrder, rules);
  });

  const sortedSteps = Array.from(stepsMap.entries()).sort((a, b) => a[0] - b[0]);

  return (
    <div className="responsive-page space-y-4">
      <MobileDetailHeader
        leading={<MobileIconTile icon={ShieldCheck} size="lg" />}
        title={policy.name}
        badges={
          policy.archivedAt ? <MobileToneBadge tone={null}>Archived</MobileToneBadge> : undefined
        }
        description={policy.description || undefined}
        facts={[
          { label: 'Steps', value: sortedSteps.length },
          { label: 'Services', value: policy.services.length },
        ]}
      />

      <PolicyDependencies
        page={Number((await searchParams)?.depPage ?? 1)}
        policyId={id}
        archived={!!policy.archivedAt}
        canManage={permissions.isAdmin}
        mobile
      />

      <MobileSection id="policy-steps" title="Escalation steps" count={sortedSteps.length}>
        {sortedSteps.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck aria-hidden="true" />}
            title="No escalation steps"
            description="Without steps nobody is paged. Add targets to this policy from the desktop workspace."
            size="sm"
            headingLevel="h3"
          />
        ) : (
          <ol className="space-y-3">
            {sortedSteps.map(([stepOrder, rules], index) => (
              <li key={stepOrder} className="space-y-1.5">
                <p className="flex items-center gap-2 px-0.5 text-xs font-medium text-muted-foreground">
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 font-semibold tabular-nums text-foreground">
                    {index + 1}
                  </span>
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  {rules[0].delayMinutes > 0
                    ? `After ${rules[0].delayMinutes} min without acknowledgement`
                    : 'Immediately'}
                </p>
                <MobileListCard label={`Step ${index + 1} targets`}>
                  {rules.map(rule => {
                    const target =
                      rule.targetType === 'USER' && rule.targetUser
                        ? {
                            icon: User,
                            name: rule.targetUser.name || rule.targetUser.email,
                            kind: 'User',
                          }
                        : rule.targetType === 'SCHEDULE' && rule.targetSchedule
                          ? {
                              icon: CalendarClock,
                              name: rule.targetSchedule.name,
                              kind: 'On-call schedule',
                            }
                          : rule.targetType === 'TEAM' && rule.targetTeam
                            ? { icon: UsersRound, name: rule.targetTeam.name, kind: 'Team' }
                            : { icon: User, name: 'Unknown target', kind: rule.targetType };
                    return (
                      <MobileListRow
                        key={rule.id}
                        leading={
                          <MobileIconTile
                            icon={target.icon}
                            tone={rule.targetType === 'SCHEDULE' ? 'shift' : null}
                          />
                        }
                        title={target.name}
                        subtitle={target.kind}
                      />
                    );
                  })}
                </MobileListCard>
              </li>
            ))}
          </ol>
        )}
      </MobileSection>

      {policy.services.length > 0 && (
        <MobileSection id="policy-services" title="Used by services" count={policy.services.length}>
          <MobileListCard>
            {policy.services.map(service => (
              <MobileListRow
                key={service.id}
                href={`/m/services/${service.id}`}
                leading={<MobileIconTile icon={Server} />}
                title={service.name}
              />
            ))}
          </MobileListCard>
        </MobileSection>
      )}
    </div>
  );
}
