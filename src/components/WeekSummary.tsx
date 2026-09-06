'use client';

import { useMemo } from 'react';
import { formatDateTime, startOfDayInTimeZone } from '@/lib/timezone';

type Shift = {
  id: string;
  start: string;
  end: string;
  label: string;
  layerName: string;
  userName: string;
};

type ShiftWithDates = Shift & {
  startDate: Date;
  endDate: Date;
};

type WeekSummaryProps = {
  shifts: Shift[];
  timeZone: string;
};

export default function WeekSummary({ shifts, timeZone }: WeekSummaryProps) {
  const weekShifts = useMemo<ShiftWithDates[]>(() => {
    const now = new Date();
    // Use timezone-aware day-of-week calculation
    const { day: tzDayOfWeek } = (() => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
      }).formatToParts(now);
      const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
      const dayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      return { day: dayMap[weekday] ?? 0 };
    })();
    const weekStartMs = now.getTime() - tzDayOfWeek * 86400000;
    const weekStart = startOfDayInTimeZone(new Date(weekStartMs), timeZone);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    return shifts
      .map(shift => ({
        ...shift,
        startDate: new Date(shift.start),
        endDate: new Date(shift.end),
      }))
      .filter(shift => {
        return shift.startDate < weekEnd && shift.endDate > weekStart;
      })
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [shifts, timeZone]);

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, ShiftWithDates[]>();

    weekShifts.forEach(shift => {
      // Use formatDateTime for consistent timezone formatting
      const dayKey =
        formatDateTime(shift.startDate, timeZone, {
          format: 'date',
          hour12: false,
        }).split(',')[0] || formatDateTime(shift.startDate, timeZone, { format: 'date' });

      if (!groups.has(dayKey)) {
        groups.set(dayKey, []);
      }
      groups.get(dayKey)!.push(shift);
    });

    return Array.from(groups.entries()).map(([day, dayShifts]) => ({
      day,
      shifts: dayShifts,
    }));
  }, [weekShifts, timeZone]);

  const formatTime = (date: Date) => {
    return formatDateTime(date, timeZone, { format: 'time', hour12: true });
  };

  return (
    <div
      className="glass-panel"
      style={{
        padding: '1.5rem',
        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        marginBottom: '2rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div>
          <h3
            style={{
              fontSize: '1.25rem',
              fontWeight: '700',
              color: 'var(--text-primary)',
              margin: 0,
              marginBottom: '0.25rem',
            }}
          >
            This Week's Schedule
          </h3>
          <p
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              margin: 0,
            }}
          >
            Upcoming on-call assignments for the next 7 days
          </p>
        </div>
        <span
          style={{
            padding: '0.3rem 0.6rem',
            borderRadius: '8px',
            fontSize: '0.75rem',
            fontWeight: '600',
            background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
            color: '#0c4a6e',
            border: '1px solid #bae6fd',
          }}
        >
          {weekShifts.length} shifts
        </span>
      </div>

      {groupedByDay.length === 0 ? (
        <div
          style={{
            padding: '2rem 1rem',
            textAlign: 'center',
            background: '#f8fafc',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📅</div>
          <p
            style={{
              fontSize: '0.9rem',
              color: 'var(--text-muted)',
              margin: 0,
            }}
          >
            No shifts scheduled for this week.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {groupedByDay.map(({ day, shifts: dayShifts }) => (
            <div
              key={day}
              style={{
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
              }}
            >
              <h4
                style={{
                  fontSize: '0.95rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  margin: 0,
                  marginBottom: '0.75rem',
                }}
              >
                {day}
              </h4>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {dayShifts.map(shift => {
                  const layerName = shift.label.split(':')[0];
                  const userName = shift.label.split(':')[1]?.trim() || shift.userName;
                  return (
                    <div
                      key={shift.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.75rem',
                        background: 'white',
                        borderRadius: '6px',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            marginBottom: '0.25rem',
                          }}
                        >
                          <span
                            style={{
                              padding: '0.15rem 0.5rem',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: '600',
                              background: '#e0f2fe',
                              color: '#0c4a6e',
                            }}
                          >
                            {layerName}
                          </span>
                          <span
                            style={{
                              fontWeight: '600',
                              fontSize: '0.9rem',
                              color: 'var(--text-primary)',
                            }}
                          >
                            {userName}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: '0.8rem',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {formatTime(shift.startDate)} - {formatTime(shift.endDate)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
