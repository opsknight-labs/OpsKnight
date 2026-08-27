'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { MobileSearchWithParams } from '@/components/mobile/MobileSearchParams';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { haptics } from '@/lib/haptics';

type TeamItem = {
  id: string;
  name: string;
  description: string | null;
  _count: {
    members: number;
    incidents: number;
  };
};

export default function MobileTeamsClient({
  initialTeams,
  query,
}: {
  initialTeams: TeamItem[];
  query: string;
}) {
  const cacheKey = `mobile-teams:${query || 'all'}`;

  const [teams, setTeams] = useState<TeamItem[]>(initialTeams);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnlineStatus = async () => {
      if (!navigator.onLine) {
        const cached = await readCache<TeamItem[]>(cacheKey);
        if (cached && Array.isArray(cached) && cached.length > 0) {
          setTeams(cached);
        }
      } else {
        setTeams(initialTeams);
      }
    };

    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);

    // Initial check
    void handleOnlineStatus();

    return () => {
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, [cacheKey, initialTeams]);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.onLine) {
      writeCache(cacheKey, initialTeams);
    }
  }, [cacheKey, initialTeams]);

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">Teams</h1>
        <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">
          {teams.length} team{teams.length !== 1 ? 's' : ''}
        </p>
      </div>

      <MobileSearchWithParams placeholder="Search teams..." />

      <div className="flex flex-col gap-3">
        {teams.length === 0 ? (
          <EmptyState />
        ) : (
          teams.map(team => (
            <Link
              key={team.id}
              href={`/m/teams/${team.id}`}
              onClick={() => haptics.soft()}
              className="flex items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4 text-[color:var(--text-primary)] shadow-sm transition hover:bg-[color:var(--bg-secondary)]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-base font-bold text-white dark:from-slate-200 dark:to-slate-50 dark:text-slate-900">
                {team.name.charAt(0).toUpperCase()}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="truncate text-sm font-semibold">{team.name}</div>
                {team.description && (
                  <div className="line-clamp-2 text-xs text-[color:var(--text-secondary)]">
                    {team.description}
                  </div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium text-[color:var(--text-muted)]">
                  <span>
                    {'\u{1F465}'} {team._count.members} member
                    {team._count.members !== 1 ? 's' : ''}
                  </span>
                  {team._count.incidents > 0 && (
                    <span className="text-red-600 dark:text-red-400">
                      {'\u{1F525}'} {team._count.incidents} active incident
                      {team._count.incidents !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>

              <ChevronRight className="h-4 w-4 text-[color:var(--text-muted)]" />
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-6 py-10 text-center">
      <div className="text-3xl">{'\u{1F465}'}</div>
      <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">No teams</h3>
      <p className="text-xs text-[color:var(--text-muted)]">Use desktop to create teams</p>
    </div>
  );
}
