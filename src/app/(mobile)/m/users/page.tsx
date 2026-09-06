import React, { JSX } from 'react';
import prisma from '@/lib/prisma';
import Link from 'next/link';
import { MobileAvatar, MobileEmptyState } from '@/components/mobile/MobileUtils';
import { MobileSearchWithParams } from '@/components/mobile/MobileSearchParams';
import { getDefaultAvatar } from '@/lib/avatar';
import MobileCard from '@/components/mobile/MobileCard';
import { getCurrentUser } from '@/lib/rbac';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function MobileUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  try {
    await getCurrentUser();
  } catch {
    redirect('/m/login');
  }
  const query = params.q || '';

  const users = await prisma.user.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { name: 'asc' },
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
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">Users</h1>
        <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">
          {users.length} member{users.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Search */}
      <MobileSearchWithParams placeholder="Search users by name or email..." />

      {/* User List */}
      <div className="flex flex-col gap-3">
        {users.length === 0 ? (
          <MobileEmptyState
            icon="!"
            title="No users found"
            description="Invite team members to get started"
          />
        ) : (
          users.map(user => (
            <Link key={user.id} href={`/m/users/${user.id}`} className="no-underline">
              <MobileCard className="flex items-center gap-3">
                <MobileAvatar
                  name={user.name || user.email}
                  src={user.avatarUrl || getDefaultAvatar(user.gender, user.id)}
                />

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
                    {user.name || 'Unknown'}
                  </div>
                  <div className="truncate text-xs text-[color:var(--text-secondary)]">
                    {user.email}
                  </div>
                </div>

                <div
                  className={`rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                    user.role === 'ADMIN'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'bg-[color:var(--bg-secondary)] text-[color:var(--text-secondary)]'
                  }`}
                >
                  {user.role.toLowerCase()}
                </div>

                <span className="text-[color:var(--text-muted)]">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </MobileCard>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
