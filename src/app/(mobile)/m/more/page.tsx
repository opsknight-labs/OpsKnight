import React from 'react';
import MobileMoreContent from '@/components/mobile/MobileMoreContent';
import { getCurrentUser } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function MobileMorePage() {
  const user = await getCurrentUser();

  return (
    <MobileMoreContent
      userId={user.id}
      name={user.name || 'User'}
      email={user.email}
      role={user.role}
      gender={user.gender}
      avatarUrl={user.avatarUrl}
    />
  );
}
