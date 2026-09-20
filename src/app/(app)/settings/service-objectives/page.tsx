import { redirect } from 'next/navigation';
import { Target } from 'lucide-react';
import prisma from '@/lib/prisma';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { Card } from '@/components/ui/shadcn/card';

export const revalidate = 0;

const comparatorLabel = {
  GREATER_THAN_OR_EQUAL: '≥',
  LESS_THAN_OR_EQUAL: '≤',
} as const;

const windowLabel = {
  SEVEN_DAYS: '7 days',
  THIRTY_DAYS: '30 days',
  NINETY_DAYS: '90 days',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
  ROLLING_DAYS: 'Rolling',
} as const;

export default async function ServiceObjectivesPage() {
  // Service objectives UI is deferred to a future release
  redirect('/settings');
  const objectives = await prisma.serviceObjective.findMany({
    where: { activeTo: null },
    include: { service: { select: { name: true } } },
    orderBy: [{ service: { name: 'asc' } }, { metricType: 'asc' }],
  });

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        tag="Reliability"
        title="Service Objectives"
        subtitle="Measure service reliability independently from incident ACK and resolution SLAs. Incident response targets remain under Incident Response Policy."
        icon={
          <div className="rounded-2xl border border-primary-foreground/25 bg-primary-foreground/15 p-3.5 text-primary-foreground shadow-inner">
            <Target className="h-8 w-8" />
          </div>
        }
        badges={
          <Badge
            variant="outline"
            className="border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground"
          >
            {objectives.length} active
          </Badge>
        }
      />

      {objectives.length === 0 ? (
        <Card className="border-dashed p-10 text-center">
          <Target className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h2 className="font-semibold">No service objectives yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create objectives through the v1 service-objectives API. Incident response SLA policy is
            configured separately.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {objectives.map(objective => (
            <Card key={objective.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {objective.service?.name ?? 'Workspace'}
                  </p>
                  <h2 className="mt-1 font-semibold">{objective.name}</h2>
                </div>
                <Badge variant="secondary">{objective.metricType.replaceAll('_', ' ')}</Badge>
              </div>
              <p className="mt-5 text-2xl font-semibold">
                {comparatorLabel[objective.comparator]} {objective.target}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {objective.windowType === 'ROLLING_DAYS'
                  ? `${objective.windowValue ?? 30} rolling days`
                  : windowLabel[objective.windowType]}
                {' · '}version {objective.version}
              </p>
              {objective.description ? (
                <p className="mt-4 text-sm text-muted-foreground">{objective.description}</p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
