import prisma from '@/lib/prisma';
import MobileSchedulesClient from '@/components/mobile/MobileSchedulesClient';
import { getViewableScheduleWhere } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function MobileSchedulesPage() {
  const scheduleWhere = await getViewableScheduleWhere();
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

  return <MobileSchedulesClient initialSchedules={schedules} />;
}
