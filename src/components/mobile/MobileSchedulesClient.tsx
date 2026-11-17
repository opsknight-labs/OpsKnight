'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import MobileCachedDataNotice from '@/components/mobile/MobileCachedDataNotice';
import {
  MobileIconTile,
  MobileListCard,
  MobileListMeta,
  MobileListRow,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { readMobileCacheStatus } from '@/lib/mobile-cache-status';
import { haptics } from '@/lib/haptics';
import { appRoutes } from '@/lib/app-routes';

type ScheduleUser = { user: { id: string; name: string | null; email: string | null } };
type ScheduleLayer = { users: ScheduleUser[] };
type Schedule = { id: string; name: string; layers: ScheduleLayer[] };

const CACHE_KEY = 'mobile-schedules';

export default function MobileSchedulesClient({
  initialSchedules,
}: {
  initialSchedules: Schedule[];
}) {
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    const handleOnlineStatus = async () => {
      if (!navigator.onLine) {
        const cached = await readCache<Schedule[]>(CACHE_KEY);
        const status = readMobileCacheStatus(CACHE_KEY);
        if (cancelled) return;
        if (cached && Array.isArray(cached)) {
          setSchedules(cached);
          setCachedAt(status?.savedAt ?? null);
        }
      } else {
        setSchedules(initialSchedules);
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
  }, [initialSchedules]);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.onLine)
      void writeCache(CACHE_KEY, initialSchedules);
  }, [initialSchedules]);

  const totalLayers = schedules.reduce((sum, schedule) => sum + schedule.layers.length, 0);

  return (
    <div className="responsive-page space-y-4">
      <MobileCachedDataNotice savedAt={cachedAt} />
      <MobileListMeta
        trailing={`${totalLayers} rotation ${totalLayers === 1 ? 'layer' : 'layers'}`}
      >
        {schedules.length} {schedules.length === 1 ? 'schedule' : 'schedules'}
      </MobileListMeta>

      {schedules.length === 0 ? (
        <EmptyState
          icon={<CalendarClock aria-hidden="true" />}
          title="No on-call schedules"
          description="Schedules decide who gets paged and when. Build rotations in the desktop workspace; they show up here for quick hand-off checks."
          size="sm"
        />
      ) : (
        <MobileListCard label="On-call schedules">
          {schedules.map(schedule => {
            const totalParticipants = schedule.layers.reduce(
              (count, layer) => count + layer.users.length,
              0
            );
            const firstResponder = schedule.layers[0]?.users[0]?.user;
            return (
              <MobileListRow
                key={schedule.id}
                href={appRoutes.schedule('mobile', schedule.id)}
                onClick={() => haptics.soft()}
                leading={<MobileIconTile icon={CalendarClock} tone="shift" />}
                title={schedule.name}
                subtitle={
                  <>
                    {firstResponder?.name || firstResponder?.email || 'No responder assigned'}
                    {totalParticipants > 1 ? ` · ${totalParticipants} responders` : ''}
                  </>
                }
                trailing={
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {schedule.layers.length} {schedule.layers.length === 1 ? 'layer' : 'layers'}
                  </span>
                }
              />
            );
          })}
        </MobileListCard>
      )}
    </div>
  );
}
