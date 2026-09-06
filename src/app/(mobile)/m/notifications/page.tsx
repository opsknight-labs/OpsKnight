import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import MobileNotificationsClient from '@/components/mobile/MobileNotificationsClient';

export default async function MobileNotificationsPage() {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user) {
        redirect('/m/login');
    }

    return <MobileNotificationsClient />;
}
