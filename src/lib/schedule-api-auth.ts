import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';

export async function getScheduleApiScope(
  userId: string
): Promise<Prisma.OnCallScheduleWhereInput> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) return { id: '__unauthorized__' };
  if (hasCapability(user.role, CAPABILITIES.SCHEDULE_READ_ALL)) return {};

  return {
    OR: [
      { layers: { some: { users: { some: { userId } } } } },
      {
        escalationRules: {
          some: {
            policy: {
              services: {
                some: { team: { members: { some: { userId } } } },
              },
            },
          },
        },
      },
    ],
  };
}
