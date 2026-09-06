'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { haptics } from '@/lib/haptics';

type ScheduleUser = {
  user: { id: string; name: string | null; email: string | null };
};

type ScheduleLayer = {
  users: ScheduleUser[];
};

type Schedule = {
  id: string;
  name: string;
  layers: ScheduleLayer[];
};

export default function MobileSchedulesClient({
  initialSchedules,
}: {
  initialSchedules: Schedule[];
}) {
  const [schedules, setSchedules] = useState<Schedule[]>(initialSchedules);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnlineStatus = async () => {
      if (!navigator.onLine) {
        const cached = await readCache<Schedule[]>('mobile-schedules');
        if (cached && Array.isArray(cached) && cached.length > 0) {
          setSchedules(cached);
        }
      } else {
        setSchedules(initialSchedules);
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
  }, [initialSchedules]);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.onLine) {
      writeCache('mobile-schedules', schedules);
    }
  }, [schedules]);

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
          On-Call Schedules
        </h1>
        <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">
          {schedules.length} schedule{schedules.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Schedule List */}
      <div className="flex flex-col gap-3">
        {schedules.length === 0 ? (
          <EmptyState />
        ) : (
          schedules.map(schedule => {
            const totalParticipants = schedule.layers.reduce(
              (acc, layer) => acc + layer.users.length,
              0
            );

            return (
              <Link
                key={schedule.id}
                href={`/m/schedules/${schedule.id}`}
                onClick={() => haptics.soft()}
                className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4 text-[color:var(--text-primary)] shadow-sm transition hover:bg-[color:var(--bg-secondary)]"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="truncate text-sm font-semibold">{schedule.name}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--text-muted)]">
                    <span>
                      {'\u{1F4C5}'} {schedule.layers.length} layer
                      {schedule.layers.length !== 1 ? 's' : ''}
                    </span>
                    <span>{'\u2022'}</span>
                    <span>
                      {'\u{1F465}'} {totalParticipants} participant
                      {totalParticipants !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[color:var(--text-muted)]" />
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-6 py-10 text-center">
      <div className="text-3xl">{'\u{1F4C5}'}</div>
      <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">No schedules</h3>
      <p className="text-xs text-[color:var(--text-muted)]">
        Use desktop to create on-call schedules
      </p>
    </div>
  );
}
