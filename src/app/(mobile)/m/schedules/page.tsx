import prisma from '@/lib/prisma';
import MobileSchedulesClient from '@/components/mobile/MobileSchedulesClient';

export const dynamic = 'force-dynamic';

export default async function MobileSchedulesPage() {
  const schedules = await prisma.onCallSchedule.findMany({
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
