import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MobileCard from '@/components/mobile/MobileCard';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobilePolicyDetailPage({ params }: PageProps) {
  const { id } = await params;

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
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Header */}
      <div className="space-y-2">
        <Link
          href="/m/policies"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Policies
        </Link>

        <div className="space-y-2">
          <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
            {policy.name}
          </h1>
          {policy.description && (
            <div className="text-xs text-[color:var(--text-muted)]">{policy.description}</div>
          )}
        </div>
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
          Escalation Steps
        </h3>

        {sortedSteps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-6 py-8 text-center text-xs text-[color:var(--text-muted)]">
            No escalation steps defined.
          </div>
        ) : (
          sortedSteps.map(([stepOrder, rules]) => (
            <MobileCard key={stepOrder}>
              <div className="mb-3 flex items-center gap-2 border-b border-[color:var(--border)] pb-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                  {stepOrder + 1}
                </div>
                <span className="text-sm font-semibold text-[color:var(--text-primary)]">
                  {rules[0].delayMinutes > 0 ? `Wait ${rules[0].delayMinutes}m` : 'Immediately'}
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {rules.map(rule => (
                  <div key={rule.id} className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--bg-secondary)] text-base">
                      {rule.targetType === 'USER'
                        ? '👤'
                        : rule.targetType === 'SCHEDULE'
                          ? '📅'
                          : '👥'}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                        {rule.targetType === 'USER' && rule.targetUser
                          ? rule.targetUser.name || rule.targetUser.email
                          : rule.targetType === 'SCHEDULE' && rule.targetSchedule
                            ? rule.targetSchedule.name
                            : rule.targetType === 'TEAM' && rule.targetTeam
                              ? rule.targetTeam.name
                              : 'Unknown Target'}
                      </div>
                      <div className="text-[11px] text-[color:var(--text-muted)]">
                        {rule.targetType === 'USER'
                          ? 'User'
                          : rule.targetType === 'SCHEDULE'
                            ? 'Schedule'
                            : 'Team'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </MobileCard>
          ))
        )}
      </div>

      {/* Used By Services */}
      {policy.services.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            Used by Services
          </h3>
          <div className="flex flex-wrap gap-2">
            {policy.services.map(service => (
              <Link
                key={service.id}
                href={`/m/services/${service.id}`}
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-secondary)]"
              >
                {service.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
