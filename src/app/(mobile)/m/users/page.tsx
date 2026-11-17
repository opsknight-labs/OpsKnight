import prisma from '@/lib/prisma';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Users } from 'lucide-react';
import { appRoutes } from '@/lib/app-routes';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { MobileSearchWithParams } from '@/components/mobile/MobileSearchParams';
import {
  MobileListCard,
  MobileListMeta,
  MobileListRow,
  MobileToneBadge,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui/shadcn/button';
import { getDefaultAvatar } from '@/lib/avatar';
import { getRequestActorContext } from '@/lib/request-actor-context';
import { assertCanListUsers } from '@/lib/rbac';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

export default async function MobileUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePageAccess('/m/users');
  const context = await getRequestActorContext();
  if (!context) redirect(appRoutes.login('mobile', '/m/users'));
  await assertCanListUsers();

  const params = await searchParams;
  const query = params.q?.trim() || '';
  const users = await prisma.user.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      avatarUrl: true,
      gender: true,
    },
  });

  return (
    <div className="responsive-page space-y-4">
      <MobileListMeta>
        {users.length} {users.length === 1 ? 'member' : 'members'}
      </MobileListMeta>

      <MobileSearchWithParams placeholder="Search users" />

      {users.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden="true" />}
          title={query ? 'No matching users' : 'No users yet'}
          description={
            query
              ? `Nobody matches “${query}”. Search by name or email.`
              : 'Invite responders from the desktop workspace; they appear here once they join.'
          }
          size="sm"
          action={
            query ? (
              <Button asChild variant="outline" size="lg" className="h-11 rounded-xl">
                <Link href="/m/users">Clear search</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <MobileListCard label="Users">
          {users.map(user => (
            <MobileListRow
              key={user.id}
              href={`/m/users/${user.id}`}
              leading={
                <MobileAvatar
                  name={user.name || user.email}
                  src={user.avatarUrl || getDefaultAvatar(user.gender, user.id)}
                  size="md"
                />
              }
              title={user.name || 'Unknown'}
              subtitle={user.email}
              trailing={
                <MobileToneBadge tone={null}>
                  {user.role.charAt(0) + user.role.slice(1).toLowerCase()}
                </MobileToneBadge>
              }
            />
          ))}
        </MobileListCard>
      )}
    </div>
  );
}
