import React from 'react';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import MobileMoreContent from '@/components/mobile/MobileMoreContent';

export const dynamic = 'force-dynamic';

export default async function MobileMorePage() {
  const session = await getServerSession(await getAuthOptions());

  const user = session?.user?.email
    ? await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true, name: true, email: true, role: true, gender: true, avatarUrl: true },
      })
    : null;

  return (
    <MobileMoreContent
      userId={user?.id || ''}
      name={user?.name || 'User'}
      email={user?.email || ''}
      role={user?.role || 'User'}
      gender={user?.gender}
      avatarUrl={user?.avatarUrl}
    />
  );
}
