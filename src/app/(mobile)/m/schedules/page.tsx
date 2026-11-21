import { Suspense } from 'react';
import prisma from '@/lib/prisma';
import MobileSchedulesClient from '@/components/mobile/MobileSchedulesClient';
import MyOnCallLoadCard from '@/components/schedules/MyOnCallLoadCard';
import { enabledOpsInsightAreas } from '@/lib/intelligence/ops-insights/contract';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { getCurrentAuthorizationActor, getViewableScheduleWhere } from '@/lib/rbac';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

export default async function MobileSchedulesPage() {
  await requirePageAccess('/m/schedules');
  const [scheduleWhere, actor, onCallInsightsOn] = await Promise.all([
    getViewableScheduleWhere(),
    getCurrentAuthorizationActor(),
    getIntelligenceSettings()
      .then(settings => enabledOpsInsightAreas(settings).includes('onCall'))
      .catch(() => false),
  ]);
  const schedules = await prisma.onCallSchedule.findMany({
    where: scheduleWhere,
    orderBy: { name: 'asc' },
    include: {
      layers: {
        include: {
          users: {
            include: {
              user: {
                select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
              },
            },
          },
        },
      },
    },
  });

  return (
    <MobileSchedulesClient
      initialSchedules={schedules}
      myLoad={
        onCallInsightsOn ? (
          <Suspense fallback={null}>
            <MyOnCallLoadCard userId={actor.id} />
          </Suspense>
        ) : null
      }
    />
  );
}
