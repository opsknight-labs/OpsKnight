import prisma from '@/lib/prisma';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, Users } from 'lucide-react';
import { appRoutes } from '@/lib/app-routes';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { MobileSearchWithParams } from '@/components/mobile/MobileSearchParams';
import EmptyState from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/shadcn/card';
import { getDefaultAvatar } from '@/lib/avatar';
import { getRequestActorContext } from '@/lib/request-actor-context';

export const dynamic = 'force-dynamic';

export default async function MobileUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const context = await getRequestActorContext();
  if (!context) redirect(appRoutes.login('mobile', '/m/users'));

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
      <div className="flex items-center justify-between gap-3 px-0.5 text-[11px] text-muted-foreground">
        <span>{users.length} {users.length === 1 ? 'member' : 'members'}</span>
      </div>

      <MobileSearchWithParams placeholder="Search users" />

      {users.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden="true" />}
          title={query ? 'No matching users' : 'No users available'}
          description={query ? `Nothing matches “${query}”.` : 'Users will appear here when they are available.'}
          size="sm"
        />
      ) : (
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          {users.map((user, index) => (
            <Link
              key={user.id}
              href={`/m/users/${user.id}`}
              className={`flex min-h-[64px] min-w-0 items-center gap-3 px-3.5 py-2.5 text-card-foreground transition-colors hover:bg-accent/40 ${
                index > 0 ? 'border-t border-border/70' : ''
              }`}
            >
              <MobileAvatar
                name={user.name || user.email}
                src={user.avatarUrl || getDefaultAvatar(user.gender, user.id)}
                size="sm"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-foreground">
                  {user.name || 'Unknown'}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{user.email}</span>
              </span>
              <span
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                  user.role === 'ADMIN'
                    ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                    : 'border-border bg-muted text-muted-foreground'
                }`}
              >
                {user.role.toLowerCase()}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
