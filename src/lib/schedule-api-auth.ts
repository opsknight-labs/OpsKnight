import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export async function getScheduleApiScope(
  userId: string
): Promise<Prisma.OnCallScheduleWhereInput> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) return { id: '__unauthorized__' };
  if (user.role === 'ADMIN' || user.role === 'RESPONDER') return {};

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
