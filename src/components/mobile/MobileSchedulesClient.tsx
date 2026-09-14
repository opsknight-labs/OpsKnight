'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, ChevronRight, UsersRound } from 'lucide-react';
import MobileCachedDataNotice from '@/components/mobile/MobileCachedDataNotice';
import EmptyState from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/shadcn/card';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { readMobileCacheStatus } from '@/lib/mobile-cache-status';
import { haptics } from '@/lib/haptics';
import { appRoutes } from '@/lib/app-routes';

type ScheduleUser = { user: { id: string; name: string | null; email: string | null } };
type ScheduleLayer = { users: ScheduleUser[] };
type Schedule = { id: string; name: string; layers: ScheduleLayer[] };

const CACHE_KEY = 'mobile-schedules';

export default function MobileSchedulesClient({ initialSchedules }: { initialSchedules: Schedule[] }) {
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
    if (typeof window !== 'undefined' && navigator.onLine) void writeCache(CACHE_KEY, initialSchedules);
  }, [initialSchedules]);

  const totalLayers = schedules.reduce((sum, schedule) => sum + schedule.layers.length, 0);

  return (
    <div className="responsive-page space-y-4">
      <MobileCachedDataNotice savedAt={cachedAt} />
      <section className="flex items-center justify-between gap-3 px-0.5 text-[11px] text-muted-foreground">
        <span>{schedules.length} {schedules.length === 1 ? 'schedule' : 'schedules'}</span>
        <span>{totalLayers} escalation {totalLayers === 1 ? 'layer' : 'layers'}</span>
      </section>

      {schedules.length === 0 ? (
        <EmptyState
          icon={<CalendarClock aria-hidden="true" />}
          title="No on-call schedules"
          description="Schedules you can access will appear here."
          size="sm"
        />
      ) : (
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          {schedules.map((schedule, index) => {
            const totalParticipants = schedule.layers.reduce((count, layer) => count + layer.users.length, 0);
            const firstResponder = schedule.layers[0]?.users[0]?.user;
            return (
              <Link
                key={schedule.id}
                href={appRoutes.schedule('mobile', schedule.id)}
                onClick={() => haptics.soft()}
                className={`flex min-h-[72px] min-w-0 items-center gap-3 px-3.5 py-3 text-card-foreground transition-colors hover:bg-accent/40 ${index > 0 ? 'border-t border-border/70' : ''}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-950/35 dark:text-violet-300">
                  <CalendarClock className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-foreground">{schedule.name}</span>
                  <span className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                    <UsersRound className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {firstResponder?.name || firstResponder?.email || 'No responder assigned'}
                      {totalParticipants > 1 ? ` · ${totalParticipants} responders` : ''}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[10px] font-semibold text-muted-foreground">
                    {schedule.layers.length} {schedule.layers.length === 1 ? 'layer' : 'layers'}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
