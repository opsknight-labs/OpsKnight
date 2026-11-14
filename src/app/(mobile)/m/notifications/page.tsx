import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import MobileNotificationsClient from '@/components/mobile/MobileNotificationsClient';
import { requirePageAccess } from '@/lib/access/server';

export default async function MobileNotificationsPage() {
  await requirePageAccess('/m/notifications');
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user) {
    redirect('/m/login');
  }

  return <MobileNotificationsClient />;
}
