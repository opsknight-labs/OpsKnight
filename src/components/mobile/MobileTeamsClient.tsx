'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, UsersRound } from 'lucide-react';
import { MobileSearchWithParams } from '@/components/mobile/MobileSearchParams';
import MobileCachedDataNotice from '@/components/mobile/MobileCachedDataNotice';
import {
  MobileIconTile,
  MobileListCard,
  MobileListMeta,
  MobileListRow,
  MobileToneBadge,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui/shadcn/button';
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
      <MobileListMeta>
        {teams.length} {teams.length === 1 ? 'team' : 'teams'}
      </MobileListMeta>
      <MobileSearchWithParams placeholder="Search teams" />

      {teams.length === 0 ? (
        <EmptyState
          icon={<UsersRound aria-hidden="true" />}
          title={query ? 'No matching teams' : 'No teams yet'}
          description={
            query
              ? `Nothing matches “${query}”. Check the spelling or clear the search.`
              : 'Teams own services and receive escalations. Create them from the desktop workspace.'
          }
          size="sm"
          action={
            query ? (
              <Button asChild variant="outline" size="lg" className="h-11 rounded-xl">
                <Link href="/m/teams">Clear search</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <MobileListCard label="Teams">
          {teams.map(team => (
            <MobileListRow
              key={team.id}
              href={appRoutes.team('mobile', team.id)}
              onClick={() => haptics.soft()}
              leading={<MobileIconTile icon={UsersRound} />}
              title={team.name}
              subtitle={`${team._count.members} ${team._count.members === 1 ? 'member' : 'members'}`}
              trailing={
                team._count.incidents > 0 ? (
                  <MobileToneBadge tone="critical" icon={AlertTriangle}>
                    {team._count.incidents} active
                  </MobileToneBadge>
                ) : null
              }
            />
          ))}
        </MobileListCard>
      )}
    </div>
  );
}
