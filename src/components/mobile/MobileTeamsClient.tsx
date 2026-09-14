'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, UsersRound } from 'lucide-react';
import { MobileSearchWithParams } from '@/components/mobile/MobileSearchParams';
import MobileCachedDataNotice from '@/components/mobile/MobileCachedDataNotice';
import EmptyState from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/shadcn/card';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { readMobileCacheStatus } from '@/lib/mobile-cache-status';
import { haptics } from '@/lib/haptics';
import { appRoutes } from '@/lib/app-routes';

type TeamItem = {
  id: string;
  name: string;
  description: string | null;
  _count: { members: number; incidents: number };
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
  const [cachedAt, setCachedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const handleOnlineStatus = async () => {
      if (!navigator.onLine) {
        const cached = await readCache<TeamItem[]>(cacheKey);
        const status = readMobileCacheStatus(cacheKey);
        if (cancelled) return;
        if (cached && Array.isArray(cached)) {
          setTeams(cached);
          setCachedAt(status?.savedAt ?? null);
        }
      } else {
        setTeams(initialTeams);
        setCachedAt(null);
      }
    };

    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);
    void handleOnlineStatus();
    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, [cacheKey, initialTeams]);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.onLine) void writeCache(cacheKey, initialTeams);
  }, [cacheKey, initialTeams]);

  return (
    <div className="responsive-page space-y-4">
      <MobileCachedDataNotice savedAt={cachedAt} />
      <div className="px-0.5 text-[11px] text-muted-foreground">
        {teams.length} {teams.length === 1 ? 'team' : 'teams'}
      </div>
      <MobileSearchWithParams placeholder="Search teams" />

      {teams.length === 0 ? (
        <EmptyState
          icon={<UsersRound aria-hidden="true" />}
          title={query ? 'No matching teams' : 'No teams available'}
          description={query ? `Nothing matches “${query}”.` : 'Teams you can access will appear here.'}
          size="sm"
        />
      ) : (
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          {teams.map((team, index) => (
            <Link
              key={team.id}
              href={appRoutes.team('mobile', team.id)}
              onClick={() => haptics.soft()}
              className={`flex min-h-[68px] min-w-0 items-center gap-3 px-3.5 py-3 text-card-foreground transition-colors hover:bg-accent/40 ${index > 0 ? 'border-t border-border/70' : ''}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold text-muted-foreground">
                {team.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-foreground">{team.name}</span>
                <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                  {team._count.members} {team._count.members === 1 ? 'member' : 'members'}
                  {team._count.incidents > 0
                    ? ` · ${team._count.incidents} active incident${team._count.incidents === 1 ? '' : 's'}`
                    : ' · no active incidents'}
                </span>
              </span>
              {team._count.incidents > 0 ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-label="Active incidents" />
              ) : null}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
